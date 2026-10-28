import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PortalLogin } from '@/components/portal/portal-login';
import { safeNextPath } from '@/lib/safe-next';
import { findSiteSalon } from '@/lib/salon-site';
import { salonSiteBase } from '@/lib/site';
import { I18nRoot } from '@/lib/i18n/root';
import { siteLocale } from '@/lib/i18n/server';

export const metadata: Metadata = { title: 'Your bookings' };

export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ next?: string; lang?: string | string[] }> }) {
  const [{ slug }, { next, lang }] = await Promise.all([params, searchParams]);
  const site = await findSiteSalon(slug);
  if (!site) notFound();
  const base = await salonSiteBase(slug);
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user?.phone && data.user.phone_confirmed_at) redirect(safeNextPath(next) ?? `${base}/me`);
  return <I18nRoot locale={await siteLocale(site.defaultLocale, lang)}><PortalLogin next={next} base={base} salonName={site.name} /></I18nRoot>;
}
