'use client';
// Expense log: a month at a time, filter by category, totals by category. Owner/manager edit; the front desk adds.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Empty, Notice, Panel, Stat } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { Topbar } from './shell';
import { ExpenseSheet, type ExpenseRow } from './expense-sheet';
import { money } from '@/lib/billing';
import { addMonths, EXPENSE_CATEGORIES, monthLabel, monthRange, PAID_FROM, PAID_FROM_LABEL, type ExpenseCategory } from '@/lib/dayclose';
import { fmtDateShort } from '@/lib/time';

export interface ExpensesProps {
  month: string;          // "YYYY-MM"
  thisMonth: string;
  today: string;
  expenses: ExpenseRow[];
  staff: { id: string; name: string }[];
  canManage: boolean;
  /** Front desk: only today's and yesterday's expenses are visible. */
  deskOnly?: boolean;
  expenseMinDate?: string;
  initialCategory?: string;
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

export function ExpensesScreen(p: ExpensesProps) {
  const [cat, setCat] = useState<ExpenseCategory | 'all'>(EXPENSE_CATEGORIES.includes(p.initialCategory as ExpenseCategory) ? p.initialCategory as ExpenseCategory : 'all');
  const [sheet, setSheet] = useState<{ open: boolean; expense: ExpenseRow | null }>({ open: false, expense: null });

  const stats = useMemo(() => {
    const byCat = new Map<ExpenseCategory, { total: number; count: number }>();
    const byPaid = new Map<string, number>();
    let total = 0;
    for (const e of p.expenses) {
      total += e.amount;
      const c = byCat.get(e.category) ?? { total: 0, count: 0 };
      byCat.set(e.category, { total: c.total + e.amount, count: c.count + 1 });
      byPaid.set(e.paid_from, (byPaid.get(e.paid_from) ?? 0) + e.amount);
    }
    const cats = [...byCat.entries()].sort((a, b) => b[1].total - a[1].total);
    return { total, cats, byPaid, cash: byPaid.get('cash') ?? 0, advances: byCat.get('Staff advance')?.total ?? 0 };
  }, [p.expenses]);

  const shown = cat === 'all' ? p.expenses : p.expenses.filter((e) => e.category === cat);
  const shownTotal = shown.reduce((a, e) => a + e.amount, 0);
  const max = Math.max(1, ...stats.cats.map(([, v]) => v.total));
  const isThisMonth = p.month === p.thisMonth;
  const defaultDate = isThisMonth || p.deskOnly ? p.today : monthRange(p.month).to;
  const monthHref = (m: string) => (m === p.thisMonth ? '/app/expenses' : `/app/expenses?month=${m}`);

  return (
    <>
      <Topbar title="Expenses" subtitle={p.deskOnly ? 'Today and yesterday' : monthLabel(p.month)}
        actions={<Button variant="primary" icon="plus" onClick={() => setSheet({ open: true, expense: null })}><span className="hide-mobile">Add expense</span></Button>} />
      <div className="page">
        {p.deskOnly ? (
          <Notice>You can add expenses for today and yesterday, and see those here. The owner and managers see every month.</Notice>
        ) : (
          <div className="exp-monthbar">
            <Link className="btn btn-secondary btn-sm btn-icon" href={monthHref(addMonths(p.month, -1))} aria-label="Previous month"><Icon name="chevronLeft" size={16} /></Link>
            <span className="strong exp-month">{monthLabel(p.month)}</span>
            {isThisMonth
              ? <span className="btn btn-secondary btn-sm btn-icon" aria-disabled="true" aria-hidden><Icon name="chevronRight" size={16} /></span>
              : <Link className="btn btn-secondary btn-sm btn-icon" href={monthHref(addMonths(p.month, 1))} aria-label="Next month"><Icon name="chevronRight" size={16} /></Link>}
            {!isThisMonth && <Link className="btn btn-ghost btn-sm" href="/app/expenses">This month</Link>}
          </div>
        )}

        <div className="stats">
          <Stat label={p.deskOnly ? 'Spent' : isThisMonth ? 'Spent this month' : 'Spent'} value={money(stats.total)} sub={`${p.expenses.length} expense${p.expenses.length === 1 ? '' : 's'}`} />
          <Stat label="From the cash drawer" value={money(stats.cash)} sub={stats.total ? `${pct(stats.cash, stats.total)}% of spending` : '—'} />
          <Stat label="Staff advances" value={money(stats.advances)} sub="Recover from salaries" />
          <Stat label="Biggest category" value={stats.cats[0] ? stats.cats[0][0] : '—'} sub={stats.cats[0] ? money(stats.cats[0][1].total) : 'Nothing spent'} />
        </div>

        <div className="split exp-split">
          <Panel flush className="dc-clip" title={
            <div className="filters grow">
              <div className="filters-scroll">
                <div className="row exp-chips" role="group" aria-label="Category">
                  <button type="button" className="chip chip-sm" aria-pressed={cat === 'all'} onClick={() => setCat('all')}>All <span className="muted num">{p.expenses.length}</span></button>
                  {stats.cats.map(([c, v]) => (
                    <button key={c} type="button" className="chip chip-sm" aria-pressed={cat === c} onClick={() => setCat(c)}>{c} <span className="muted num">{v.count}</span></button>
                  ))}
                </div>
              </div>
            </div>
          }>
            {shown.length ? (
              <>
                <div className="table-wrap hide-mobile">
                  <table className="table">
                    <thead><tr><th>Date</th><th>Category</th><th>Details</th><th className="right">Amount</th>{p.canManage && <th aria-label="Edit" />}</tr></thead>
                    <tbody>
                      {shown.map((e) => (
                        <tr key={e.id} className={p.canManage ? 'clickable' : undefined} onClick={p.canManage ? () => setSheet({ open: true, expense: e }) : undefined}>
                          <td className="nowrap num ink2">{e.spent_on === p.today ? 'Today' : fmtDateShort(e.spent_on)}</td>
                          <td className="nowrap"><Badge tone={e.category === 'Staff advance' ? 'plum' : 'neutral'}>{e.category}</Badge></td>
                          <td>
                            <div className="truncate exp-note">{e.staff_name ? <span className="strong">{e.staff_name}</span> : null}{e.staff_name && e.note ? ' · ' : ''}{e.note ?? (e.staff_name ? '' : <span className="muted">—</span>)}</div>
                            <div className="tiny muted">{PAID_FROM_LABEL[e.paid_from]}{e.created_by_name ? ` · added by ${e.created_by_name}` : ''}</div>
                          </td>
                          <td className="right num strong">{money(e.amount)}</td>
                          {p.canManage && <td className="right"><button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Edit ${e.category} ${money(e.amount)}`} onClick={(ev) => { ev.stopPropagation(); setSheet({ open: true, expense: e }); }}><Icon name="edit" size={16} /></button></td>}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr><td colSpan={3} className="strong">{cat === 'all' ? 'Total' : cat}</td><td className="right num strong">{money(shownTotal)}</td>{p.canManage && <td />}</tr></tfoot>
                  </table>
                </div>
                <ul className="list show-mobile">
                  {shown.map((e) => {
                    const body = (
                      <>
                        <div className="exp-date num"><span>{Number(e.spent_on.slice(8))}</span><span>{fmtDateShort(e.spent_on).split(' ').pop()}</span></div>
                        <div className="grow" style={{ minWidth: 0 }}>
                          <div className="strong truncate">{e.category}{e.staff_name ? ` · ${e.staff_name}` : ''}</div>
                          <div className="tiny muted truncate">{[PAID_FROM_LABEL[e.paid_from], e.note].filter(Boolean).join(' · ')}</div>
                        </div>
                        <span className="num strong">{money(e.amount)}</span>
                      </>
                    );
                    return (
                      <li key={e.id} style={{ padding: 0 }}>
                        {p.canManage
                          ? <button type="button" className="dc-exp-row" onClick={() => setSheet({ open: true, expense: e })}>{body}</button>
                          : <div className="dc-exp-row">{body}</div>}
                      </li>
                    );
                  })}
                  <li className="between dc-methods-total"><span className="strong">{cat === 'all' ? 'Total' : cat}</span><span className="num strong">{money(shownTotal)}</span></li>
                </ul>
              </>
            ) : (
              <Empty icon="expense" title={p.expenses.length ? 'Nothing in this category' : p.deskOnly ? 'No expenses today or yesterday' : 'No expenses this month'}
                action={<Button size="sm" variant="primary" icon="plus" onClick={() => setSheet({ open: true, expense: null })}>Add expense</Button>}>
                Log rent, electricity, supplies, tea and staff advances so profit and the cash drawer add up.
              </Empty>
            )}
          </Panel>

          <div className="stack">
            <Panel title="By category">
              {stats.cats.length ? (
                <div className="stack-sm">
                  {stats.cats.map(([c, v]) => (
                    <button key={c} type="button" className="bar-row exp-bar" aria-pressed={cat === c} onClick={() => setCat(cat === c ? 'all' : c)}>
                      <span className="truncate">{c}</span>
                      <div className="bar" aria-hidden><span className={c === 'Staff advance' ? 'exp-bar-advance' : undefined} style={{ width: `${(v.total / max) * 100}%` }} /></div>
                      <span className="num small nowrap bar-val">{money(v.total)} <span className="muted">· {pct(v.total, stats.total)}%</span></span>
                    </button>
                  ))}
                </div>
              ) : <p className="small muted">Totals by category show here once you add expenses.</p>}
            </Panel>
            {stats.total > 0 && (
              <Panel title="How it was paid">
                <ul className="legend-list">
                  {PAID_FROM.filter((k) => stats.byPaid.get(k)).map((k) => (
                    <li key={k}><span className="grow">{PAID_FROM_LABEL[k]}{k === 'cash' && <span className="tiny muted"> · from the drawer</span>}</span><span className="num">{money(stats.byPaid.get(k)!)}</span></li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        </div>
      </div>
      <ExpenseSheet open={sheet.open} expense={sheet.expense} onClose={() => setSheet({ open: false, expense: null })}
        defaultDate={defaultDate} today={p.today} minDate={p.expenseMinDate} staff={p.staff} canDelete={p.canManage} />
    </>
  );
}
