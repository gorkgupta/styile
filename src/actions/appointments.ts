'use server';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { notifyBookingConfirmed } from '@/lib/whatsapp/outbox';
import { getSalonContext } from '@/lib/context';
import { fail, must } from '@/lib/actions';
import { getAvailability, loadCatalog, BookingError } from '@/lib/booking';
import { normalizePhone } from '@/lib/phone';
import type { Slot } from '@/lib/availability';
import type { ActionResult, ApptStatus } from '@/lib/types';

export interface ClientLite { id: string; name: string; phone: string; visit_count: number; last_visit_at: string | null }

function refresh() { revalidatePath('/app', 'layout'); }

export async function searchClients(query: string): Promise<ActionResult<ClientLite[]>> {
  try {
    const { supabase, salon } = await getSalonContext();
    const q = query.trim();
    let req = supabase.from('customers').select('id, name, phone, visit_count, last_visit_at').eq('salon_id', salon.id).limit(8);
    if (q) {
      const digits = q.replace(/\D/g, '');
      req = digits.length >= 3 ? req.like('phone', `%${digits}%`) : req.ilike('name', `%${q.replace(/[%_]/g, '')}%`);
    } else {
      req = req.order('last_visit_at', { ascending: false, nullsFirst: false });
    }
    return { ok: true, data: must(await req) as ClientLite[] };
  } catch (e) { return fail(e); }
}

export async function quickCreateClient(input: { name: string; phone: string }): Promise<ActionResult<ClientLite>> {
  try {
    const { supabase, salon } = await getSalonContext();
    const phone = normalizePhone(input.phone);
    if (!input.name.trim()) return { ok: false, error: 'Enter the client’s name.' };
    if (!phone) return { ok: false, error: 'Enter a valid 10-digit mobile number.' };
    const existing = await supabase.from('customers').select('id, name, phone, visit_count, last_visit_at').eq('salon_id', salon.id).eq('phone', phone).maybeSingle();
    if (existing.data) return { ok: true, data: existing.data as ClientLite, message: 'This number is already a client — selected them.' };
    const row = must(await supabase.from('customers').insert({ salon_id: salon.id, name: input.name.trim(), phone })
      .select('id, name, phone, visit_count, last_visit_at').single());
    return { ok: true, data: row as ClientLite };
  } catch (e) { return fail(e); }
}

export async function findSlots(input: { serviceIds: string[]; date: string; staffId?: string | null }): Promise<ActionResult<Slot[]>> {
  try {
    const { supabase, salon } = await getSalonContext();
    if (!input.serviceIds.length) return { ok: false, error: 'Pick at least one service.' };
    const catalog = await loadCatalog(supabase, salon.id);
    return { ok: true, data: await getAvailability(supabase, catalog, { ...input, onlineOnly: false }) };
  } catch (e) { return e instanceof BookingError ? { ok: false, error: e.message } : fail(e); }
}

export interface NewAppointmentInput {
  customerId: string;
  serviceIds: string[];
  staffId: string;
  start: string; // ISO
  notes?: string;
  source?: 'staff' | 'phone' | 'walk_in';
  /** Send the client a WhatsApp confirmation (default true). */
  notify?: boolean;
}

/**
 * Front desk booking. Staff can book outside the online-booking rules (e.g. before opening),
 * but never on top of another appointment — the database rejects overlaps.
 */
export async function createAppointment(input: NewAppointmentInput): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase, salon, branch, user } = await getSalonContext();
    if (!input.customerId) return { ok: false, error: 'Choose a client.' };
    if (!input.serviceIds.length) return { ok: false, error: 'Pick at least one service.' };
    if (!input.staffId) return { ok: false, error: 'Choose a stylist.' };
    const start = new Date(input.start);
    if (Number.isNaN(start.getTime())) return { ok: false, error: 'Pick a time.' };
    // Online and WhatsApp bookings come only from those channels (reports count bookings by source).
    if (input.source && !['staff', 'phone', 'walk_in'].includes(input.source)) return { ok: false, error: 'Pick how the client booked.' };
    const services = must(await supabase.from('services').select('id, name, price, duration_min').eq('salon_id', salon.id).in('id', input.serviceIds));
    if (services.length !== new Set(input.serviceIds).size) return { ok: false, error: 'One of the services was removed. Refresh and try again.' };
    const ordered = input.serviceIds.map((id) => services.find((s) => s.id === id)!);
    const minutes = ordered.reduce((s, x) => s + x.duration_min, 0);
    const appt = must(await supabase.from('appointments').insert({
      salon_id: salon.id, branch_id: branch.id, customer_id: input.customerId, staff_id: input.staffId,
      start_at: start.toISOString(), end_at: new Date(start.getTime() + minutes * 60000).toISOString(),
      status: 'booked', source: input.source ?? 'staff', notes: input.notes?.trim() || null, created_by: user.id,
    }).select('id').single());
    const lines = await supabase.from('appointment_services').insert(ordered.map((s, i) => ({
      appointment_id: appt.id, salon_id: salon.id, service_id: s.id, name: s.name, price: s.price, duration_min: s.duration_min, sort: i,
    })));
    if (lines.error) { await supabase.from('appointments').delete().eq('id', appt.id); throw lines.error; }
    if (input.notify !== false && start.getTime() > Date.now()) after(() => notifyBookingConfirmed(appt.id));
    refresh();
    return { ok: true, data: { id: appt.id }, message: 'Appointment booked' };
  } catch (e) { return fail(e); }
}

const ALLOWED_NEXT: Partial<Record<ApptStatus, ApptStatus[]>> = {
  booked: ['confirmed', 'checked_in', 'in_service', 'cancelled', 'no_show'],
  confirmed: ['checked_in', 'in_service', 'cancelled', 'no_show', 'booked'],
  checked_in: ['in_service', 'cancelled', 'confirmed'],
  in_service: ['checked_in', 'completed'],
  no_show: ['booked'],
  cancelled: ['booked'],
};

export async function setAppointmentStatus(id: string, status: ApptStatus, reason?: string): Promise<ActionResult> {
  try {
    const { supabase, salon } = await getSalonContext();
    const cur = must(await supabase.from('appointments').select('status').eq('id', id).eq('salon_id', salon.id).single());
    if (!ALLOWED_NEXT[cur.status as ApptStatus]?.includes(status)) return { ok: false, error: 'That change isn’t possible for this appointment.' };
    must(await supabase.from('appointments').update({ status, cancelled_reason: status === 'cancelled' ? reason || 'Cancelled by salon' : null })
      .eq('id', id).eq('salon_id', salon.id));
    refresh();
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function moveAppointment(id: string, input: { start: string; staffId: string }): Promise<ActionResult> {
  try {
    const { supabase, salon } = await getSalonContext();
    const cur = must(await supabase.from('appointments').select('start_at, end_at, status').eq('id', id).eq('salon_id', salon.id).single());
    if (['completed', 'cancelled', 'no_show'].includes(cur.status)) return { ok: false, error: 'Finished or cancelled appointments can’t be moved.' };
    const length = new Date(cur.end_at).getTime() - new Date(cur.start_at).getTime();
    const start = new Date(input?.start);
    if (Number.isNaN(start.getTime())) return { ok: false, error: 'Pick a time.' };
    if (!input.staffId) return { ok: false, error: 'Choose a stylist.' };
    must(await supabase.from('appointments').update({
      start_at: start.toISOString(), end_at: new Date(start.getTime() + length).toISOString(), staff_id: input.staffId,
      reminder_24h_sent_at: null, reminder_2h_sent_at: null,
    }).eq('id', id).eq('salon_id', salon.id));
    refresh();
    return { ok: true, message: 'Appointment moved' };
  } catch (e) { return fail(e); }
}

export async function updateAppointmentNotes(id: string, notes: string): Promise<ActionResult> {
  try {
    const { supabase, salon } = await getSalonContext();
    must(await supabase.from('appointments').update({ notes: notes.trim() || null }).eq('id', id).eq('salon_id', salon.id));
    refresh();
    return { ok: true };
  } catch (e) { return fail(e); }
}

// ---------- Walk-in queue ----------

export async function addWalkIn(input: { customerId: string; serviceIds: string[]; staffId?: string | null; notes?: string }): Promise<ActionResult<{ token: number }>> {
  try {
    const { supabase, salon } = await getSalonContext();
    if (!input.customerId) return { ok: false, error: 'Choose a client.' };
    if (!input.serviceIds.length) return { ok: false, error: 'Pick at least one service.' };
    const row = must(await supabase.rpc('add_walk_in', {
      p_salon: salon.id, p_customer: input.customerId, p_service_ids: input.serviceIds,
      p_staff: input.staffId || null, p_notes: input.notes?.trim() || null,
    })) as { token_no: number };
    refresh();
    return { ok: true, data: { token: row.token_no }, message: `Token ${row.token_no} added to the queue` };
  } catch (e) { return fail(e); }
}

export async function startWalkIn(id: string, staffId: string): Promise<ActionResult> {
  try {
    const { supabase } = await getSalonContext();
    if (!staffId) return { ok: false, error: 'Choose who will serve this client.' };
    must(await supabase.rpc('start_walk_in', { p_appt: id, p_staff: staffId }));
    refresh();
    return { ok: true, message: 'Service started' };
  } catch (e) { return fail(e); }
}

export async function removeFromQueue(id: string): Promise<ActionResult> {
  try {
    const { supabase, salon } = await getSalonContext();
    must(await supabase.from('appointments').update({ status: 'cancelled', cancelled_reason: 'Left the queue' })
      .eq('id', id).eq('salon_id', salon.id).eq('status', 'waiting'));
    refresh();
    return { ok: true };
  } catch (e) { return fail(e); }
}
