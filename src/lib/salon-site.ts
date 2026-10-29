import 'server-only';
import { cache } from 'react';
import { createAdminClient } from './supabase/admin';
import { isReservedSlug, SLUG_RE } from './tenant';
import type { Hours } from './types';
import { toLocale, type Locale } from './i18n/locales';

export interface SiteSalon {
  id: string; name: string; slug: string; city: string | null; phone: string | null; timezone: string;
  bookingWindowDays: number; bookingEnabled: boolean; hours: Hours | null; brandColor: string;
  /** Language of the client pages unless the visitor picks another (0015). */
  defaultLocale: Locale;
}

/**
 * Public details of the salon behind a site address (subdomain or /s/<slug>), or null if there is no such
 * live salon. Read with the service role: anonymous visitors have no table access. Only public fields.
 */
export const findSiteSalon = cache(async (slug: string): Promise<SiteSalon | null> => {
  if (!SLUG_RE.test(slug) || isReservedSlug(slug)) return null;
  const db = createAdminClient();
  const { data } = await db.from('salons')
    .select('id, name, slug, city, phone, timezone, booking_window_days, booking_enabled, plan_status, brand_color, default_locale')
    .eq('slug', slug).maybeSingle();
  if (!data || ['suspended', 'cancelled'].includes(data.plan_status)) return null;
  const { data: branch } = await db.from('branches').select('business_hours').eq('salon_id', data.id).eq('is_default', true).maybeSingle();
  return {
    id: data.id, name: data.name, slug: data.slug, city: data.city, phone: data.phone, timezone: data.timezone,
    bookingWindowDays: data.booking_window_days, bookingEnabled: data.booking_enabled, brandColor: data.brand_color,
    hours: (branch?.business_hours as Hours | undefined) ?? null,
    defaultLocale: toLocale(data.default_locale),
  };
});
