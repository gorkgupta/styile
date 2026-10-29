import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { notFound } from 'next/navigation';
import { phoneFromAuth } from '@/lib/phone';
import { findSiteSalon } from '@/lib/salon-site';
import { salonSiteBase } from '@/lib/site';
import { PortalHome, type PortalBill, type PortalVisit } from '@/components/portal/portal';
import { shownOnline } from '@/lib/stylists';
import type { CoinRow } from '@/components/app/coin-history';
import type { ApptStatus, InvoiceStatus } from '@/lib/types';
import { activeMembership, CLIENT_PACKAGE_SELECT, membershipState, normalizeClientPackage, normalizeMembership, packageState } from '@/lib/packages';
import { localDate } from '@/lib/time';

export const metadata: Metadata = { title: 'Your bookings' };
export const dynamic = 'force-dynamic';

interface ApptRow {
  id: string; salon_id: string; start_at: string; end_at: string; status: ApptStatus; invoice_id: string | null;
  staff_id: string | null;
  services: { name: string; price: number; sort: number; service_id: string | null }[];
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
  const phone = user.phone && user.phone_confirmed_at ? phoneFromAuth(user.phone) : null;
  if (!phone) redirect(`${base}/me/login`); // staff accounts (email) have no client bookings

  // Link any client records salons created for this number since the last visit.
  await supabase.rpc('claim_customer_profiles');

  // Read as the client (RLS: their own rows only), and only at this salon.
  const { data: customerRows } = await supabase.from('customers').select('id, name, coin_balance').eq('user_id', user.id).eq('salon_id', site.id);
  const customers = (customerRows ?? []) as { id: string; name: string; coin_balance: number }[];
  const customerIds = customers.map((c) => c.id);

  const nowIso = new Date().toISOString();
  const [appts, invoices, coinTx, pkgs, cards] = customerIds.length ? await Promise.all([
    supabase.from('appointments')
      .select('id, salon_id, start_at, end_at, status, invoice_id, staff_id, services:appointment_services(name, price, sort, service_id)')
      .in('customer_id', customerIds).eq('salon_id', site.id).neq('status', 'waiting').order('start_at', { ascending: false }).limit(60),
    supabase.from('invoices').select('id, salon_id, invoice_no, created_at, total, status')
      .in('customer_id', customerIds).eq('salon_id', site.id).order('created_at', { ascending: false }).limit(30),
    // Coins bought here can only be spent here, so only this salon's ledger is shown.
    supabase.from('coin_transactions').select('id, kind, coins, balance_after, amount_paid, method, invoice_id, note, created_at, invoice:invoices(invoice_no)')
      .in('customer_id', customerIds).eq('salon_id', site.id).order('created_at', { ascending: false }).limit(10),
    // Packages and membership cards bought here (RLS: the client's own only).
    supabase.from('client_packages').select(CLIENT_PACKAGE_SELECT).in('customer_id', customerIds).eq('salon_id', site.id).order('expires_on').limit(20),
    supabase.from('client_memberships').select('*').in('customer_id', customerIds).eq('salon_id', site.id).order('ends_on', { ascending: false }).limit(5),
  ]) : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }];

  // Clients can't read staff rows (phones, commission); stylist names and photos for their own visits come from the
  // service role, and only public fields are passed on.
  const apptRows = (appts.data ?? []) as unknown as ApptRow[];
  const staffIds = [...new Set(apptRows.map((a) => a.staff_id).filter((x): x is string => !!x))];
  const stylists = new Map<string, NonNullable<PortalVisit['stylist']>>();
  if (staffIds.length) {
    const { data: staffRows } = await createAdminClient().from('staff')
      .select('id, name, color, photo_url, active, bookable, show_on_booking').in('id', staffIds).eq('salon_id', site.id);
    type Row = { id: string; name: string; color: string; photo_url: string | null; active: boolean; bookable: boolean; show_on_booking: boolean };
    for (const s of (staffRows ?? []) as Row[]) {
      stylists.set(s.id, { id: s.id, name: s.name, color: s.color, photoUrl: s.photo_url, bookable: shownOnline(s) });
    }
  }

  const visits: PortalVisit[] = apptRows.map((a) => ({
    id: a.id, salonId: a.salon_id, start_at: a.start_at, end_at: a.end_at, status: a.status, invoiceId: a.invoice_id,
    stylist: (a.staff_id && stylists.get(a.staff_id)) || null, services: [...(a.services ?? [])].sort((x, y) => x.sort - y.sort).map((s) => ({ name: s.name, price: Number(s.price) })),
    serviceIds: [...(a.services ?? [])].sort((x, y) => x.sort - y.sort).map((s) => s.service_id).filter((x): x is string => !!x),
  }));
  const now = Date.now();
  const upcoming = visits.filter((v) => ['booked', 'confirmed'].includes(v.status) && new Date(v.start_at).getTime() > now).reverse();
  const upcomingIds = new Set(upcoming.map((v) => v.id));
  const past = visits.filter((v) => !upcomingIds.has(v.id)).slice(0, 20); // newest first; includes cancelled ones

  const bills: PortalBill[] = ((invoices.data ?? []) as { id: string; salon_id: string; invoice_no: string; created_at: string; total: number; status: InvoiceStatus }[])
    .filter((b) => b.status !== 'void')
    .map((b) => ({ id: b.id, salonId: b.salon_id, invoice_no: b.invoice_no, created_at: b.created_at, total: Number(b.total), status: b.status }));

  type RawCoin = Omit<CoinRow, 'invoice_no' | 'reference'> & { invoice: { invoice_no: string } | null };
  const coinHistory: CoinRow[] = ((coinTx.data ?? []) as unknown as RawCoin[]).map(({ invoice, ...t }) => ({
    ...t, reference: null, coins: Number(t.coins), balance_after: Number(t.balance_after),
    amount_paid: t.amount_paid == null ? null : Number(t.amount_paid), invoice_no: invoice?.invoice_no ?? null,
  }));
  const coinBalance = customers.reduce((s, c) => s + Number(c.coin_balance ?? 0), 0);
  const today = localDate(new Date(), site.timezone);
  const packages = (pkgs.data ?? []).map(normalizeClientPackage).filter((p) => packageState(p, today) === 'active');
  const allCards = (cards.data ?? []).map(normalizeMembership);
  const membership = activeMembership(allCards, today) ?? allCards.find((m) => membershipState(m, today) === 'upcoming') ?? null;

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
      coins={{ balance: coinBalance, history: coinHistory }}
      packages={packages} membership={membership} today={today}
    />
  );
}
