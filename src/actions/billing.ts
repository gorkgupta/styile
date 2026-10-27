'use server';
import { revalidatePath } from 'next/cache';
import { getSalonContext } from '@/lib/context';
import { fail, must } from '@/lib/actions';
import { can } from '@/lib/permissions';
import { notifyInvoice } from '@/lib/whatsapp/outbox';
import type { ActionResult, PayMethod } from '@/lib/types';

const METHODS: PayMethod[] = ['cash', 'upi', 'card', 'wallet', 'other'];

export interface BillItemInput {
  kind: 'service' | 'product' | 'custom';
  serviceId?: string | null;
  staffId?: string | null;
  name: string;
  qty: number;
  unitPrice: number;
  discount: number;
  gstRate?: number | null;
}

export interface BillPaymentInput { method: PayMethod; amount: number; reference?: string }

export interface CreateInvoiceInput {
  customerId: string | null;
  appointmentId: string | null;
  items: BillItemInput[];
  payments: BillPaymentInput[];
  notes?: string;
  sendOnWhatsApp?: boolean;
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
    }
    const payments = (input.payments ?? []).filter((p) => finite(p.amount) && p.amount > 0);
    for (const p of payments) if (!METHODS.includes(p.method)) return { ok: false, error: 'Pick a payment method.' };

    const inv = must(await supabase.rpc('create_invoice', {
      p_salon: salon.id,
      p_data: {
        customer_id: input.customerId || null,
        appointment_id: input.appointmentId || null,
        notes: input.notes?.trim() || null,
        items: items.map((i) => ({
          kind: i.kind,
          service_id: i.kind === 'service' ? i.serviceId || null : null,
          staff_id: i.staffId || null,
          name: i.name.trim(),
          qty: i.qty,
          unit_price: i.unitPrice,
          discount: i.discount,
          gst_rate: i.gstRate ?? null,
        })),
        payments: payments.map((p) => ({ method: p.method, amount: p.amount, reference: p.reference?.trim() || null })),
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
