import { CalendarBoard } from '@/components/app/calendar';
import { requirePermission } from '@/lib/context';
import { can } from '@/lib/permissions';
import { getDayAppointments, getMenu, getTeam } from '@/lib/queries';
import { isValidDateStr, localDate } from '@/lib/time';

export const metadata = { title: 'Calendar' };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const ctx = await requirePermission('viewCalendar');
  const { date: q } = await searchParams;
  const now = new Date();
  const today = localDate(now, ctx.salon.timezone);
  const date = isValidDateStr(q) ? q : today;
  const [appointments, menu, staff] = await Promise.all([
    getDayAppointments(ctx.supabase, ctx.salon.id, date, ctx.salon.timezone),
    getMenu(ctx.supabase, ctx.salon.id),
    getTeam(ctx.supabase, ctx.salon.id),
  ]);
  return (
    <CalendarBoard
      salonId={ctx.salon.id}
      date={date}
      today={today}
      nowIso={now.toISOString()}
      branchHours={ctx.branch.business_hours}
      appointments={appointments}
      menu={{ ...menu, staff, tz: ctx.salon.timezone, intervalMin: ctx.salon.slot_interval_min }}
      canBill={can(ctx.role, 'bill')}
      myStaffId={ctx.role === 'stylist' ? ctx.staffId : null}
    />
  );
}
