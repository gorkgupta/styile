'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { BookingError, cancelBooking, getAvailability, loadCatalog, rescheduleBooking } from '@/lib/booking';
import { fail } from '@/lib/actions';
import { fmtDateTime, isValidDateStr } from '@/lib/time';
import type { Slot } from '@/lib/availability';
import type { ActionResult } from '@/lib/types';

// Client portal (/me). Clients read their own rows through RLS; changes go through the booking service with
// the service-role client, after checking the appointment belongs to a customer row linked to this user.

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function currentUserId(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new BookingError('Your session has ended. Log in again with your mobile number.');
  return data.user.id;
}

/** The appointment, if its client row is linked to this user. */
async function myAppointment(appointmentId: unknown) {
  if (typeof appointmentId !== 'string' || !ID_RE.test(appointmentId)) throw new BookingError('Booking not found');
  const userId = await currentUserId();
  const db = createAdminClient();
  const { data } = await db.from('appointments')
    .select('id, salon_id, customer_id, customer:customers(user_id)')
    .eq('id', appointmentId).maybeSingle();
  const owner = (data?.customer as { user_id: string | null } | null)?.user_id;
  if (!data || owner !== userId) throw new BookingError('Booking not found');
  return { db, salonId: data.salon_id as string, customerId: data.customer_id as string, id: data.id as string };
}

function failPortal(e: unknown): ActionResult<never> {
  if (e instanceof BookingError) return { ok: false, error: e.message };
  console.error('portal action failed', e);
  return fail(e);
}

/** Link every salon's client record with this phone number to the signed-in user. Returns how many were linked. */
export async function claimMyProfiles(): Promise<ActionResult<{ linked: number }>> {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return { ok: false, error: 'Log in with your mobile number first.' };
    const { data, error } = await supabase.rpc('claim_customer_profiles');
    if (error) throw error;
    revalidatePath('/me', 'layout');
    return { ok: true, data: { linked: Number(data ?? 0) } };
  } catch (e) { return failPortal(e); }
}

export async function cancelMyBooking(appointmentId: string, reason: string): Promise<ActionResult> {
  try {
    const appt = await myAppointment(appointmentId);
    const why = String(reason ?? '').trim().slice(0, 200);
    await cancelBooking(appt.db, appt.salonId, appt.customerId, appt.id, why ? `Client cancelled online: ${why}` : 'Client cancelled online');
    revalidatePath('/me');
    return { ok: true, message: 'Booking cancelled' };
  } catch (e) { return failPortal(e); }
}

export async function getMySlots(appointmentId: string, date: string): Promise<ActionResult<Slot[]>> {
  try {
    if (!isValidDateStr(date)) return { ok: false, error: 'Pick a valid date.' };
    const appt = await myAppointment(appointmentId);
    const { data: lines } = await appt.db.from('appointment_services').select('service_id').eq('appointment_id', appt.id);
    const serviceIds = ((lines ?? []) as { service_id: string | null }[]).map((l) => l.service_id).filter((x): x is string => !!x);
    if (!serviceIds.length) return { ok: false, error: 'This booking can’t be moved online. Please message the salon.' };
    const catalog = await loadCatalog(appt.db, appt.salonId);
    const slots = await getAvailability(appt.db, catalog, { serviceIds, date, excludeAppointmentId: appt.id, onlineOnly: true });
    return { ok: true, data: slots };
  } catch (e) { return failPortal(e); }
}

export async function rescheduleMyBooking(appointmentId: string, newStart: string): Promise<ActionResult<{ when: string; stylist: string }>> {
  try {
    if (typeof newStart !== 'string' || Number.isNaN(new Date(newStart).getTime())) return { ok: false, error: 'Pick a new time.' };
    const appt = await myAppointment(appointmentId);
    const catalog = await loadCatalog(appt.db, appt.salonId);
    const { appointment, stylist } = await rescheduleBooking(appt.db, catalog, appt.customerId, appt.id, newStart);
    revalidatePath('/me');
    return { ok: true, data: { when: fmtDateTime(appointment.start_at, catalog.salon.timezone), stylist: stylist.name }, message: 'Booking moved' };
  } catch (e) { return failPortal(e); }
}
