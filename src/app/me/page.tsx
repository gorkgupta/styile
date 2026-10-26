import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizePhone } from '@/lib/phone';
import { PortalHome, type PortalBill, type PortalSalon, type PortalVisit } from '@/components/portal/portal';
import type { ApptStatus, Hours, InvoiceStatus } from '@/lib/types';

export const metadata: Metadata = { title: 'Your bookings' };
export const dynamic = 'force-dynamic';

interface ApptRow {
  id: string; salon_id: string; start_at: string; end_at: string; status: ApptStatus; invoice_id: string | null;
  staff_id: string | null;
  services: { name: string; price: number; sort: number }[];
}

export default async function Page() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) redirect('/me/login');
  const phone = user.phone ? normalizePhone(user.phone) : null;
  if (!phone) redirect('/me/login'); // staff accounts (email) have no client bookings

  // Link any client records a salon created for this number since the last visit.
  await supabase.rpc('claim_customer_profiles');

  // Everything below is read as the client: RLS limits it to their own rows.
  const { data: customerRows } = await supabase.from('customers')
    .select('id, salon_id, name, salon:salons(id, name, slug, city, phone, timezone, booking_window_days, booking_enabled, plan_status)')
    .eq('user_id', user.id);
  const customers = (customerRows ?? []) as unknown as {
    id: string; salon_id: string; name: string;
    salon: { id: string; name: string; slug: string; city: string | null; phone: string | null; timezone: string; booking_window_days: number; booking_enabled: boolean; plan_status: string } | null;
  }[];
  const customerIds = customers.map((c) => c.id);
  const salonIds = [...new Set(customers.map((c) => c.salon_id))];

  // Clients can't read branches through RLS; opening hours (for the date strip) come from the service role,
  // limited to the salons this user is already a client of.
  const hoursBySalon = new Map<string, Hours>();
  if (salonIds.length) {
    const { data: branches } = await createAdminClient().from('branches').select('salon_id, business_hours').in('salon_id', salonIds).eq('is_default', true);
    for (const b of (branches ?? []) as { salon_id: string; business_hours: Hours }[]) hoursBySalon.set(b.salon_id, b.business_hours);
  }

  const nowIso = new Date().toISOString();
  const [appts, invoices] = customerIds.length ? await Promise.all([
    supabase.from('appointments')
      .select('id, salon_id, start_at, end_at, status, invoice_id, staff_id, services:appointment_services(name, price, sort)')
      .in('customer_id', customerIds).neq('status', 'waiting').order('start_at', { ascending: false }).limit(60),
    supabase.from('invoices').select('id, salon_id, invoice_no, created_at, total, status')
      .in('customer_id', customerIds).order('created_at', { ascending: false }).limit(30),
  ]) : [{ data: [] }, { data: [] }];

  const salons: PortalSalon[] = customers.filter((c) => c.salon).map((c) => ({
    id: c.salon!.id, name: c.salon!.name, slug: c.salon!.slug, city: c.salon!.city, phone: c.salon!.phone, timezone: c.salon!.timezone,
    hours: hoursBySalon.get(c.salon_id) ?? null, bookingWindowDays: c.salon!.booking_window_days,
    bookingEnabled: c.salon!.booking_enabled && !['suspended', 'cancelled'].includes(c.salon!.plan_status),
  }));

  // Clients can't read staff rows (phones, commission); stylist names for their own visits come from the service role.
  const apptRows = (appts.data ?? []) as unknown as ApptRow[];
  const staffIds = [...new Set(apptRows.map((a) => a.staff_id).filter((x): x is string => !!x))];
  const stylists = new Map<string, { name: string; color: string }>();
  if (staffIds.length) {
    const { data: staffRows } = await createAdminClient().from('staff').select('id, name, color').in('id', staffIds).in('salon_id', salonIds);
    for (const s of (staffRows ?? []) as { id: string; name: string; color: string }[]) stylists.set(s.id, { name: s.name, color: s.color });
  }

  const visits: PortalVisit[] = apptRows.map((a) => ({
    id: a.id, salonId: a.salon_id, start_at: a.start_at, end_at: a.end_at, status: a.status, invoiceId: a.invoice_id,
    stylist: (a.staff_id && stylists.get(a.staff_id)) || null, services: [...(a.services ?? [])].sort((x, y) => x.sort - y.sort).map((s) => ({ name: s.name, price: Number(s.price) })),
  }));
  const now = Date.now();
  const upcoming = visits.filter((v) => ['booked', 'confirmed'].includes(v.status) && new Date(v.start_at).getTime() > now).reverse();
  const upcomingIds = new Set(upcoming.map((v) => v.id));
  const past = visits.filter((v) => !upcomingIds.has(v.id)).slice(0, 20); // newest first; includes cancelled ones

  const bills: PortalBill[] = ((invoices.data ?? []) as { id: string; salon_id: string; invoice_no: string; created_at: string; total: number; status: InvoiceStatus }[])
    .filter((b) => b.status !== 'void')
    .map((b) => ({ id: b.id, salonId: b.salon_id, invoice_no: b.invoice_no, created_at: b.created_at, total: Number(b.total), status: b.status }));

  const meta = (user.user_metadata ?? {}) as { full_name?: string };
  const name = customers.find((c) => c.name && c.name !== phone)?.name ?? meta.full_name ?? '';

  return <PortalHome me={{ name, phone }} nowIso={nowIso} salons={salons} upcoming={upcoming} past={past} bills={bills} />;
}
