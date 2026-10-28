import { ReportsScreen } from '@/components/app/reports';
import { requirePermission } from '@/lib/context';
import { previousRange, resolveRange } from '@/lib/report-range';
import { localDate } from '@/lib/time';
import type { SalonReport } from '@/lib/types';
import { normalizeExpenseReport } from '@/lib/dayclose';

export const metadata = { title: 'Reports' };

const EMPTY: SalonReport = {
  revenue: 0, collected: 0, tax: 0, composition_tax: 0, fy_turnover: 0, fy_from: '', bills: 0, avg_bill: 0, new_clients: 0,
  appointments: {}, by_source: {}, by_day: [], by_staff: [], by_service: [], by_method: {},
  coins_sold: 0, coins_bonus: 0, coins_redeemed: 0, coins_outstanding: 0,
  packages_sold: 0, packages_sold_amount: 0, packages_refunded: 0, package_sessions_redeemed: 0, package_redeemed_value: 0,
  package_sessions_outstanding: 0, package_outstanding_value: 0, memberships_sold: 0, memberships_amount: 0, member_discounts: 0, active_members: 0,
  advances_received: 0, advances_applied: 0, advances_refunded: 0, advances_outstanding: 0, events_in_range: 0, events_upcoming: 0,
};

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  const ctx = await requirePermission('viewReports');
  const sp = await searchParams;
  const today = localDate(new Date(), ctx.salon.timezone);
  const range = resolveRange(sp, today);
  const prev = previousRange(range);

  const [cur, before, spent] = await Promise.all([
    ctx.supabase.rpc('salon_report', { p_salon: ctx.salon.id, p_from: range.from, p_to: range.to }),
    ctx.supabase.rpc('salon_report', { p_salon: ctx.salon.id, p_from: prev.from, p_to: prev.to }),
    ctx.supabase.rpc('expense_report', { p_salon: ctx.salon.id, p_from: range.from, p_to: range.to }),
  ]);
  if (cur.error) throw cur.error;

  return (
    <ReportsScreen
      report={{ ...EMPTY, ...((cur.data ?? {}) as Partial<SalonReport>) }}
      previous={before.error || !before.data ? null : { ...EMPTY, ...(before.data as Partial<SalonReport>) }}
      range={range}
      today={today}
      salonName={ctx.salon.name}
      gstMode={ctx.salon.gst_mode}
      expenses={spent.error ? null : normalizeExpenseReport(spent.data)}
    />
  );
}
