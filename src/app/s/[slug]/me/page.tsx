import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { notFound } from 'next/navigation';
import { normalizePhone } from '@/lib/phone';
import { findSiteSalon } from '@/lib/salon-site';
import { salonSiteBase } from '@/lib/site';
import { PortalHome, type PortalBill, type PortalVisit } from '@/components/portal/portal';
import type { ApptStatus, InvoiceStatus } from '@/lib/types';

export const metadata: Metadata = { title: 'Your bookings' };
export const dynamic = 'force-dynamic';

interface ApptRow {
  id: string; salon_id: string; start_at: string; end_at: string; status: ApptStatus; invoice_id: string | null;
  staff_id: string | null;
  services: { name: string; price: number; sort: number }[];
}

// A client's bookings, bills and coins at ONE salon: the salon whose site this is.
// Clients use the same login (their phone) on every salon's site, but each site only shows that salon.
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const site = await findSiteSalon(slug);
  if (!site) notFound();
  const base = await salonSiteBase(slug);

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) redirect(`${base}/me/login`);
  const phone = user.phone && user.phone_confirmed_at ? normalizePhone(user.phone) : null;
  if (!phone) redirect(`${base}/me/login`); // staff accounts (email) have no client bookings

  // Link any client records salons created for this number since the last visit.
  await supabase.rpc('claim_customer_profiles');

  // Read as the client (RLS: their own rows only), and only at this salon.
  const { data: customerRows } = await supabase.from('customers').select('id, name').eq('user_id', user.id).eq('salon_id', site.id);
  const customers = (customerRows ?? []) as { id: string; name: string }[];
  const customerIds = customers.map((c) => c.id);

  const nowIso = new Date().toISOString();
  const [appts, invoices] = customerIds.length ? await Promise.all([
    supabase.from('appointments')
      .select('id, salon_id, start_at, end_at, status, invoice_id, staff_id, services:appointment_services(name, price, sort)')
      .in('customer_id', customerIds).eq('salon_id', site.id).neq('status', 'waiting').order('start_at', { ascending: false }).limit(60),
    supabase.from('invoices').select('id, salon_id, invoice_no, created_at, total, status')
      .in('customer_id', customerIds).eq('salon_id', site.id).order('created_at', { ascending: false }).limit(30),
  ]) : [{ data: [] }, { data: [] }];

  // Clients can't read staff rows (phones, commission); stylist names for their own visits come from the service role.
  const apptRows = (appts.data ?? []) as unknown as ApptRow[];
  const staffIds = [...new Set(apptRows.map((a) => a.staff_id).filter((x): x is string => !!x))];
  const stylists = new Map<string, { name: string; color: string }>();
  if (staffIds.length) {
    const { data: staffRows } = await createAdminClient().from('staff').select('id, name, color').in('id', staffIds).eq('salon_id', site.id);
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

  return (
    <PortalHome
      me={{ name, phone }} nowIso={nowIso} base={base} known={customers.length > 0}
      salon={{
        id: site.id, name: site.name, slug: site.slug, city: site.city, phone: site.phone, timezone: site.timezone,
        hours: site.hours, bookingWindowDays: site.bookingWindowDays, bookingEnabled: site.bookingEnabled,
      }}
      upcoming={upcoming} past={past} bills={bills}
    />
  );
}
