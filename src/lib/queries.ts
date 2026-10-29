import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, zonedToUtc } from './time';
import type { AppointmentFull, ClientMembership, ClientPackage, Service, ServiceCategory, Staff } from './types';
import { advanceLeft, normalizeAdvance } from './events';
import { activeMembership, CLIENT_PACKAGE_SELECT, normalizeClientPackage, normalizeMembership, packageState } from './packages';
import type { Expense, ExpenseRow } from './dayclose';

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
  return ((data ?? []) as { services?: { sort: number }[] }[]).map((a) => ({
    ...a,
    services: [...(a.services ?? [])].sort((x, y) => x.sort - y.sort),
  })) as unknown as AppointmentFull[];
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

/** Expenses between two salon-local dates (inclusive), newest first, with the advance taker's and the adder's names. */
export async function getExpenses(db: SupabaseClient, salonId: string, from: string, to: string): Promise<ExpenseRow[]> {
  const { data, error } = await db.from('expenses').select('*, staff:staff_id(name)')
    .eq('salon_id', salonId).gte('spent_on', from).lte('spent_on', to)
    .order('spent_on', { ascending: false }).order('created_at', { ascending: false }).limit(1000);
  if (error) throw error;
  const rows = (data ?? []) as (Expense & { staff: { name: string } | null })[];
  const names = await memberNames(db, salonId, rows.map((r) => r.created_by));
  return rows.map(({ staff, ...e }) => ({
    ...e, amount: Number(e.amount), staff_name: staff?.name ?? null, created_by_name: e.created_by ? names.get(e.created_by) ?? null : null,
  }));
}

/** Display names for logins in this salon: their staff record's name, else their profile name. */
export async function memberNames(db: SupabaseClient, salonId: string, userIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const [staff, profiles] = await Promise.all([
    db.from('staff').select('user_id, name').eq('salon_id', salonId).in('user_id', ids),
    db.from('profiles').select('id, full_name').in('id', ids),
  ]);
  for (const p of (profiles.data ?? []) as { id: string; full_name: string | null }[]) if (p.full_name) out.set(p.id, p.full_name);
  for (const s of (staff.data ?? []) as { user_id: string; name: string }[]) out.set(s.user_id, s.name);
  return out;
}

/** A client's packages with sessions left today and their membership card valid today (for the POS). */
export async function getClientBenefits(db: SupabaseClient, salonId: string, customerId: string, today: string): Promise<{ packages: ClientPackage[]; membership: ClientMembership | null; advance: { left: number; receipts: string[] } }> {
  const [pk, mem, adv] = await Promise.all([
    db.from('client_packages').select(CLIENT_PACKAGE_SELECT).eq('salon_id', salonId).eq('customer_id', customerId)
      .eq('status', 'active').gte('expires_on', today).order('expires_on'),
    db.from('client_memberships').select('*').eq('salon_id', salonId).eq('customer_id', customerId)
      .eq('status', 'active').lte('starts_on', today).gte('ends_on', today),
    // Advances (front desk and above can read them; for others this is simply empty).
    db.from('advance_payments').select('receipt_no, amount, applied_amount, refund_amount').eq('salon_id', salonId).eq('customer_id', customerId).order('received_at'),
  ]);
  if (pk.error) throw pk.error;
  if (mem.error) throw mem.error;
  const open = ((adv.data ?? []) as unknown[]).map(normalizeAdvance).filter((a) => advanceLeft(a) > 0);
  return {
    packages: ((pk.data ?? []) as unknown[]).map(normalizeClientPackage).filter((p) => packageState(p, today) === 'active'),
    membership: activeMembership(((mem.data ?? []) as unknown[]).map(normalizeMembership), today),
    advance: { left: Math.round(open.reduce((s, a) => s + advanceLeft(a), 0) * 100) / 100, receipts: open.map((a) => a.receipt_no) },
  };
}

/** Every package and card a client has had at this salon, newest first (client profile). */
export async function getClientPackagesAndCards(db: SupabaseClient, salonId: string, customerId: string): Promise<{ packages: ClientPackage[]; memberships: ClientMembership[] }> {
  const [pk, mem] = await Promise.all([
    db.from('client_packages').select(CLIENT_PACKAGE_SELECT).eq('salon_id', salonId).eq('customer_id', customerId).order('purchased_at', { ascending: false }).limit(50),
    db.from('client_memberships').select('*').eq('salon_id', salonId).eq('customer_id', customerId).order('ends_on', { ascending: false }).limit(20),
  ]);
  if (pk.error) throw pk.error;
  if (mem.error) throw mem.error;
  return { packages: ((pk.data ?? []) as unknown[]).map(normalizeClientPackage), memberships: ((mem.data ?? []) as unknown[]).map(normalizeMembership) };
}
