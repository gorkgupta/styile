import type { ReactNode } from 'react';
import { DayCloseScreen, type DayCloseProps } from '../../src/components/app/dayclose';
import { ExpensesScreen } from '../../src/components/app/expenses';
import { ReportsScreen } from '../../src/components/app/reports';
import { TodayView } from '../../src/components/app/today';
import { appointments, menu, NOW_ISO, report as baseReport, salon, TODAY, TZ } from '../data';
import { coinReport } from '../coins-data';
import { closedDay, daySummary, dayStaff, expenseReport, monthExpenses, recentDays, todaysExpenses } from '../dayclose-data';

const base: DayCloseProps = {
  salonName: salon.name, date: TODAY, today: TODAY, tz: TZ, summary: daySummary, close: null, liveExpected: null,
  expenses: todaysExpenses, staff: dayStaff, recent: recentDays, canReopen: true, canAddExpense: true, canManageExpenses: true,
};
const recentClosed = recentDays.map((d) => (d.date === TODAY ? { ...d, closed: true, difference: -80 } : d));

export const screens: Record<string, { title: string; render: () => ReactNode }> = {
  '/app/close': { title: 'Day close', render: () => <DayCloseScreen {...base} /> },
  '/app/close/closed': {
    title: 'Day close (closed)',
    render: () => <DayCloseScreen {...base} close={closedDay} recent={recentClosed} />,
  },
  '/app/close/changed': {
    title: 'Day close (changed after closing, front desk)',
    render: () => <DayCloseScreen {...base} close={closedDay} recent={recentClosed} liveExpected={10980} canReopen={false} canManageExpenses={false} expenseMinDate="2026-10-26" />,
  },
  '/app/close/quiet': {
    title: 'Day close (quiet day, rupees only)',
    render: () => (
      <DayCloseScreen {...base} date="2026-10-25" recent={recentDays} expenses={[]}
        summary={{
          ...daySummary, date: '2026-10-25', uses_nu: false, voids: [], discounts: [], by_staff: daySummary.by_staff.slice(1, 3),
          opening: { cash: 1500, cash_nu: 0, from_date: '2026-10-24' },
          by_method: { cash: { bills: 1800, coins: 0, refunds: 0, net: 1800 }, upi: { bills: 2600, coins: 0, refunds: 0, net: 2600 } },
          expenses: { count: 0, by_paid_from: {}, by_category: {} },
          totals: { ...daySummary.totals, bills: 6, sales: 4400, due: 0, voids: 0, voids_total: 0, discounts: 0, discounted_bills: 0, received: 4400, refunds: 0, collected: 4400,
            coins_sold: 0, coins_bonus: 0, coins_used: 0, expenses: 0, expenses_cash: 0, opening_cash: 1500, cash_in: 1800, cash_refunds: 0, expected_cash: 3300,
            cash_in_nu: 0, expected_cash_nu: 0 },
        }} />
    ),
  },
  '/app/expenses': {
    title: 'Expenses',
    render: () => <ExpensesScreen month="2026-10" thisMonth="2026-10" today={TODAY} expenses={monthExpenses} staff={dayStaff} canManage />,
  },
  '/app/expenses/desk': {
    title: 'Expenses (front desk)',
    render: () => (
      <ExpensesScreen month="2026-10" thisMonth="2026-10" today={TODAY} expenses={monthExpenses.filter((e) => e.spent_on >= '2026-10-26')} staff={dayStaff}
        canManage={false} deskOnly expenseMinDate="2026-10-26" />
    ),
  },
  '/app/reports/expenses': {
    title: 'Reports with expenses',
    render: () => (
      <ReportsScreen report={{ ...baseReport, ...coinReport }} previous={null} range={{ key: 'month', from: '2026-10-01', to: TODAY }} today={TODAY}
        salonName={salon.name} expenses={expenseReport} />
    ),
  },
  '/app/today-unclosed': {
    title: 'Today (yesterday not closed)',
    render: () => (
      <TodayView salon={{ id: salon.id, name: salon.name, slug: salon.slug, waConnected: true, gstin: salon.gstin }} userName="Kavya" today={TODAY}
        nowIso={NOW_ISO} appointments={appointments} revenueToday={8450} needsAttention={1} teamSize={4} menu={menu} canBill isOwner={false} unclosedDay="2026-10-26" />
    ),
  },
};
