import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SignupForm } from '@/components/public/auth-forms';

export const metadata: Metadata = { title: 'Start your free trial' };

export default async function Page() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect('/onboarding');
  return <SignupForm />;
}
