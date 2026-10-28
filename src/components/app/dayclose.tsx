'use client';
// Day close: what came in, from whom, what was cancelled or discounted, what was spent, and whether the drawer adds up.
import { useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Button, Dialog, Notice, Panel, Stat, TextArea, useToast } from '@/components/ui/ui';
import { Icon, type IconName } from '@/components/ui/icons';
import { Topbar } from './shell';
import { parseAmount } from './billing-bits';
import { ExpenseSheet, type ExpenseRow } from './expense-sheet';
import { closeDay, reopenDay } from '@/actions/dayclose';
import { money } from '@/lib/billing';
import { fmtCoins } from '@/lib/coins';
import {
  cashDifference, fmtNu, isCoins, isPrepaid, methodLabel, methodRows, PAID_FROM_LABEL, showsNu, sortMethods,
  type CashCheck, type DayClose, type DaySummary,
} from '@/lib/dayclose';
import { addDays, fmtDateLong, fmtDateShort, fmtTime, localDate } from '@/lib/time';

export interface DayCloseProps {
  salonName: string;
  date: string;
  today: string;
  tz: string;
  /** Live summary when open; the frozen snapshot when closed. */
  summary: DaySummary;
  close: DayClose | null;
  /** When closed: today's live cash expected, if bills/expenses changed after closing. */
  liveExpected?: number | null;
  expenses: ExpenseRow[];
  /** Front desk looking at an older day: the expense list isn't shown to them, only totals. */
  expensesHidden?: boolean;
  staff: { id: string; name: string }[];
  recent: { date: string; closed: boolean; difference: number | null }[];
  canReopen: boolean;
  canAddExpense: boolean;
  canManageExpenses: boolean;
  /** Earliest date this user may add expenses for. */
  expenseMinDate?: string;
}

const METHOD_ICON: Record<string, IconName> = { cash: 'cash', cash_nu: 'cash', upi: 'upi', upi_bhutan: 'upi', card: 'card', wallet: 'coins', package: 'box', advance: 'heart' };
const pctOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

export function DayCloseScreen(p: DayCloseProps) {
  const router = useRouter();
  const toast = useToast();
  const s = p.summary;
  const t = s.totals;
  const closed = p.close;
  const nu = showsNu(s) || (closed?.counted_cash_nu ?? null) !== null;
  const [sheet, setSheet] = useState<{ open: boolean; expense: ExpenseRow | null }>({ open: false, expense: null });
  const [reopenOpen, setReopenOpen] = useState(false);
  const [pending, start] = useTransition();

  const go = (d: string) => router.push(d === p.today ? '/app/close' : `/app/close?date=${d}`);
  const reopen = () => start(async () => {
    const r = await reopenDay(p.date);
    setReopenOpen(false);
    if (!r.ok) return toast(r.error, 'error');
    toast(r.message ?? 'Reopened');
    router.refresh();
  });

  const subtitle = closed
    ? `${fmtDateLong(p.date)} · closed${closed.details.closed_by_name ? ` by ${closed.details.closed_by_name}` : ''} at ${fmtTime(closed.closed_at, p.tz)}${localDate(new Date(closed.closed_at), p.tz) !== p.date ? `, ${fmtDateShort(localDate(new Date(closed.closed_at), p.tz))}` : ''}`
    : `${fmtDateLong(p.date)} · ${p.date === p.today ? 'open' : 'not closed yet'}`;
  const changed = closed && p.liveExpected != null && Math.abs(p.liveExpected - closed.expected_cash) >= 0.005;

  return (
    <>
      <Topbar title="Day close" subtitle={subtitle}
        actions={<>
          <Button icon="printer" onClick={() => window.print()} className="no-print"><span className="hide-mobile">Print</span></Button>
          {closed && p.canReopen && <Button icon="unlock" onClick={() => setReopenOpen(true)} className="no-print"><span className="hide-mobile">Reopen</span></Button>}
        </>} />
      <div className="page dc-page">
        <div className="dc-print-head">
          <div className="strong">{p.salonName} — day close</div>
          <div>{fmtDateLong(p.date)}{closed ? ` · closed${closed.details.closed_by_name ? ` by ${closed.details.closed_by_name}` : ''} at ${fmtTime(closed.closed_at, p.tz)}` : ' · not closed'}</div>
        </div>

        <DateBar date={p.date} today={p.today} recent={p.recent} onGo={go} />

        {changed && (
          <Notice tone="warn">
            Bills, payments or expenses for this day changed after it was closed. Cash expected is now <strong className="num">{money(p.liveExpected!)}</strong> (was {money(closed!.expected_cash)}).
            {p.canReopen ? ' Reopen the day and close it again to update the record.' : ' Ask the owner or a manager to reopen it.'}
          </Notice>
        )}

        <div className="stats">
          <Stat label="Sales" value={money(t.sales)}
            sub={<>{t.bills} bill{t.bills === 1 ? '' : 's'}{t.due > 0.5 ? <> · <span className="warn-text strong">{money(t.due)} due</span></> : ''}</>} />
          <Stat label="Collected" value={money(t.collected)}
            sub={t.refunds > 0 ? <span className="danger-text">after {money(t.refunds)} handed back</span>
              : t.coins_sold || t.packages_sold || t.advances_received ? `incl. ${[t.coins_sold ? `${money(t.coins_sold)} coins` : '', t.packages_sold ? `${money(t.packages_sold)} packages` : '', t.advances_received ? `${money(t.advances_received)} advances` : ''].filter(Boolean).join(', ')}`
              : 'Cash, UPI and card'} />
          <Stat label="Cash expected in drawer" value={money(t.expected_cash)}
            sub={nu ? <span className="num">+ {fmtNu(t.expected_cash_nu)}</span> : `Opening ${money(t.opening_cash)}`} />
          <Stat label="Expenses" value={money(t.expenses)} sub={t.expenses_cash ? `${money(t.expenses_cash)} from the drawer` : t.expenses ? 'None from the drawer' : 'Nothing spent'} />
        </div>

        <div className="split dc-split">
          <div className="stack">
            <Panel title={<h2 className="row" style={{ gap: 8 }}><Icon name={closed ? 'lock' : 'cash'} size={18} className="dc-title-icon" />Cash in the drawer</h2>}
              actions={closed ? <DiffBadge check={cashDifference(closed.counted_cash, closed.expected_cash)} /> : undefined}>
              <div className="stack-lg">
                <CashRecon s={s} />
                {closed ? <ClosedResult close={closed} nu={nu} /> : <CloseForm date={p.date} today={p.today} s={s} nu={nu} />}
              </div>
            </Panel>

            <TeamPanel rows={s.by_staff} />
            <VoidsPanel voids={s.voids} tz={p.tz} date={p.date} />
            <DiscountsPanel s={s} tz={p.tz} />
          </div>

          <div className="stack">
            <MethodsPanel s={s} date={p.date} />
            {(t.coins_sold > 0 || t.coins_used > 0 || t.coins_bonus > 0) && (
              <Panel title={<h2 className="row" style={{ gap: 8 }}><Icon name="coins" size={18} className="coin-title-icon" />Coins</h2>}>
                <div className="coin-report">
                  <div><div className="small muted">Sold</div><div className="coin-report-value num">{money(t.coins_sold)}</div><div className="tiny muted">Money received (an advance)</div></div>
                  <div><div className="small muted">Used on bills</div><div className="coin-report-value num">{fmtCoins(t.coins_used)}</div><div className="tiny muted">Not money received today</div></div>
                  {t.coins_bonus > 0 && <div><div className="small muted">Bonus given</div><div className="coin-report-value num">{fmtCoins(t.coins_bonus)}</div><div className="tiny muted">With coin packs</div></div>}
                </div>
              </Panel>
            )}
            {(t.packages_sold > 0 || t.package_used > 0 || t.package_refunds > 0) && (
              <Panel title={<h2 className="row" style={{ gap: 8 }}><Icon name="box" size={18} className="pkg-title-icon" />Packages</h2>}>
                <div className="coin-report">
                  <div><div className="small muted">Sold</div><div className="coin-report-value num">{money(t.packages_sold)}</div>
                    <div className="tiny muted">{t.packages_sold_count} package{t.packages_sold_count === 1 ? '' : 's'} · money received (an advance)</div></div>
                  <div><div className="small muted">Sessions used on bills</div><div className="coin-report-value num">{money(t.package_used)}</div><div className="tiny muted">Not money received today</div></div>
                  {t.package_refunds > 0 && <div><div className="small muted">Handed back</div><div className="coin-report-value num danger-text">{money(t.package_refunds)}</div><div className="tiny muted">On cancelled packages</div></div>}
                </div>
              </Panel>
            )}
            {(t.advances_received > 0 || t.advance_used > 0 || t.advance_refunds > 0) && (
              <Panel title={<h2 className="row" style={{ gap: 8 }}><Icon name="heart" size={18} className="adv-title-icon" />Advances</h2>}
                actions={<Link className="btn btn-ghost btn-sm no-print" href="/app/events">Events</Link>}>
                <div className="coin-report">
                  <div><div className="small muted">Taken</div><div className="coin-report-value num">{money(t.advances_received)}</div>
                    <div className="tiny muted">{t.advances_received_count} advance{t.advances_received_count === 1 ? '' : 's'} · money received</div></div>
                  <div><div className="small muted">Used on bills</div><div className="coin-report-value num">{money(t.advance_used)}</div><div className="tiny muted">Not money received today</div></div>
                  {t.advance_refunds > 0 && <div><div className="small muted">Handed back</div><div className="coin-report-value num danger-text">{money(t.advance_refunds)}</div><div className="tiny muted">Refunded advances</div></div>}
                </div>
              </Panel>
            )}
            <ExpensesPanel {...p} onAdd={() => setSheet({ open: true, expense: null })} onEdit={(e) => setSheet({ open: true, expense: e })} />
          </div>
        </div>
      </div>

      <ExpenseSheet open={sheet.open} expense={sheet.expense} onClose={() => setSheet({ open: false, expense: null })}
        defaultDate={p.date} today={p.today} minDate={p.expenseMinDate} staff={p.staff} canDelete={p.canManageExpenses} />
      <Dialog open={reopenOpen} onClose={() => setReopenOpen(false)} title={p.date === p.today ? 'Reopen today?' : `Reopen ${fmtDateShort(p.date)}?`}
        footer={<><Button onClick={() => setReopenOpen(false)} disabled={pending}>Cancel</Button><Button variant="primary" icon="unlock" onClick={reopen} loading={pending}>Reopen day</Button></>}>
        <p className="ink2">The saved close (cash counted {money(closed?.counted_cash ?? 0)}) is removed so bills and expenses can be corrected. Close the day again afterwards — the figures are worked out afresh.</p>
      </Dialog>
    </>
  );
}

// ---------- Date navigation ----------
function DateBar({ date, today, recent, onGo }: { date: string; today: string; recent: DayCloseProps['recent']; onGo: (d: string) => void }) {
  return (
    <div className="dc-datebar no-print">
      <div className="row dc-datepick">
        <Button size="sm" icon="chevronLeft" aria-label="Previous day" onClick={() => onGo(addDays(date, -1))} />
        <input type="date" className="input input-sm date-input" value={date} max={today} aria-label="Day"
          onChange={(e) => { if (e.target.value && e.target.value <= today) onGo(e.target.value); }} />
        <Button size="sm" icon="chevronRight" aria-label="Next day" disabled={date >= today} onClick={() => onGo(addDays(date, 1))} />
      </div>
      <nav className="dc-recent" aria-label="Recent days">
        {recent.map((r) => (
          <button key={r.date} type="button" className={`dc-day${r.closed ? ' is-closed' : ''}`} aria-current={r.date === date ? 'date' : undefined} onClick={() => onGo(r.date)}
            title={r.closed ? `Closed${r.difference != null && Math.abs(r.difference) >= 0.005 ? ` · ${money(Math.abs(r.difference))} ${r.difference > 0 ? 'excess' : 'short'}` : ' · cash matched'}` : 'Not closed'}>
            <span className="dc-day-name">{r.date === today ? 'Today' : fmtDateShort(r.date).split(',')[0]}</span>
            <span className="dc-day-num num">{Number(r.date.slice(8))}</span>
            <span className={`dc-day-mark${r.closed ? (r.difference != null && r.difference < -0.005 ? ' is-short' : ' is-ok') : ''}`} aria-hidden>
              {r.closed ? <Icon name={r.difference != null && r.difference < -0.005 ? 'alert' : 'check'} size={11} strokeWidth={2.6} /> : null}
            </span>
            <span className="sr-only">{r.closed ? 'closed' : 'not closed'}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// ---------- Cash ----------
function ReconRow({ sign, label, sub, value, strong }: { sign?: '+' | '−' | '='; label: ReactNode; sub?: ReactNode; value: string; strong?: boolean }) {
  return (
    <div className={`dc-recon-row${strong ? ' is-total' : ''}`}>
      <span className="dc-sign" aria-hidden>{sign ?? ''}</span>
      <span className="grow">{label}{sub && <span className="tiny muted dc-recon-sub">{sub}</span>}</span>
      <span className="num">{value}</span>
    </div>
  );
}

function CashRecon({ s }: { s: DaySummary }) {
  const t = s.totals;
  const cash = s.by_method.cash ?? { bills: 0, coins: 0, packages: 0, advances: 0, refunds: 0, net: 0 };
  const nuIn = Object.entries(s.by_method).filter(([m]) => m.startsWith('cash_'));
  const nuBills = nuIn.reduce((a, [, r]) => a + r.bills + r.coins + (r.packages || 0) + (r.advances || 0), 0);
  return (
    <div className="stack">
      <div className="dc-recon" role="table" aria-label="Rupee cash">
        <ReconRow label="Opening cash" value={money(t.opening_cash)}
          sub={s.opening.from_date ? `Left in the drawer at the close of ${fmtDateShort(s.opening.from_date)}` : 'No earlier close, so starting from ₹0'} />
        <ReconRow sign="+" label="Cash from bills" value={money(cash.bills)} sub="Includes later payments on older bills" />
        {cash.coins > 0 && <ReconRow sign="+" label="Cash for coins sold" value={money(cash.coins)} />}
        {cash.packages > 0 && <ReconRow sign="+" label="Cash for packages sold" value={money(cash.packages)} />}
        {cash.advances > 0 && <ReconRow sign="+" label="Cash advances taken" value={money(cash.advances)} />}
        {t.cash_refunds > 0 && <ReconRow sign="−" label={<span className="danger-text">{t.package_refunds > 0 || t.advance_refunds > 0 ? 'Handed back (cancelled bills, packages, advances)' : 'Handed back on cancelled bills'}</span>} value={money(t.cash_refunds)} />}
        <ReconRow sign="−" label="Expenses paid in cash" value={money(t.expenses_cash)} />
        <ReconRow sign="=" label="Expected in the drawer" value={money(t.expected_cash)} strong />
      </div>
      {showsNu(s) && (
        <div className="dc-recon dc-recon-nu" role="table" aria-label="Ngultrum cash">
          <div className="dc-recon-cap tiny muted">Ngultrum cash (counted separately)</div>
          <ReconRow label="Opening Nu" value={fmtNu(t.opening_cash_nu)} />
          <ReconRow sign="+" label="Nu received" value={fmtNu(nuBills)} />
          {t.cash_refunds_nu > 0 && <ReconRow sign="−" label="Handed back" value={fmtNu(t.cash_refunds_nu)} />}
          <ReconRow sign="=" label="Expected Nu" value={fmtNu(t.expected_cash_nu)} strong />
        </div>
      )}
    </div>
  );
}

function DiffBadge({ check, nu }: { check: CashCheck; nu?: boolean }) {
  const amt = nu ? fmtNu(Math.abs(check.amount)) : money(Math.abs(check.amount));
  if (check.kind === 'balanced') return <Badge tone="success">Matches</Badge>;
  return check.kind === 'short' ? <Badge tone="danger">{amt} short</Badge> : <Badge tone="marigold">{amt} excess</Badge>;
}

function DiffBox({ check, nu, label }: { check: CashCheck | null; nu?: boolean; label: string }) {
  if (!check) return <div className="dc-diff is-empty"><span className="small muted">{label}</span><span className="dc-diff-value muted">—</span><span className="tiny muted">Enter what you counted</span></div>;
  const amt = nu ? fmtNu(Math.abs(check.amount)) : money(Math.abs(check.amount));
  return (
    <div className={`dc-diff is-${check.kind}`} aria-live="polite">
      <span className="small">{label}</span>
      <span className="dc-diff-value num">{check.kind === 'balanced' ? 'Matches' : `${check.kind === 'short' ? 'Short' : 'Excess'} ${amt}`}</span>
      <span className="tiny">{check.kind === 'balanced' ? 'Counted cash equals expected' : check.kind === 'short' ? 'Less cash than expected — recount, then note why' : 'More cash than expected — a payment may not be recorded'}</span>
    </div>
  );
}

function CloseForm({ date, today, s, nu }: { date: string; today: string; s: DaySummary; nu: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [counted, setCounted] = useState('');
  const [countedNu, setCountedNu] = useState('');
  const [out, setOut] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const t = s.totals;
  const blank = (v: string) => v.trim() === '';
  const countedV = parseAmount(counted);
  const nuV = parseAmount(countedNu);
  const outV = parseAmount(out);
  const check = blank(counted) ? null : cashDifference(countedV, t.expected_cash);
  const checkNu = !nu || blank(countedNu) ? null : cashDifference(nuV, t.expected_cash_nu);
  const left = Math.max(0, countedV - outV);
  const isToday = date === today;

  const submit = () => start(async () => {
    setError(null);
    if (blank(counted)) return setError('Count the cash in the drawer and enter the total (0 if it’s empty).');
    if (nu && blank(countedNu) && t.expected_cash_nu !== 0) return setError(`Count the Ngultrum too: ${fmtNu(t.expected_cash_nu)} expected.`);
    if (outV > countedV) return setError('Cash taken out can’t be more than the cash counted.');
    if (check && check.kind !== 'balanced' && !notes.trim()) return setError(`Add a note about the ${check.kind === 'short' ? 'shortage' : 'excess'} — the owner will see it.`);
    const r = await closeDay({ date, countedCash: countedV, countedCashNu: nu && !blank(countedNu) ? nuV : null, cashOut: outV, notes });
    if (!r.ok) return setError(r.error);
    toast(r.message ?? 'Day closed');
    router.refresh();
  });

  return (
    <form className="dc-form stack" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="dc-form-head">
        <h3>Close {isToday ? 'today' : fmtDateShort(date)}</h3>
        <p className="small muted">Count the notes and coins in the drawer, then enter the total.</p>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="dc-count">
        <div className="field">
          <label htmlFor="dc-counted">Cash counted (₹)</label>
          <div className="prefix-input dc-big-input"><span>₹</span>
            <input id="dc-counted" className="input num" inputMode="decimal" autoComplete="off" placeholder="0"
              value={counted} onChange={(e) => setCounted(e.target.value.replace(/[^\d.,]/g, ''))} />
          </div>
        </div>
        <DiffBox check={check} label="Rupees" />
      </div>
      {nu && (
        <div className="dc-count">
          <div className="field">
            <label htmlFor="dc-counted-nu">Ngultrum counted (Nu)</label>
            <div className="prefix-input dc-big-input"><span>Nu</span>
              <input id="dc-counted-nu" className="input num" inputMode="decimal" autoComplete="off" placeholder="0"
                value={countedNu} onChange={(e) => setCountedNu(e.target.value.replace(/[^\d.,]/g, ''))} />
            </div>
          </div>
          <DiffBox check={checkNu} nu label="Ngultrum" />
        </div>
      )}
      <div className="grid-2 dc-form-more">
        <div className="field">
          <label htmlFor="dc-out">Cash taken out (₹)</label>
          <div className="prefix-input"><span>₹</span>
            <input id="dc-out" className="input num" inputMode="decimal" autoComplete="off" placeholder="0"
              value={out} onChange={(e) => setOut(e.target.value.replace(/[^\d.,]/g, ''))} />
          </div>
          <span className="hint">{blank(counted) ? 'Handed to the owner or deposited. The rest opens tomorrow.' : <>Handed over or deposited. <span className="strong num">{money(left)}</span> stays in the drawer for tomorrow.</>}</span>
        </div>
        <TextArea label={check && check.kind !== 'balanced' ? 'Note (required)' : 'Note (optional)'} rows={2} maxLength={500} value={notes}
          placeholder={check?.kind === 'short' ? 'e.g. ₹50 given for parking, not entered' : 'Anything the owner should know'}
          onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="dc-form-foot">
        <Button type="submit" variant="primary" size="lg" icon="lock" loading={pending}>Close the day</Button>
        <span className="tiny muted">Saves a copy of these figures. An owner or manager can reopen it.</span>
      </div>
    </form>
  );
}

function ClosedResult({ close, nu }: { close: DayClose; nu: boolean }) {
  const check = cashDifference(close.counted_cash, close.expected_cash);
  const left = close.counted_cash - close.cash_out;
  return (
    <div className="stack">
      <div className="dc-closed">
        <div><span className="small muted">Counted</span><span className="dc-closed-value num">{money(close.counted_cash)}</span></div>
        <div><span className="small muted">Expected</span><span className="dc-closed-value num">{money(close.expected_cash)}</span></div>
        <div className={`is-${check.kind}`}><span className="small muted">Difference</span>
          <span className="dc-closed-value num">{check.kind === 'balanced' ? 'Matches' : `${check.kind === 'short' ? '−' : '+'}${money(Math.abs(check.amount))}`}</span></div>
      </div>
      {nu && close.counted_cash_nu != null && (
        <div className="dc-closed">
          <div><span className="small muted">Nu counted</span><span className="dc-closed-value num">{fmtNu(close.counted_cash_nu)}</span></div>
          <div><span className="small muted">Nu expected</span><span className="dc-closed-value num">{fmtNu(close.expected_cash_nu)}</span></div>
          <div className={`is-${cashDifference(close.counted_cash_nu, close.expected_cash_nu).kind}`}><span className="small muted">Difference</span>
            <span className="dc-closed-value num">{(() => { const c = cashDifference(close.counted_cash_nu!, close.expected_cash_nu); return c.kind === 'balanced' ? 'Matches' : `${c.amount < 0 ? '−' : '+'}${fmtNu(Math.abs(c.amount))}`; })()}</span></div>
        </div>
      )}
      <dl className="dc-closed-meta">
        <div><dt>Taken out</dt><dd className="num">{money(close.cash_out)}{close.cash_out_nu ? ` + ${fmtNu(close.cash_out_nu)}` : ''}</dd></div>
        <div><dt>Left for tomorrow</dt><dd className="num">{money(left)}{nu && close.counted_cash_nu != null ? ` + ${fmtNu(close.counted_cash_nu - (close.cash_out_nu ?? 0))}` : ''}</dd></div>
      </dl>
      {close.notes && <blockquote className="dc-note">{close.notes}</blockquote>}
    </div>
  );
}

// ---------- Team ----------
function collectedParts(byMethod: Record<string, number>): string[] {
  return sortMethods(Object.keys(byMethod)).filter((m) => byMethod[m]).map((m) => `${methodLabel(m)} ${m.startsWith('cash_') ? fmtNu(byMethod[m]) : money(byMethod[m])}`);
}
const collectedLine = (byMethod: Record<string, number>) => collectedParts(byMethod).join(' · ');

function TeamPanel({ rows }: { rows: DaySummary['by_staff'] }) {
  const total = rows.reduce((a, r) => ({ services: a.services + r.services, sales: a.sales + r.sales, collected: a.collected + r.collected }), { services: 0, sales: 0, collected: 0 });
  return (
    <Panel title="By team member" flush className="dc-clip">
      {rows.length ? (
        <div className="table-wrap">
          <table className="table dc-team">
            <thead><tr><th>Name</th><th className="right hide-mobile">Services</th><th className="right">Sales <span className="hide-mobile">(before GST)</span></th><th className="right">Took payments</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.staff_id ?? ''}-${r.user_id ?? ''}-${r.name}`}>
                  <td>
                    <div className="row nowrap"><span className="dot" style={{ background: r.color ?? 'var(--faint)' }} /><span className="strong">{r.name}</span></div>
                    {r.services > 0 && <div className="tiny muted show-mobile dc-team-sub">{r.services} service{r.services === 1 ? '' : 's'}</div>}
                  </td>
                  <td className="right num hide-mobile">{r.services || <span className="muted">—</span>}</td>
                  <td className="right num">{r.sales ? money(Math.round(r.sales)) : <span className="muted">—</span>}</td>
                  <td className="right">
                    {r.collected ? <><div className="num strong">{money(r.collected)}</div><div className="tiny muted dc-took">{collectedParts(r.collected_by_method).map((x) => <span key={x}>{x}</span>)}</div></> : <span className="muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td className="strong">Total</td><td className="right num hide-mobile">{total.services}</td><td className="right num">{money(Math.round(total.sales))}</td><td className="right num strong">{money(total.collected)}</td></tr></tfoot>
          </table>
        </div>
      ) : <p className="panel-body small muted">No services or payments recorded for this day.</p>}
      <div className="panel-foot tiny muted">Services and sales go to the stylist on each bill line. “Took payments” is whoever recorded the payment or coin sale.</div>
    </Panel>
  );
}

// ---------- Red flags ----------
function VoidsPanel({ voids, tz, date }: { voids: DaySummary['voids']; tz: string; date: string }) {
  if (!voids.length) {
    return <div className="dc-okline"><Icon name="check" size={16} />No bills cancelled</div>;
  }
  return (
    <section className="panel dc-flag" aria-labelledby="dc-voids">
      <div className="panel-head">
        <h2 id="dc-voids" className="row" style={{ gap: 8 }}><Icon name="alert" size={18} />Cancelled bills</h2>
        <Badge tone="danger">{voids.length} · {money(voids.reduce((a, v) => a + v.total, 0))}</Badge>
      </div>
      <ul className="list">
        {voids.map((v) => {
          const sameDay = localDate(new Date(v.created_at), tz) === date;
          return (
            <li key={v.id} className="dc-void">
              <div className="between">
                <div style={{ minWidth: 0 }}>
                  <Link href={`/app/invoices/${v.id}`} className="strong num">{v.invoice_no}</Link>
                  <span className="muted"> · {v.customer ?? 'Walk-in'}</span>
                </div>
                <span className="num strong dc-void-amt">{money(v.total)}</span>
              </div>
              <div className="small ink2">
                Cancelled{v.voided_by ? ` by ${v.voided_by}` : ''} at {fmtTime(v.voided_at, tz)}
                {' · '}billed{v.billed_by ? ` by ${v.billed_by}` : ''} {sameDay ? `at ${fmtTime(v.created_at, tz)}` : `on ${fmtDateShort(localDate(new Date(v.created_at), tz))}`}
              </div>
              {v.reason && <div className="small dc-void-reason">“{v.reason}”</div>}
              {v.paid > 0 && (
                <div className="tiny danger-text strong">{collectedLine(v.paid_by_method)} had been paid — check it was handed back</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function DiscountsPanel({ s, tz }: { s: DaySummary; tz: string }) {
  const t = s.totals;
  if (!s.discounts.length) return <div className="dc-okline is-muted"><Icon name="check" size={16} />No discounts given</div>;
  return (
    <Panel title="Discounts" flush actions={<span className="small muted num">{t.discounted_bills} bill{t.discounted_bills === 1 ? '' : 's'} · {money(t.discounts)}</span>}>
      <ul className="list">
        {s.discounts.map((d) => {
          const pct = pctOf(d.discount, d.subtotal);
          return (
            <li key={d.id} className="between">
              <div style={{ minWidth: 0 }}>
                <div><Link href={`/app/invoices/${d.id}`} className="strong num">{d.invoice_no}</Link><span className="muted"> · {d.customer ?? 'Walk-in'}</span></div>
                <div className="tiny muted">{d.billed_by ? `Billed by ${d.billed_by} · ` : ''}{fmtTime(d.created_at, tz)} · bill {money(d.total)}</div>
              </div>
              <div className="right nowrap">
                <div className="num strong">−{money(d.discount)}</div>
                {pct >= 20 ? <Badge tone="marigold">{pct}% off</Badge> : <span className="tiny muted num">{pct}% off</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

// ---------- Payments ----------
function MethodsPanel({ s, date }: { s: DaySummary; date: string }) {
  const rows = methodRows(s.by_method);
  const money_ = rows.filter((r) => !isPrepaid(r.method));
  const coins = rows.find((r) => isCoins(r.method));
  const pkg = rows.find((r) => r.method === 'package');
  const adv = rows.find((r) => r.method === 'advance');
  return (
    <Panel title="Payments" flush className="dc-clip" actions={<Link className="btn btn-ghost btn-sm no-print" href={`/app/invoices?range=custom&from=${date}&to=${date}`}>See bills</Link>}>
      {money_.length || coins || pkg || adv ? (
        <ul className="list dc-methods">
          {money_.map(({ method, row }) => {
            const parts = [row.bills ? `Bills ${fmt(method, row.bills)}` : '', row.coins ? `coins sold ${fmt(method, row.coins)}` : '',
              row.packages ? `packages sold ${fmt(method, row.packages)}` : '', row.advances ? `advances ${fmt(method, row.advances)}` : '',
              row.refunds ? `handed back ${fmt(method, row.refunds)}` : ''].filter(Boolean);
            return (
              <li key={method} className="row">
                <span className="dc-method-icon"><Icon name={METHOD_ICON[method] ?? 'wallet'} size={17} /></span>
                <div className="grow">
                  <div className="strong">{methodLabel(method)}</div>
                  {(row.coins > 0 || row.packages > 0 || row.advances > 0 || row.refunds > 0) && <div className="tiny muted">{parts.join(' · ')}</div>}
                </div>
                <span className="num strong">{fmt(method, row.net)}</span>
              </li>
            );
          })}
          <li className="row dc-methods-total"><span className="grow strong">Collected</span><span className="num strong">{money(s.totals.collected)}</span></li>
          {coins && (
            <li className="row">
              <span className="dc-method-icon is-coins"><Icon name="coins" size={17} /></span>
              <div className="grow"><div>Paid with coins</div><div className="tiny muted">From clients’ prepaid balance — not money received today</div></div>
              <span className="num muted">{fmtCoins(coins.row.bills - coins.row.refunds)}</span>
            </li>
          )}
          {pkg && (
            <li className="row">
              <span className="dc-method-icon is-coins"><Icon name="box" size={17} /></span>
              <div className="grow"><div>Package sessions</div><div className="tiny muted">Paid for when the package was sold — not money received today</div></div>
              <span className="num muted">{money(pkg.row.bills - pkg.row.refunds)}</span>
            </li>
          )}
          {adv && (
            <li className="row">
              <span className="dc-method-icon is-coins"><Icon name="heart" size={17} /></span>
              <div className="grow"><div>Advances used on bills</div><div className="tiny muted">Counted on the day the advance was taken — not again today</div></div>
              <span className="num muted">{money(adv.row.bills - adv.row.refunds)}</span>
            </li>
          )}
        </ul>
      ) : <p className="panel-body small muted">No payments recorded for this day.</p>}
    </Panel>
  );
}
const fmt = (method: string, n: number) => (method.startsWith('cash_') ? fmtNu(n) : money(n));

// ---------- Expenses ----------
function ExpensesPanel(p: DayCloseProps & { onAdd: () => void; onEdit: (e: ExpenseRow) => void }) {
  const s = p.summary;
  const cats = Object.entries(s.expenses.by_category).filter(([, v]) => v).sort((a, b) => b[1]! - a[1]!);
  const canAddHere = p.canAddExpense && !p.close && (!p.expenseMinDate || p.date >= p.expenseMinDate);
  return (
    <Panel title="Expenses" flush className="dc-clip" actions={canAddHere ? <Button size="sm" icon="plus" className="no-print" onClick={p.onAdd}>Add expense</Button> : undefined}>
      {p.expensesHidden ? (
        cats.length ? (
          <ul className="list">
            {cats.map(([c, v]) => <li key={c} className="between"><span>{c}</span><span className="num strong">{money(v!)}</span></li>)}
          </ul>
        ) : <p className="panel-body small muted">No expenses recorded for this day.</p>
      ) : p.expenses.length ? (
        <ul className="list">
          {p.expenses.map((e) => {
            const editable = p.canManageExpenses && !p.close;
            const body = (
              <>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="strong truncate">{e.category}{e.staff_name ? ` · ${e.staff_name}` : ''}</div>
                  <div className="tiny muted truncate">{[PAID_FROM_LABEL[e.paid_from], e.note, e.created_by_name ? `added by ${e.created_by_name}` : ''].filter(Boolean).join(' · ')}</div>
                </div>
                <span className="num strong">{money(e.amount)}</span>
              </>
            );
            return (
              <li key={e.id} style={{ padding: 0 }}>
                {editable
                  ? <button type="button" className="dc-exp-row" onClick={() => p.onEdit(e)} aria-label={`Edit ${e.category} ${money(e.amount)}`}>{body}<Icon name="chevronRight" size={16} className="muted no-print" /></button>
                  : <div className="dc-exp-row">{body}</div>}
              </li>
            );
          })}
          <li className="between dc-methods-total"><span className="strong">Total</span><span className="num strong">{money(s.totals.expenses)}</span></li>
        </ul>
      ) : (
        <p className="panel-body small muted">{canAddHere ? 'Nothing spent yet. Add tea, supplies or a staff advance paid from the drawer so the cash adds up.' : 'No expenses recorded for this day.'}</p>
      )}
      {p.expensesHidden && <div className="panel-foot tiny muted">The owner and managers can see each expense. You can see today’s and yesterday’s.</div>}
    </Panel>
  );
}
