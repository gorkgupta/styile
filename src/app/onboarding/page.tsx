import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/context';
import { env } from '@/lib/env';
import { OnboardingForm } from '@/components/public/auth-forms';

export const metadata: Metadata = { title: 'Set up your salon' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const { supabase, user } = await requireUser();
  const [{ data: memberships }, { data: profile }] = await Promise.all([
    supabase.from('salon_members').select('salon_id').eq('user_id', user.id).limit(1),
    supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
  ]);
  if (memberships?.length) redirect('/app');
  const meta = (user.user_metadata ?? {}) as { full_name?: string; name?: string };
  const ownerName = profile?.full_name || meta.full_name || meta.name || '';
  let appHost = '';
  try { appHost = new URL(env.appUrl()).host; } catch { appHost = ''; }
  return <OnboardingForm ownerName={ownerName} appHost={appHost} />;
}
