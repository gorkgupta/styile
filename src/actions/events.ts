'use server';
import { revalidatePath } from 'next/cache';
import { getSalonContext } from '@/lib/context';
import { fail, must } from '@/lib/actions';
import { can } from '@/lib/permissions';
import { notifyAdvanceReceipt } from '@/lib/whatsapp/outbox';
import { checkEvent, normalizeAdvance, type EventInput } from '@/lib/events';
import { MONEY_METHODS, type ActionResult, type AdvancePayment, type PayMethod } from '@/lib/types';

// Bridal and event bookings with advances. An advance is recorded with an advance receipt — not a tax invoice — and
// is applied on the final bill. All the rules live in 0014_events_advances.sql.

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (s: unknown): s is string => typeof s === 'string' && ID_RE.test(s);
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const iso = (s: string) => new Date(s).toISOString();

function refresh() { revalidatePath('/app', 'layout'); }

/** Send the advance receipt link on WhatsApp; returns a few words for the toast. */
async function sendReceipt(salonId: string, advanceId: string): Promise<string> {
  const sent = await notifyAdvanceReceipt(salonId, advanceId);
  if (sent.sent) return ' · receipt sent on WhatsApp';
  return sent.reason === 'WhatsApp is not connected' ? '' : ` · receipt not sent on WhatsApp (${sent.reason ?? 'send failed'})`;
}

/** Book a bridal / group event: every person's appointment, an optional trial, and an optional advance — all at once. */
export async function createEvent(input: EventInput & { sendOnWhatsApp?: boolean }): Promise<ActionResult<{ id: string; advanceId: string | null }>> {
  try {
    const { supabase, salon, role } = await getSalonContext();
    if (!can(role, 'events')) return { ok: false, error: 'Your role can’t book events. Ask the front desk or a manager.' };
    const checked = checkEvent(input);
    if (!checked.ok) return checked;
    if (!isId(input.customerId)) return { ok: false, error: 'Choose the client.' };
    const ids = [...input.people.flatMap((p) => p.serviceIds), ...(input.trial?.serviceIds ?? [])];
    if (!ids.every(isId) || !input.people.every((p) => !p.staffId || isId(p.staffId))) return { ok: false, error: 'A service or stylist was removed. Refresh and try again.' };
    const advance = input.advance && finite(input.advance.amount) && input.advance.amount > 0 ? input.advance : null;
    if (advance && !MONEY_METHODS.includes(advance.method as PayMethod)) return { ok: false, error: 'Take the advance by cash, UPI or card.' };

    const ev = must(await supabase.rpc('create_event', {
      p_salon: salon.id,
      p_data: {
        customer_id: input.customerId, event_type: input.type, title: input.title.trim(), event_at: iso(input.eventAt),
        location: input.location, address: input.location === 'home' ? input.address?.trim() || null : null,
        travel_charge: input.location === 'home' ? Math.round((input.travelCharge ?? 0) * 100) / 100 : 0,
        quoted_price: input.quotedPrice == null ? null : Math.round(input.quotedPrice * 100) / 100, notes: input.notes?.trim() || null,
        people: input.people.map((p) => ({ name: p.name.trim().slice(0, 60), service_ids: p.serviceIds, staff_id: p.staffId || null, start_at: iso(p.start) })),
        trial: input.trial ? { start_at: iso(input.trial.start), staff_id: input.trial.staffId || null, service_ids: input.trial.serviceIds } : null,
        advance: advance ? { amount: Math.round(advance.amount * 100) / 100, method: advance.method, reference: advance.reference?.trim().slice(0, 120) || null } : null,
      },
    })) as { id: string };

    let advanceId: string | null = null;
    let message = 'Event booked';
    if (advance) {
      const a = (await supabase.from('advance_payments').select('id, receipt_no').eq('event_id', ev.id).eq('salon_id', salon.id).maybeSingle()).data as { id: string; receipt_no: string } | null;
      advanceId = a?.id ?? null;
      if (a) message += ` · advance receipt ${a.receipt_no}`;
      if (a && input.sendOnWhatsApp !== false) message += await sendReceipt(salon.id, a.id);
    }
    refresh();
    return { ok: true, data: { id: ev.id, advanceId }, message };
  } catch (e) { return fail(e); }
}

/** Change the details the desk may edit: name, address, travel charge, quote, notes. */
export async function updateEventDetails(id: string, input: { title: string; address?: string | null; travelCharge?: number; quotedPrice?: number | null; notes?: string | null }): Promise<ActionResult> {
  try {
    const { supabase, salon, role } = await getSalonContext();
    if (!can(role, 'events')) return { ok: false, error: 'Your role can’t change events.' };
    if (!isId(id)) return { ok: false, error: 'Event not found.' };
    const title = (input.title ?? '').trim();
    if (title.length < 2 || title.length > 80) return { ok: false, error: 'Give the event a name of up to 80 characters.' };
    const travel = Math.round((input.travelCharge ?? 0) * 100) / 100;
    if (!finite(travel) || travel < 0 || travel > 100000) return { ok: false, error: 'Travel charge should be from ₹0 to ₹1,00,000.' };
    const cur = must(await supabase.from('events').select('location').eq('id', id).eq('salon_id', salon.id).single()) as { location: 'salon' | 'home' };
    if (cur.location === 'home' && !(input.address ?? '').trim()) return { ok: false, error: 'Enter the address for the home visit.' };
    must(await supabase.from('events').update({
      title, notes: input.notes?.trim().slice(0, 1000) || null,
      quoted_price: input.quotedPrice == null ? null : Math.round(input.quotedPrice * 100) / 100,
      ...(cur.location === 'home' ? { address: input.address!.trim().slice(0, 240), travel_charge: travel } : {}),
    }).eq('id', id).eq('salon_id', salon.id));
    refresh();
    return { ok: true, message: 'Event saved' };
  } catch (e) { return fail(e); }
}

/** Cancel an event: its appointments are freed. Advances stay until a refund is recorded (no automatic forfeit). */
export async function cancelEvent(id: string, reason: string): Promise<ActionResult> {
  try {
    const { supabase, role } = await getSalonContext();
    if (!can(role, 'events')) return { ok: false, error: 'Your role can’t cancel events.' };
    if (!isId(id)) return { ok: false, error: 'Event not found.' };
    if (!reason?.trim()) return { ok: false, error: 'Give a reason — it stays with the event.' };
    must(await supabase.rpc('cancel_event', { p_event: id, p_reason: reason.trim().slice(0, 300) }));
    refresh();
    return { ok: true, message: 'Event cancelled. Any advance is kept until you record a refund.' };
  } catch (e) { return fail(e); }
}

export interface AdvanceInput { customerId: string; eventId?: string | null; amount: number; method: PayMethod; reference?: string | null; note?: string | null; sendOnWhatsApp?: boolean }

/** Take an advance (an advance receipt, not a tax invoice). */
export async function recordAdvance(input: AdvanceInput): Promise<ActionResult<{ advance: AdvancePayment }>> {
  try {
    const { supabase, salon, role } = await getSalonContext();
    if (!can(role, 'events')) return { ok: false, error: 'Your role can’t take advances. Ask the front desk or a manager.' };
    if (!isId(input.customerId)) return { ok: false, error: 'Choose the client.' };
    if (input.eventId && !isId(input.eventId)) return { ok: false, error: 'Event not found.' };
    if (!finite(input.amount) || input.amount <= 0) return { ok: false, error: 'Enter the advance received.' };
    if (!MONEY_METHODS.includes(input.method)) return { ok: false, error: 'Take the advance by cash, UPI or card.' };
    const row = normalizeAdvance(must(await supabase.rpc('record_advance', {
      p_salon: salon.id, p_customer: input.customerId, p_event: input.eventId || null, p_amount: Math.round(input.amount * 100) / 100,
      p_method: input.method, p_reference: input.reference?.trim().slice(0, 120) || null, p_note: input.note?.trim().slice(0, 300) || null,
    })));
    let message = `Advance received · receipt ${row.receipt_no}`;
    if (input.sendOnWhatsApp !== false) message += await sendReceipt(salon.id, row.id);
    refresh();
    return { ok: true, data: { advance: row }, message };
  } catch (e) { return fail(e); }
}

/** Owner / manager: hand back (part of) an advance, per the salon's policy. */
export async function refundAdvance(id: string, amount: number, method: PayMethod, reason: string): Promise<ActionResult> {
  try {
    const { supabase, role } = await getSalonContext();
    if (!can(role, 'refundAdvances')) return { ok: false, error: 'Only an owner or manager can refund an advance.' };
    if (!isId(id)) return { ok: false, error: 'Advance not found.' };
    if (!finite(amount) || amount <= 0) return { ok: false, error: 'Enter the amount handed back.' };
    if (!MONEY_METHODS.includes(method)) return { ok: false, error: 'Say how the money was handed back: cash, UPI or card.' };
    if (!reason?.trim()) return { ok: false, error: 'Give a reason — it stays with the advance.' };
    must(await supabase.rpc('refund_advance', { p_advance: id, p_amount: Math.round(amount * 100) / 100, p_method: method, p_reason: reason.trim().slice(0, 300) }));
    refresh();
    return { ok: true, message: 'Refund recorded — it shows as handed back on today’s day close' };
  } catch (e) { return fail(e); }
}

/** Send (again) the advance receipt link on WhatsApp. */
export async function resendAdvanceReceipt(id: string): Promise<ActionResult> {
  try {
    const { supabase, salon, role } = await getSalonContext();
    if (!can(role, 'events')) return { ok: false, error: 'Your role can’t send receipts.' };
    if (!isId(id)) return { ok: false, error: 'Advance not found.' };
    must(await supabase.from('advance_payments').select('id').eq('id', id).eq('salon_id', salon.id).single());
    const r = await notifyAdvanceReceipt(salon.id, id);
    if (!r.sent) return { ok: false, error: r.reason === 'WhatsApp is not connected' ? 'Connect your WhatsApp number in Settings to send receipts.' : `Couldn’t send on WhatsApp: ${r.reason ?? 'try again'}` };
    return { ok: true, message: 'Receipt sent on WhatsApp' };
  } catch (e) { return fail(e); }
}
