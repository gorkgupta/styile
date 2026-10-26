import { SettingsScreen } from '@/components/app/settings';
import { requirePermission } from '@/lib/context';

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const ctx = await requirePermission('settings');
  return (
    <SettingsScreen
      salon={ctx.salon}
      hours={ctx.branch.business_hours}
      supportEmail={process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@styile.com'}
    />
  );
}
