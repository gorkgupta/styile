import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';
import { can, type Permission } from './permissions';
import type { Branch, MemberRole, Salon } from './types';

export const ACTIVE_SALON_COOKIE = 'styile_salon';

export interface SalonContext {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: { id: string; email: string | null; name: string };
  salon: Salon;
  branch: Branch;
  role: MemberRole;
  staffId: string | null;
  memberships: { salon_id: string; name: string; role: MemberRole }[];
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

  const [{ data: memberships }, { data: profile }] = await Promise.all([
    supabase.from('salon_members').select('salon_id, role, staff_id, salons(name)').eq('user_id', user.id),
    supabase.from('profiles').select('full_name, is_platform_admin').eq('id', user.id).maybeSingle(),
  ]);

  if (!memberships?.length) {
    redirect(profile?.is_platform_admin ? '/admin' : '/onboarding');
  }

  const wanted = (await cookies()).get(ACTIVE_SALON_COOKIE)?.value;
  const active = memberships.find((m) => m.salon_id === wanted) ?? memberships[0];

  const [{ data: salon }, { data: branch }] = await Promise.all([
    supabase.from('salons').select('*').eq('id', active.salon_id).single(),
    supabase.from('branches').select('*').eq('salon_id', active.salon_id).eq('is_default', true).single(),
  ]);
  if (!salon || !branch) redirect('/onboarding');

  return {
    supabase,
    user: { id: user.id, email: user.email ?? null, name: profile?.full_name || user.email || 'You' },
    salon: salon as Salon,
    branch: branch as Branch,
    role: active.role as MemberRole,
    staffId: active.staff_id,
    memberships: memberships.map((m) => ({
      salon_id: m.salon_id,
      role: m.role as MemberRole,
      // supabase-js types embedded relations loosely; the FK makes this a single object
      name: (m.salons as unknown as { name: string } | null)?.name ?? 'Salon',
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
