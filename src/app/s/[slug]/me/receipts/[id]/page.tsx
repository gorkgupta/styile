import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { phoneFromAuth } from '@/lib/phone';
import { findSiteSalon } from '@/lib/salon-site';
import { salonSiteBase } from '@/lib/site';
import { I18nRoot } from '@/lib/i18n/root';
import { siteLocale } from '@/lib/i18n/server';
import { AdvanceReceiptView } from '@/components/portal/advance-receipt';
import { normalizeAdvance } from '@/lib/events';
import type { EventType, GstMode } from '@/lib/types';

export const metadata: Metadata = { title: 'Advance receipt' };
export const dynamic = 'force-dynamic';

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The client's advance receipt. RLS: a client reads only their own advances; anything else is a 404.
export default async function Page({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ lang?: string | string[] }> }) {
  const { slug, id } = await params;
  const site = await findSiteSalon(slug);
  if (!site) notFound();
  const base = await salonSiteBase(slug);
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect(`${base}/me/login?next=${encodeURIComponent(`${base}/me/receipts/${id}`)}`);
  if (!ID_RE.test(id)) notFound();
  if (auth.user.phone) await supabase.rpc('claim_customer_profiles');

  const { data } = await supabase.from('advance_payments')
    .select('*, customer:customers(name, phone), event:events(title, event_at, event_type), salon:salons(name, gst_mode, gstin, address, city, phone, timezone, advance_policy)')
    .eq('id', id).eq('salon_id', site.id).maybeSingle();
  if (!data) notFound();
  const row = data as unknown as {
    customer: { name: string; phone: string }; event: { title: string; event_at: string; event_type: EventType } | null;
    salon: { name: string; gst_mode: GstMode; gstin: string | null; address: string | null; city: string | null; phone: string | null; timezone: string; advance_policy: string | null } | null;
  };
  if (!row.salon) notFound();
  return (
    <I18nRoot locale={await siteLocale(site.defaultLocale, (await searchParams).lang)}>
    <AdvanceReceiptView advance={normalizeAdvance(data)} customer={row.customer} event={row.event} base={base}
      phone={phoneFromAuth(auth.user.phone) ?? undefined}
      salon={{ name: row.salon.name, gstMode: row.salon.gst_mode, gstin: row.salon.gstin, address: [row.salon.address, row.salon.city].filter(Boolean).join(', ') || null,
        phone: row.salon.phone, policy: row.salon.advance_policy, timezone: row.salon.timezone }} />
    </I18nRoot>
  );
}
