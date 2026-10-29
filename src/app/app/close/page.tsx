import { DayCloseScreen } from '@/components/app/dayclose';
import { requirePermission } from '@/lib/context';
import { can } from '@/lib/permissions';
import { getExpenses, getTeam } from '@/lib/queries';
import { isClosableDate, normalizeClose, normalizeSummary, summaryFromClose } from '@/lib/dayclose';
import { addDays, localDate } from '@/lib/time';

export const metadata = { title: 'Day close' };

export default async function DayClosePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const ctx = await requirePermission('closeDay');
  const sp = await searchParams;
  const tz = ctx.salon.timezone;
  const today = localDate(new Date(), tz);
  const date = isClosableDate(sp.date, today) ? sp.date : today;
  const manageExpenses = can(ctx.role, 'manageExpenses');
  // The front desk sees (and adds) only today's and yesterday's expenses; older days show totals only.
  const expenseMinDate = manageExpenses ? undefined : addDays(today, -1);
  const expensesHidden = !!expenseMinDate && date < expenseMinDate;

  const [closeRes, live, expenses, team, recentRes] = await Promise.all([
    ctx.supabase.from('day_closes').select('*').eq('salon_id', ctx.salon.id).eq('business_date', date).maybeSingle(),
    ctx.supabase.rpc('day_summary', { p_salon: ctx.salon.id, p_date: date }),
    expensesHidden ? Promise.resolve([]) : getExpenses(ctx.supabase, ctx.salon.id, date, date),
    getTeam(ctx.supabase, ctx.salon.id),
    ctx.supabase.from('day_closes').select('business_date, difference').eq('salon_id', ctx.salon.id)
      .gte('business_date', addDays(today, -6)).lte('business_date', today),
  ]);
  if (live.error) throw live.error;
  if (closeRes.error) throw closeRes.error;

  const close = closeRes.data ? normalizeClose(closeRes.data) : null;
  const liveSummary = normalizeSummary(live.data, date);
  const closes = new Map(((recentRes.data ?? []) as { business_date: string; difference: number }[]).map((r) => [r.business_date, Number(r.difference)]));

  return (
    <DayCloseScreen
      salonName={ctx.salon.name}
      date={date}
      today={today}
      tz={tz}
      summary={close ? summaryFromClose(close) : liveSummary}
      close={close}
      liveExpected={close ? liveSummary.totals.expected_cash : null}
      expenses={[...expenses].reverse()}
      expensesHidden={expensesHidden}
      staff={team.map((s) => ({ id: s.id, name: s.name }))}
      recent={Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)).map((d) => ({ date: d, closed: closes.has(d), difference: closes.get(d) ?? null }))}
      canReopen={can(ctx.role, 'reopenDay')}
      canAddExpense={can(ctx.role, 'addExpense')}
      canManageExpenses={manageExpenses}
      expenseMinDate={expenseMinDate}
    />
  );
}
