import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { LoginForm } from '@/components/public/auth-forms';
import { safeNextPath } from '@/lib/safe-next';
import { hostSalonSlug } from '@/lib/site';
import { findSiteSalon } from '@/lib/salon-site';

export const metadata: Metadata = { title: 'Log in' };

function safeNext(n: string | undefined) {
  return safeNextPath(n) ?? undefined;
}

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user && !data.user.phone) redirect(next ?? '/app');
  const hostSlug = await hostSalonSlug();
  const salon = hostSlug ? await findSiteSalon(hostSlug) : null;
  return <LoginForm next={next} salonName={salon?.name} notice={sp.reset === '1' ? 'Your password was changed. Log in with the new one.' : undefined} />;
}
