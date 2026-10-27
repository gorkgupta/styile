import { QueueBoard } from '@/components/app/queue';
import { requirePermission } from '@/lib/context';
import { can } from '@/lib/permissions';
import { getDayAppointments, getMenu, getTeam } from '@/lib/queries';
import { localDate } from '@/lib/time';

export const metadata = { title: 'Walk-ins' };

export default async function QueuePage() {
  const ctx = await requirePermission('viewCalendar');
  const now = new Date();
  const today = localDate(now, ctx.salon.timezone);
  const [appointments, menu, staff] = await Promise.all([
    getDayAppointments(ctx.supabase, ctx.salon.id, today, ctx.salon.timezone),
    getMenu(ctx.supabase, ctx.salon.id),
    getTeam(ctx.supabase, ctx.salon.id),
  ]);
  return (
    <QueueBoard
      salonId={ctx.salon.id}
      today={today}
      nowIso={now.toISOString()}
      appointments={appointments}
      menu={{ ...menu, staff, tz: ctx.salon.timezone, intervalMin: ctx.salon.slot_interval_min }}
      canBill={can(ctx.role, 'bill')}
    />
  );
}
