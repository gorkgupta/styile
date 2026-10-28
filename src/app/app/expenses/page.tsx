import { ExpensesScreen } from '@/components/app/expenses';
import { requirePermission } from '@/lib/context';
import { can } from '@/lib/permissions';
import { getExpenses, getTeam } from '@/lib/queries';
import { isValidMonth, monthRange } from '@/lib/dayclose';
import { addDays, localDate } from '@/lib/time';

export const metadata = { title: 'Expenses' };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ month?: string; category?: string }> }) {
  const ctx = await requirePermission('addExpense');
  const sp = await searchParams;
  const today = localDate(new Date(), ctx.salon.timezone);
  const thisMonth = today.slice(0, 7);
  const manage = can(ctx.role, 'manageExpenses');
  const month = manage && isValidMonth(sp.month) && sp.month <= thisMonth ? sp.month : thisMonth;
  // The front desk sees today's and yesterday's expenses (the database allows no more).
  const range = manage ? monthRange(month) : { from: addDays(today, -1), to: today };

  const [expenses, team] = await Promise.all([
    getExpenses(ctx.supabase, ctx.salon.id, range.from, range.to),
    getTeam(ctx.supabase, ctx.salon.id),
  ]);

  return (
    <ExpensesScreen
      month={month}
      thisMonth={thisMonth}
      today={today}
      expenses={expenses}
      staff={team.map((s) => ({ id: s.id, name: s.name }))}
      canManage={manage}
      deskOnly={!manage}
      expenseMinDate={manage ? undefined : addDays(today, -1)}
      initialCategory={sp.category}
    />
  );
}
