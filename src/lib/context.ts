import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';
import { can, type Permission } from './permissions';
import type { Branch, MemberRole, Salon } from './types';
import { mainUrl, PATH_HEADER, rootDomain, SALON_HEADER, salonUrl } from './tenant';
import { toLocale, type Locale } from './i18n/locales';

export const ACTIVE_SALON_COOKIE = 'styile_salon';

export interface SalonContext {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: { id: string; email: string | null; name: string };
  /** The language this user sees the app in (profiles.locale, English when unset). */
  locale: Locale;
  salon: Salon;
  branch: Branch;
  role: MemberRole;
  staffId: string | null;
  memberships: { salon_id: string; name: string; slug: string; role: MemberRole }[];
  isPlatformAdmin: boolean;
}

/** Signed-in user or redirect to login. */
export const requireUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login');
  return { supabase, user: data.user };
});

/** Everything a salon page needs: who is signed in, which salon is active, their role. Cached per request. */
export const getSalonContext = cache(async (): Promise<SalonContext> => {
  const { supabase, user } = await requireUser();

  const [{ data: membershipRows }, { data: profile }] = await Promise.all([
    supabase.from('salon_members').select('salon_id, role, staff_id, salons(name, slug)').eq('user_id', user.id),
    supabase.from('profiles').select('full_name, is_platform_admin, locale').eq('id', user.id).maybeSingle(),
  ]);

  type MemberRow = { salon_id: string; role: string; staff_id: string | null; salons: unknown };
  const memberships = (membershipRows ?? []) as MemberRow[];
  if (!memberships.length) {
    redirect(mainUrl(profile?.is_platform_admin ? '/admin' : '/onboarding'));
  }
  const slugOf = (m: { salons: unknown }) => (m.salons as { slug?: string } | null)?.slug ?? '';

  // On a salon's own address (glowstudio.styile.com/app) the app is locked to that salon.
  const h = await headers();
  const hostSlug = h.get(SALON_HEADER);
  let active: MemberRow | undefined;
  if (hostSlug) {
    active = memberships.find((m) => slugOf(m) === hostSlug);
    if (!active) redirect(mainUrl(`/app?not_member=${encodeURIComponent(hostSlug)}`));
  } else {
    const wanted = (await cookies()).get(ACTIVE_SALON_COOKIE)?.value;
    active = memberships.find((m) => m.salon_id === wanted) ?? memberships[0];
    // With subdomains on, staff work on their salon's own address.
    if (rootDomain() && slugOf(active)) redirect(salonUrl(slugOf(active), h.get(PATH_HEADER) || '/app'));
  }

  const [{ data: salon }, { data: branch }] = await Promise.all([
    supabase.from('salons').select('*').eq('id', active.salon_id).single(),
    supabase.from('branches').select('*').eq('salon_id', active.salon_id).eq('is_default', true).single(),
  ]);
  if (!salon || !branch) redirect('/onboarding');

  return {
    supabase,
    user: { id: user.id, email: user.email ?? null, name: profile?.full_name || user.email || 'You' },
    locale: toLocale(profile?.locale),
    salon: salon as Salon,
    branch: branch as Branch,
    role: active.role as MemberRole,
    staffId: active.staff_id,
    memberships: memberships.map((m) => ({
      salon_id: m.salon_id,
      role: m.role as MemberRole,
      // supabase-js types embedded relations loosely; the FK makes this a single object
      name: (m.salons as unknown as { name: string } | null)?.name ?? 'Salon',
      slug: slugOf(m),
    })),
    isPlatformAdmin: !!profile?.is_platform_admin,
  };
});

/** Use at the top of a page: sends people without the permission back to the dashboard. */
export async function requirePermission(permission: Permission): Promise<SalonContext> {
  const ctx = await getSalonContext();
  if (!can(ctx.role, permission)) redirect('/app?denied=1');
  return ctx;
}
