import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PortalLogin } from '@/components/portal/portal-login';
import { safeNextPath } from '@/lib/safe-next';

export const metadata: Metadata = { title: 'Your bookings' };

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user?.phone) redirect(safeNextPath(next)?.startsWith('/me') ? next! : '/me');
  return <PortalLogin next={next} />;
}
