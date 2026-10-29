import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeSlots, qualifiedStaff, type Slot } from './availability';
import { addDays, localDate, isValidDateStr } from './time';
import type { Branch, BookingSource, Salon, Service, Staff } from './types';

// Booking service shared by the online booking page, the WhatsApp bot and the front desk.
// Every function takes the Supabase client to use: the service-role client for public/bot paths
// (which validate everything here), or the signed-in staff client inside the dashboard.

export class BookingError extends Error {}

export interface BookingCatalog {
  salon: Salon;
  branch: Branch;
  services: Service[];
  staff: Staff[];
  skills: Map<string, Set<string>>;
}

export async function loadCatalog(db: SupabaseClient, salonId: string): Promise<BookingCatalog> {
  const [salon, branch, services, staff, skills] = await Promise.all([
    db.from('salons').select('*').eq('id', salonId).single(),
    db.from('branches').select('*').eq('salon_id', salonId).eq('is_default', true).single(),
    db.from('services').select('*').eq('salon_id', salonId).eq('active', true).order('sort').order('name'),
    db.from('staff').select('*').eq('salon_id', salonId).eq('active', true).order('sort').order('name'),
    db.from('staff_services').select('staff_id, service_id').eq('salon_id', salonId),
  ]);
  if (salon.error || !salon.data) throw new BookingError('Salon not found');
  if (branch.error || !branch.data) throw new BookingError('Salon has no branch set up');
  const skillMap = new Map<string, Set<string>>();
  for (const r of skills.data ?? []) {
    const set = skillMap.get(r.staff_id) ?? new Set<string>();
    set.add(r.service_id);
    skillMap.set(r.staff_id, set);
  }
  return {
    salon: salon.data as Salon,
    branch: branch.data as Branch,
    services: (services.data ?? []) as Service[],
    staff: (staff.data ?? []) as Staff[],
    skills: skillMap,
  };
}

export function pickServices(catalog: BookingCatalog, serviceIds: string[], onlineOnly: boolean): Service[] {
  const unique = [...new Set(serviceIds)];
  const picked = unique.map((id) => catalog.services.find((s) => s.id === id));
  if (!picked.length || picked.some((s) => !s)) throw new BookingError('One of the chosen services is no longer offered');
  if (onlineOnly && picked.some((s) => !s!.online_bookable)) throw new BookingError('That service can only be booked at the salon. Please call us.');
  return picked as Service[];
}

export interface AvailabilityQuery {
  serviceIds: string[];
  date: string;
  staffId?: string | null;
  excludeAppointmentId?: string;
  /** Client-facing (booking page, WhatsApp, portal): booking rules apply and hidden stylists aren't offered. */
  onlineOnly?: boolean;
  /** Stays eligible online even if hidden from the booking page: the client's current stylist when moving a booking. */
  keepStaffId?: string | null;
  now?: Date;
}

export async function getAvailability(db: SupabaseClient, catalog: BookingCatalog, q: AvailabilityQuery): Promise<Slot[]> {
  const { salon, branch } = catalog;
  if (!isValidDateStr(q.date)) throw new BookingError('Pick a valid date');
  const now = q.now ?? new Date();
  const today = localDate(now, salon.timezone);
  if (q.onlineOnly) {
    if (!salon.booking_enabled) throw new BookingError('Online booking is switched off for this salon');
    if (q.date < today || q.date > addDays(today, salon.booking_window_days)) return [];
  }
  const services = pickServices(catalog, q.serviceIds, !!q.onlineOnly);
  const duration = services.reduce((s, x) => s + x.duration_min, 0);
  let staff = qualifiedStaff(catalog.staff, catalog.skills, services.map((s) => s.id));
  if (q.onlineOnly) staff = staff.filter((s) => s.show_on_booking !== false || (!!q.keepStaffId && s.id === q.keepStaffId));
  if (q.staffId) staff = staff.filter((s) => s.id === q.staffId);
  if (!staff.length) return [];

  // Busy blocks for the day (pad a day either side so overnight time-zone edges are covered).
  const from = new Date(new Date(`${q.date}T00:00:00Z`).getTime() - 86400000).toISOString();
  const to = new Date(new Date(`${q.date}T00:00:00Z`).getTime() + 2 * 86400000).toISOString();
  let query = db
    .from('appointments')
    .select('id, staff_id, start_at, end_at')
    .eq('salon_id', salon.id)
    .in('staff_id', staff.map((s) => s.id))
    .not('status', 'in', '(waiting,cancelled,no_show)')
    .lt('start_at', to)
    .gt('end_at', from);
  if (q.excludeAppointmentId) query = query.neq('id', q.excludeAppointmentId);
  const { data: appts, error } = await query;
  if (error) throw new BookingError('Could not check availability. Try again.');

  return computeSlots({
    date: q.date,
    tz: salon.timezone,
    now,
    intervalMin: salon.slot_interval_min,
    leadMin: q.onlineOnly ? salon.booking_lead_min : 0,
    durationMin: duration,
    branchHours: branch.business_hours,
    staff: staff.map((s) => ({ id: s.id, hours: s.working_hours })),
    busy: ((appts ?? []) as { staff_id: string; start_at: string; end_at: string }[]).map((a) => ({ staffId: a.staff_id, start: new Date(a.start_at), end: new Date(a.end_at) })),
  });
}

export async function findOrCreateCustomer(db: SupabaseClient, salonId: string, phone: string, name?: string | null) {
  const { data: existing } = await db.from('customers').select('*').eq('salon_id', salonId).eq('phone', phone).maybeSingle();
  if (existing) {
    if (name && (!existing.name || existing.name === existing.phone)) {
      await db.from('customers').update({ name }).eq('id', existing.id);
      existing.name = name;
    }
    return existing as { id: string; name: string; phone: string };
  }
  const { data, error } = await db
    .from('customers')
    .insert({ salon_id: salonId, phone, name: name?.trim() || phone })
    .select('*')
    .single();
  if (error) {
    // Two requests racing to create the same client: read the winner.
    const { data: again } = await db.from('customers').select('*').eq('salon_id', salonId).eq('phone', phone).single();
    if (again) return again as { id: string; name: string; phone: string };
    throw new BookingError('Could not save the client');
  }
  return data as { id: string; name: string; phone: string };
}

export interface CreateBookingInput {
  customerId: string;
  serviceIds: string[];
  start: string;              // ISO instant of a slot returned by getAvailability
  staffId?: string | null;    // preferred stylist; null = any
  source: BookingSource;
  notes?: string | null;
  createdBy?: string | null;
  onlineOnly?: boolean;
}

export async function createBooking(db: SupabaseClient, catalog: BookingCatalog, input: CreateBookingInput) {
  const { salon, branch } = catalog;
  const startDate = new Date(input.start);
  if (Number.isNaN(startDate.getTime())) throw new BookingError('Pick a valid time');
  const date = localDate(startDate, salon.timezone);
  const slots = await getAvailability(db, catalog, {
    serviceIds: input.serviceIds, date, staffId: input.staffId, onlineOnly: input.onlineOnly,
  });
  const slot = slots.find((s) => s.start === startDate.toISOString());
  if (!slot) throw new BookingError('That time was just taken. Please pick another slot.');

  const services = pickServices(catalog, input.serviceIds, !!input.onlineOnly);
  for (const staffId of slot.staffIds) {
    const { data: appt, error } = await db
      .from('appointments')
      .insert({
        salon_id: salon.id, branch_id: branch.id, customer_id: input.customerId, staff_id: staffId,
        start_at: slot.start, end_at: slot.end, status: 'booked', source: input.source,
        notes: input.notes ?? null, created_by: input.createdBy ?? null,
      })
      .select('*')
      .single();
    if (error) {
      if (error.code === '23P01') continue; // someone booked this stylist a moment ago — try the next one
      throw new BookingError('Could not save the booking. Try again.');
    }
    const { error: lineErr } = await db.from('appointment_services').insert(
      services.map((s, i) => ({
        appointment_id: appt.id, salon_id: salon.id, service_id: s.id, name: s.name, price: s.price, duration_min: s.duration_min, sort: i,
      })),
    );
    if (lineErr) {
      await db.from('appointments').delete().eq('id', appt.id);
      throw new BookingError('Could not save the booking. Try again.');
    }
    const stylist = catalog.staff.find((s) => s.id === staffId)!;
    return { appointment: appt, services, stylist };
  }
  throw new BookingError('That time was just taken. Please pick another slot.');
}

export interface UpcomingVisit {
  id: string; start_at: string; end_at: string; status: string;
  staff: { id: string; name: string } | null;
  services: { name: string; price: number; service_id: string | null }[];
}

export async function listUpcoming(db: SupabaseClient, salonId: string, customerId: string, now = new Date()): Promise<UpcomingVisit[]> {
  const { data } = await db
    .from('appointments')
    .select('id, start_at, end_at, status, staff:staff_id(id, name), services:appointment_services(name, price, service_id)')
    .eq('salon_id', salonId)
    .eq('customer_id', customerId)
    .in('status', ['booked', 'confirmed'])
    .gte('start_at', now.toISOString())
    .order('start_at')
    .limit(5);
  return (data ?? []) as unknown as UpcomingVisit[];
}

async function ownedFutureAppointment(db: SupabaseClient, salonId: string, customerId: string, appointmentId: string) {
  const { data } = await db
    .from('appointments')
    .select('id, start_at, end_at, status, staff_id, customer_id, services:appointment_services(service_id)')
    .eq('id', appointmentId).eq('salon_id', salonId).maybeSingle();
  if (!data || data.customer_id !== customerId) throw new BookingError('Booking not found');
  if (!['booked', 'confirmed'].includes(data.status)) throw new BookingError('This booking can no longer be changed');
  if (new Date(data.start_at).getTime() < Date.now()) throw new BookingError('This booking has already started');
  return data as unknown as { id: string; start_at: string; end_at: string; staff_id: string | null; services: { service_id: string | null }[] };
}

export async function cancelBooking(db: SupabaseClient, salonId: string, customerId: string, appointmentId: string, reason: string) {
  await ownedFutureAppointment(db, salonId, customerId, appointmentId);
  const { error } = await db.from('appointments').update({ status: 'cancelled', cancelled_reason: reason }).eq('id', appointmentId);
  if (error) throw new BookingError('Could not cancel. Try again.');
}

export async function rescheduleBooking(
  db: SupabaseClient, catalog: BookingCatalog, customerId: string, appointmentId: string, newStart: string, staffId?: string | null,
) {
  const appt = await ownedFutureAppointment(db, catalog.salon.id, customerId, appointmentId);
  const serviceIds = appt.services.map((s) => s.service_id).filter(Boolean) as string[];
  const startDate = new Date(newStart);
  const date = localDate(startDate, catalog.salon.timezone);
  const slots = await getAvailability(db, catalog, { serviceIds, date, staffId, excludeAppointmentId: appt.id, onlineOnly: true, keepStaffId: appt.staff_id });
  const slot = slots.find((s) => s.start === startDate.toISOString());
  if (!slot) throw new BookingError('That time is not available. Please pick another slot.');
  const ordered = appt.staff_id && slot.staffIds.includes(appt.staff_id)
    ? [appt.staff_id, ...slot.staffIds.filter((id) => id !== appt.staff_id)] // keep the same stylist when possible
    : slot.staffIds;
  for (const id of ordered) {
    const { data, error } = await db.from('appointments')
      .update({ start_at: slot.start, end_at: slot.end, staff_id: id, status: 'booked', reminder_24h_sent_at: null, reminder_2h_sent_at: null })
      .eq('id', appt.id).select('*').single();
    if (!error) return { appointment: data, stylist: catalog.staff.find((s) => s.id === id)! };
    if (error.code !== '23P01') break;
  }
  throw new BookingError('That time was just taken. Please pick another slot.');
}
