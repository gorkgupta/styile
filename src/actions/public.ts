'use server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { BookingError, createBooking, findOrCreateCustomer, getAvailability, loadCatalog } from '@/lib/booking';
import { notifyBookingConfirmed } from '@/lib/whatsapp/outbox';
import { fail } from '@/lib/actions';
import { normalizePhone } from '@/lib/phone';
import { fmtDateTime, isValidDateStr } from '@/lib/time';
import type { Slot } from '@/lib/availability';
import type { ActionResult } from '@/lib/types';

// Public booking page (/s/[slug]). Anonymous visitors have no table access, so these actions use the
// service-role client and validate every input themselves. Booking requires a verified phone (Supabase phone OTP).

export interface BookOnlineInput {
  slug: string;
  serviceIds: string[];
  staffId: string | null;
  start: string;   // ISO instant from getPublicSlots
  name: string;
  notes?: string;
}

export interface BookOnlineResult {
  appointmentId: string;
  when: string;     // "Wed, 28 Oct, 5:15 PM" in the salon's time zone
  stylist: string;
  start: string;
  end: string;
}

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanIds(ids: unknown): string[] {
  if (!Array.isArray(ids) || !ids.length) throw new BookingError('Pick at least one service.');
  if (ids.length > 10) throw new BookingError('You can book up to 10 services at a time.');
  if (!ids.every((x) => typeof x === 'string' && ID_RE.test(x))) throw new BookingError('One of the chosen services is no longer offered. Refresh the page.');
  return [...new Set(ids as string[])];
}

function cleanStaff(id: unknown): string | null {
  if (id === null || id === undefined || id === '') return null;
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new BookingError('That stylist is not available. Pick another.');
  return id;
}

/** The salon behind a booking link, only while it is taking online bookings. */
async function publicSalonId(slug: unknown): Promise<string> {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) throw new BookingError('This booking link is not valid.');
  const db = createAdminClient();
  const { data } = await db.from('salons').select('id, booking_enabled, plan_status').eq('slug', slug).maybeSingle();
  if (!data || !data.booking_enabled || ['suspended', 'cancelled'].includes(data.plan_status)) {
    throw new BookingError('This salon is not taking online bookings right now. Please call them to book.');
  }
  return data.id as string;
}

function failBooking(e: unknown): ActionResult<never> {
  if (e instanceof BookingError) return { ok: false, error: e.message };
  console.error('public booking failed', e);
  return fail(e);
}

export async function getPublicSlots(slug: string, serviceIds: string[], date: string, staffId: string | null): Promise<ActionResult<Slot[]>> {
  try {
    if (!isValidDateStr(date)) return { ok: false, error: 'Pick a valid date.' };
    const ids = cleanIds(serviceIds);
    const staff = cleanStaff(staffId);
    const salonId = await publicSalonId(slug);
    const db = createAdminClient();
    const catalog = await loadCatalog(db, salonId);
    if (staff && !catalog.staff.some((s) => s.id === staff && s.bookable)) return { ok: false, error: 'That stylist is not taking bookings. Pick another.' };
    const slots = await getAvailability(db, catalog, { serviceIds: ids, date, staffId: staff, onlineOnly: true });
    return { ok: true, data: slots };
  } catch (e) { return failBooking(e); }
}

export async function bookOnline(input: BookOnlineInput): Promise<ActionResult<BookOnlineResult>> {
  try {
    const ids = cleanIds(input?.serviceIds);
    const staffId = cleanStaff(input.staffId);
    const name = String(input.name ?? '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 80) return { ok: false, error: 'Enter your name.' };
    const notes = String(input.notes ?? '').trim().slice(0, 500) || null;
    if (typeof input.start !== 'string' || Number.isNaN(new Date(input.start).getTime())) return { ok: false, error: 'Pick a time.' };

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    const user = auth.user;
    if (!user) return { ok: false, error: 'Verify your mobile number to book.' };
    const phone = user.phone_confirmed_at ? normalizePhone(user.phone ?? '') : null;
    if (!phone) return { ok: false, error: 'Verify your mobile number to book.' };

    const salonId = await publicSalonId(input.slug);
    const db = createAdminClient();
    const catalog = await loadCatalog(db, salonId);
    if (staffId && !catalog.staff.some((s) => s.id === staffId && s.bookable)) return { ok: false, error: 'That stylist is not taking bookings. Pick another.' };

    const customer = await findOrCreateCustomer(db, salonId, phone, name);
    await db.from('customers').update({ user_id: user.id }).eq('id', customer.id).is('user_id', null);
    await db.from('profiles').update({ full_name: name }).eq('id', user.id).is('full_name', null);

    const { appointment, stylist } = await createBooking(db, catalog, {
      customerId: customer.id, serviceIds: ids, start: input.start, staffId, source: 'online', notes, onlineOnly: true,
    });
    await notifyBookingConfirmed(appointment.id); // never throws; a failed WhatsApp send must not undo the booking

    return {
      ok: true,
      data: {
        appointmentId: appointment.id,
        when: fmtDateTime(appointment.start_at, catalog.salon.timezone),
        stylist: stylist.name,
        start: new Date(appointment.start_at).toISOString(),
        end: new Date(appointment.end_at).toISOString(),
      },
    };
  } catch (e) { return failBooking(e); }
}
