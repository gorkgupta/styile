import type { Metadata } from 'next';
import { ResetPasswordForm } from '@/components/public/reset-form';

export const metadata: Metadata = { title: 'Reset password' };

export default async function Page({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  return <ResetPasswordForm code={code} />;
}
