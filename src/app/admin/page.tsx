import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { AdminConsole, type AdminSalonRow } from '@/components/admin/console';
import type { Salon } from '@/lib/types';

export const metadata: Metadata = { title: 'Platform admin', robots: { index: false } };
export const dynamic = 'force-dynamic';

const PAGE = 1000; // PostgREST's default max rows per request

/** Read every row of a (small-column) query, 1,000 at a time, up to a safety cap. */
async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>, cap = 200_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < cap; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export default async function Page() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) notFound();
  const { data: profile } = await supabase.from('profiles').select('is_platform_admin, full_name, email').eq('id', auth.user.id).maybeSingle();
  if (!profile?.is_platform_admin) notFound();

  const db = createAdminClient();
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const [salons, owners, staff, appts, hasMembership] = await Promise.all([
    readAll<Pick<Salon, 'id' | 'name' | 'slug' | 'city' | 'plan' | 'plan_status' | 'trial_ends_at' | 'wa_phone_number_id' | 'wa_business_account_id' | 'wa_display_number' | 'booking_enabled' | 'gst_mode' | 'gstin' | 'created_at'>>(
      (a, b) => db.from('salons').select('id, name, slug, city, plan, plan_status, trial_ends_at, wa_phone_number_id, wa_business_account_id, wa_display_number, booking_enabled, gst_mode, gstin, created_at').order('created_at', { ascending: false }).range(a, b)),
    readOwners(),
    readAll<{ salon_id: string }>((a, b) => db.from('staff').select('salon_id').eq('active', true).range(a, b)),
    readAll<{ salon_id: string; source: string }>((a, b) => db.from('appointments').select('salon_id, source').gte('created_at', since).neq('status', 'waiting').range(a, b)),
    db.from('salon_members').select('salon_id', { count: 'exact', head: true }).eq('user_id', auth.user.id),
  ]);

  // Owner emails live on profiles; salon_members.user_id references auth.users (no FK to profiles), so join by hand.
  async function readOwners() {
    const members = await readAll<{ salon_id: string; user_id: string }>((a, b) => db.from('salon_members').select('salon_id, user_id').eq('role', 'owner').range(a, b));
    const ids = [...new Set(members.map((m) => m.user_id))];
    const profiles = new Map<string, { email: string | null; full_name: string | null }>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await db.from('profiles').select('id, email, full_name').in('id', ids.slice(i, i + 200));
      for (const p of (data ?? []) as { id: string; email: string | null; full_name: string | null }[]) profiles.set(p.id, { email: p.email, full_name: p.full_name });
    }
    return members.map((m) => ({ salon_id: m.salon_id, profile: profiles.get(m.user_id) ?? null }));
  }

  const ownerBySalon = new Map<string, { email: string | null; name: string | null }>();
  for (const o of owners) if (!ownerBySalon.has(o.salon_id)) ownerBySalon.set(o.salon_id, { email: o.profile?.email ?? null, name: o.profile?.full_name ?? null });
  const staffCount = new Map<string, number>();
  for (const s of staff) staffCount.set(s.salon_id, (staffCount.get(s.salon_id) ?? 0) + 1);
  const bookings = new Map<string, { total: number; whatsapp: number }>();
  for (const a of appts) {
    const b = bookings.get(a.salon_id) ?? { total: 0, whatsapp: 0 };
    b.total += 1;
    if (a.source === 'whatsapp') b.whatsapp += 1;
    bookings.set(a.salon_id, b);
  }

  const rows: AdminSalonRow[] = salons.map((s) => ({
    id: s.id, name: s.name, slug: s.slug, city: s.city, plan: s.plan, status: s.plan_status, trialEndsAt: s.trial_ends_at,
    ownerEmail: ownerBySalon.get(s.id)?.email ?? null, ownerName: ownerBySalon.get(s.id)?.name ?? null,
    staffCount: staffCount.get(s.id) ?? 0,
    bookings30d: bookings.get(s.id)?.total ?? 0, whatsapp30d: bookings.get(s.id)?.whatsapp ?? 0,
    wa: s.wa_phone_number_id ? { phoneNumberId: s.wa_phone_number_id, businessAccountId: s.wa_business_account_id ?? '', displayNumber: s.wa_display_number ?? '' } : null,
    bookingEnabled: s.booking_enabled, createdAt: s.created_at, gstMode: s.gst_mode ?? 'unregistered', gstin: s.gstin ?? null,
  }));

  return <AdminConsole salons={rows} nowIso={new Date().toISOString()} adminName={profile.full_name || profile.email || 'Admin'} hasSalon={(hasMembership.count ?? 0) > 0} />;
}
