import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { LoginForm } from '@/components/public/auth-forms';
import { safeNextPath } from '@/lib/safe-next';

export const metadata: Metadata = { title: 'Log in' };

function safeNext(n: string | undefined) {
  return safeNextPath(n) ?? undefined;
}

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect(next ?? '/app');
  return <LoginForm next={next} notice={sp.reset === '1' ? 'Your password was changed. Log in with the new one.' : undefined} />;
}
