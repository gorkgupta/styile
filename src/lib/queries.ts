import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, zonedToUtc } from './time';
import type { AppointmentFull, Service, ServiceCategory, Staff } from './types';

const APPT_SELECT = '*, customer:customers(id, name, phone, visit_count, notes), services:appointment_services(service_id, name, price, duration_min, sort)';

/** All appointments (incl. walk-ins) whose start falls on a salon-local day. */
export async function getDayAppointments(db: SupabaseClient, salonId: string, date: string, tz: string): Promise<AppointmentFull[]> {
  const { data, error } = await db
    .from('appointments')
    .select(APPT_SELECT)
    .eq('salon_id', salonId)
    .gte('start_at', zonedToUtc(date, '00:00', tz).toISOString())
    .lt('start_at', zonedToUtc(addDays(date, 1), '00:00', tz).toISOString())
    .order('start_at');
  if (error) throw error;
  return (data ?? []).map((a) => ({
    ...a,
    services: [...(a.services ?? [])].sort((x: { sort: number }, y: { sort: number }) => x.sort - y.sort),
  })) as AppointmentFull[];
}

export async function getMenu(db: SupabaseClient, salonId: string): Promise<{ services: Service[]; categories: ServiceCategory[] }> {
  const [s, c] = await Promise.all([
    db.from('services').select('*').eq('salon_id', salonId).eq('active', true).order('sort').order('name'),
    db.from('service_categories').select('*').eq('salon_id', salonId).order('sort').order('name'),
  ]);
  return { services: (s.data ?? []) as Service[], categories: (c.data ?? []) as ServiceCategory[] };
}

export async function getTeam(db: SupabaseClient, salonId: string, includeInactive = false): Promise<Staff[]> {
  let q = db.from('staff').select('*').eq('salon_id', salonId).order('sort').order('name');
  if (!includeInactive) q = q.eq('active', true);
  const { data } = await q;
  return (data ?? []) as Staff[];
}
