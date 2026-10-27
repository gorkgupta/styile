import { ReportsScreen } from '@/components/app/reports';
import { requirePermission } from '@/lib/context';
import { previousRange, resolveRange } from '@/lib/report-range';
import { localDate } from '@/lib/time';
import type { SalonReport } from '@/lib/types';

export const metadata = { title: 'Reports' };

const EMPTY: SalonReport = {
  revenue: 0, collected: 0, tax: 0, bills: 0, avg_bill: 0, new_clients: 0,
  appointments: {}, by_source: {}, by_day: [], by_staff: [], by_service: [], by_method: {},
};

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  const ctx = await requirePermission('viewReports');
  const sp = await searchParams;
  const today = localDate(new Date(), ctx.salon.timezone);
  const range = resolveRange(sp, today);
  const prev = previousRange(range);

  const [cur, before] = await Promise.all([
    ctx.supabase.rpc('salon_report', { p_salon: ctx.salon.id, p_from: range.from, p_to: range.to }),
    ctx.supabase.rpc('salon_report', { p_salon: ctx.salon.id, p_from: prev.from, p_to: prev.to }),
  ]);
  if (cur.error) throw cur.error;

  return (
    <ReportsScreen
      report={{ ...EMPTY, ...((cur.data ?? {}) as Partial<SalonReport>) }}
      previous={before.error || !before.data ? null : { ...EMPTY, ...(before.data as Partial<SalonReport>) }}
      range={range}
      today={today}
      salonName={ctx.salon.name}
    />
  );
}
