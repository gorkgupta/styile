import { AppShell } from '@/components/app/shell';
import { getSalonContext } from '@/lib/context';
import { localDate, zonedToUtc, addDays } from '@/lib/time';
import { can } from '@/lib/permissions';
import { I18nRoot } from '@/lib/i18n/root';

export const dynamic = 'force-dynamic';

export default async function SalonLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSalonContext();
  const today = localDate(new Date(), ctx.salon.timezone);
  const [{ count: queueCount }, inbox] = await Promise.all([
    ctx.supabase.from('appointments').select('id', { count: 'exact', head: true })
      .eq('salon_id', ctx.salon.id).eq('status', 'waiting')
      .gte('start_at', zonedToUtc(today, '00:00', ctx.salon.timezone).toISOString())
      .lt('start_at', zonedToUtc(addDays(today, 1), '00:00', ctx.salon.timezone).toISOString()),
    can(ctx.role, 'inbox')
      ? ctx.supabase.from('wa_conversations').select('unread_count').eq('salon_id', ctx.salon.id).gt('unread_count', 0)
      : Promise.resolve({ data: [] as { unread_count: number }[] }),
  ]);
  return (
    <I18nRoot locale={ctx.locale}>
    <AppShell
      salon={{ id: ctx.salon.id, name: ctx.salon.name, slug: ctx.salon.slug, plan_status: ctx.salon.plan_status }}
      user={{ name: ctx.user.name }}
      role={ctx.role}
      memberships={ctx.memberships}
      inboxUnread={((inbox.data ?? []) as { unread_count: number | null }[]).reduce((s, c) => s + (c.unread_count || 0), 0)}
      queueCount={queueCount ?? 0}
      isPlatformAdmin={ctx.isPlatformAdmin}
    >
      {children}
    </AppShell>
    </I18nRoot>
  );
}
