'use server';
import { revalidatePath } from 'next/cache';
import { getSalonContext } from '@/lib/context';
import { fail, must } from '@/lib/actions';
import { can } from '@/lib/permissions';
import { notifyInvoice } from '@/lib/whatsapp/outbox';
import { BUSINESS_GSTIN_RE, cleanGstin, GST_SLABS, HSN_RE } from '@/lib/gst';
import { ALL_PAY_METHODS, type ActionResult, type PayMethod } from '@/lib/types';

// Any payment type is accepted here (the salon's Settings only decide which ones the desk sees), plus advances
// paid earlier (taken from the client's advances by the database). Package sessions are added by the database.
const METHODS: PayMethod[] = [...ALL_PAY_METHODS, 'advance'];

export interface BillItemInput {
  kind: 'service' | 'product' | 'custom';
  serviceId?: string | null;
  staffId?: string | null;
  name: string;
  qty: number;
  unitPrice: number;
  discount: number;
  /** Products: the rate chosen (required for regular GST). Services: ignored — the database uses the menu/statutory rate. */
  gstRate?: number | null;
  /** HSN for products (4, 6 or 8 digits), optional. */
  code?: string | null;
  /** Take this service from the client's package (the database prices it at the session's value and pays it). */
  clientPackageId?: string | null;
}

export interface BillPaymentInput { method: PayMethod; amount: number; reference?: string; /** For 'advance': a particular advance (else oldest first). */ advanceId?: string | null }

export interface CreateInvoiceInput {
  customerId: string | null;
  appointmentId: string | null;
  /** Checking out a bridal / group event: every person's appointment is completed on this bill. */
  eventId?: string | null;
  items: BillItemInput[];
  payments: BillPaymentInput[];
  notes?: string;
  sendOnWhatsApp?: boolean;
  /** Business client's GSTIN and address (tax invoices only). */
  clientGstin?: string | null;
  clientAddress?: string | null;
}

function refresh() { revalidatePath('/app', 'layout'); }
const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n);

/** Save a bill. Totals, tax and the bill number are worked out by create_invoice() in the database. */
export async function createInvoice(input: CreateInvoiceInput): Promise<ActionResult<{ id: string; invoiceNo: string }>> {
  try {
    const { supabase, salon, role } = await getSalonContext();
    if (!can(role, 'bill')) return { ok: false, error: 'Your role can’t create bills. Ask the owner or a manager.' };

    const items = (input.items ?? []).filter((i) => i.name?.trim());
    if (!items.length) return { ok: false, error: 'Add at least one service or item to the bill.' };
    for (const i of items) {
      if (!finite(i.qty) || i.qty <= 0) return { ok: false, error: `Quantity for “${i.name}” must be more than zero.` };
      if (!finite(i.unitPrice) || i.unitPrice < 0) return { ok: false, error: `Enter a price for “${i.name}”.` };
      if (!finite(i.discount) || i.discount < 0) return { ok: false, error: `Discount on “${i.name}” can’t be negative.` };
      if (i.discount > i.qty * i.unitPrice) return { ok: false, error: `Discount on “${i.name}” is more than its price.` };
      if (i.gstRate != null && !(GST_SLABS as readonly number[]).includes(i.gstRate)) return { ok: false, error: `GST on “${i.name}” must be 0, 5, 12, 18 or 28%.` };
      if (i.code && !HSN_RE.test(i.code.trim())) return { ok: false, error: `HSN code for “${i.name}” should be 4, 6 or 8 digits, like 3305.` };
      if (i.clientPackageId) {
        if (i.kind !== 'service' || !i.serviceId) return { ok: false, error: `Only a service from your menu can be taken from a package.` };
        if (!input.customerId) return { ok: false, error: 'Choose the client to use their package.' };
        if (!Number.isInteger(i.qty)) return { ok: false, error: `Package sessions for “${i.name}” are whole numbers.` };
      }
    }
    const clientGstin = cleanGstin(input.clientGstin) || null;
    if (clientGstin && salon.gst_mode !== 'regular') return { ok: false, error: 'A client GSTIN goes on tax invoices only. Set your GST status in Settings.' };
    if (clientGstin && !BUSINESS_GSTIN_RE.test(clientGstin)) return { ok: false, error: 'Client GSTIN should be 15 characters, like 19ABCDE1234F1Z5.' };
    const clientAddress = (input.clientAddress ?? '').trim().replace(/\s+/g, ' ').slice(0, 240) || null;
    const payments = (input.payments ?? []).filter((p) => finite(p.amount) && p.amount > 0);
    for (const p of payments) if (!METHODS.includes(p.method)) return { ok: false, error: 'Pick a payment method.' };
    // Package sessions are paid by the database from the package lines; the desk never sends them as a payment.

    const inv = must(await supabase.rpc('create_invoice', {
      p_salon: salon.id,
      p_data: {
        customer_id: input.customerId || null,
        appointment_id: input.appointmentId || null,
        event_id: input.eventId || null,
        notes: input.notes?.trim() || null,
        client_gstin: clientGstin,
        client_address: clientAddress,
        items: items.map((i) => ({
          kind: i.kind,
          service_id: i.kind === 'service' ? i.serviceId || null : null,
          staff_id: i.staffId || null,
          name: i.name.trim(),
          qty: i.qty,
          unit_price: i.unitPrice,
          discount: i.discount,
          gst_rate: i.kind === 'service' ? null : i.gstRate ?? null,
          code: i.kind === 'service' ? null : i.code?.trim() || null,
          client_package_id: i.kind === 'service' && i.clientPackageId ? i.clientPackageId : null,
        })),
        payments: payments.map((p) => ({ method: p.method, amount: p.amount, reference: p.reference?.trim() || null, ...(p.method === 'advance' && p.advanceId ? { advance_id: p.advanceId } : {}) })),
      },
    })) as { id: string; invoice_no: string };

    let message = `Bill ${inv.invoice_no} saved`;
    if (input.sendOnWhatsApp && input.customerId) {
      const r = await notifyInvoice(inv.id);
      message += r.sent ? ' and sent on WhatsApp' : ` — not sent on WhatsApp (${r.reason ?? 'send failed'})`;
    }
    refresh();
    return { ok: true, data: { id: inv.id, invoiceNo: inv.invoice_no }, message };
  } catch (e) { return fail(e); }
}

/** Record money received later against an unpaid or part-paid bill. */
export async function addPayment(invoiceId: string, method: PayMethod, amount: number, reference?: string): Promise<ActionResult> {
  try {
    const { supabase, role } = await getSalonContext();
    if (!can(role, 'bill')) return { ok: false, error: 'Your role can’t record payments.' };
    if (!METHODS.includes(method)) return { ok: false, error: 'Pick a payment method.' };
    if (!finite(amount) || amount <= 0) return { ok: false, error: 'Enter the amount received.' };
    must(await supabase.rpc('add_payment', { p_invoice: invoiceId, p_method: method, p_amount: amount, p_reference: reference?.trim() || null }));
    refresh();
    return { ok: true, message: 'Payment recorded' };
  } catch (e) { return fail(e); }
}

/** Cancel a bill. The number stays used (GST rules); the client's totals are reduced. */
export async function voidInvoice(invoiceId: string, reason: string): Promise<ActionResult> {
  try {
    const { supabase, role } = await getSalonContext();
    if (!can(role, 'voidBill')) return { ok: false, error: 'Only an owner or manager can cancel bills.' };
    if (!reason?.trim()) return { ok: false, error: 'Give a reason for cancelling the bill.' };
    must(await supabase.rpc('void_invoice', { p_invoice: invoiceId, p_reason: reason.trim() }));
    refresh();
    return { ok: true, message: 'Bill cancelled' };
  } catch (e) { return fail(e); }
}

/** Send (or send again) the bill link to the client on WhatsApp. */
export async function resendInvoice(invoiceId: string): Promise<ActionResult> {
  try {
    const { supabase, salon, role } = await getSalonContext();
    if (!can(role, 'bill')) return { ok: false, error: 'Your role can’t send bills.' };
    // Read through the user's client first so RLS confirms this bill belongs to their salon.
    const inv = must(await supabase.from('invoices').select('id, customer_id').eq('id', invoiceId).eq('salon_id', salon.id).single()) as { id: string; customer_id: string | null };
    if (!inv.customer_id) return { ok: false, error: 'This bill has no client. Bills for walk-ins without a number can’t be sent.' };
    const r = await notifyInvoice(inv.id);
    if (!r.sent) return { ok: false, error: r.reason === 'WhatsApp is not connected' ? 'Connect your WhatsApp number in Settings to send bills.' : `Couldn’t send on WhatsApp: ${r.reason ?? 'try again'}` };
    return { ok: true, message: 'Bill sent on WhatsApp' };
  } catch (e) { return fail(e); }
}
