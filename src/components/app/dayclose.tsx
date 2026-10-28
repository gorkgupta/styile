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
  cashDifference, fmtNu, isCoins, isPrepaid, methodLabel, methodRows, showsNu, sortMethods,
  type CashCheck, type DayClose, type DaySummary,
} from '@/lib/dayclose';
import { addDays, dateParts, fmtDateLong, fmtDateShort, fmtTime, localDate } from '@/lib/time';
import { rich, useT } from '@/lib/i18n/react';
import type { Translator } from '@/lib/i18n/core';
import { METHOD_LABEL } from '@/lib/types';

/** A payment method's name in the page's language (unknown future methods fall back to lib/dayclose). */
const mLabel = (t: Translator, m: string) => (m in METHOD_LABEL ? t(`method.${m as keyof typeof METHOD_LABEL}`) : methodLabel(m));

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
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const s = p.summary;
  const tt = s.totals;
  const closed = p.close;
  const nu = showsNu(s) || (closed?.counted_cash_nu ?? null) !== null;
  const [sheet, setSheet] = useState<{ open: boolean; expense: ExpenseRow | null }>({ open: false, expense: null });
  const [reopenOpen, setReopenOpen] = useState(false);
  const [pending, start] = useTransition();

  const go = (d: string) => router.push(d === p.today ? '/app/close' : `/app/close?date=${d}`);
  const reopen = () => start(async () => {
    const r = await reopenDay(p.date);
    setReopenOpen(false);
    if (!r.ok) return toast(t.err(r.error), 'error');
    toast(t('dc.reopened', { date: fmtDateShort(p.date, t.locale) }));
    router.refresh();
  });

  const closedAt = closed ? fmtTime(closed.closed_at, p.tz) + (localDate(new Date(closed.closed_at), p.tz) !== p.date ? `, ${fmtDateShort(localDate(new Date(closed.closed_at), p.tz), t.locale)}` : '') : '';
  const closedLine = closed ? (closed.details.closed_by_name ? t('dc.closedByAt', { name: closed.details.closed_by_name, time: closedAt }) : t('dc.closedAt', { time: closedAt })) : '';
  const subtitle = closed
    ? `${fmtDateLong(p.date, t.locale)} · ${closedLine}`
    : `${fmtDateLong(p.date, t.locale)} · ${p.date === p.today ? t('dc.open') : t('dc.notClosedYet')}`;
  const changed = closed && p.liveExpected != null && Math.abs(p.liveExpected - closed.expected_cash) >= 0.005;

  return (
    <>
      <Topbar title={t('nav.close')} subtitle={subtitle}
        actions={<>
          <Button icon="printer" onClick={() => window.print()} className="no-print" aria-label={t('common.print')}><span className="hide-mobile">{t('common.print')}</span></Button>
          {closed && p.canReopen && <Button icon="unlock" onClick={() => setReopenOpen(true)} className="no-print" aria-label={t('dc.reopen')}><span className="hide-mobile">{t('dc.reopen')}</span></Button>}
        </>} />
      <div className="page dc-page">
        <div className="dc-print-head">
          <div className="strong">{t('dc.printTitle', { salon: p.salonName })}</div>
          <div>{fmtDateLong(p.date, t.locale)} · {closed ? closedLine : t('dc.notClosed')}</div>
        </div>

        <DateBar date={p.date} today={p.today} recent={p.recent} onGo={go} />

        {changed && (
          <Notice tone="warn">
            {rich(t('dc.changed', { was: money(closed!.expected_cash) }), { now: <strong className="num">{money(p.liveExpected!)}</strong> })}
            {' '}{p.canReopen ? t('dc.changedReopen') : t('dc.changedAsk')}
          </Notice>
        )}

        <div className="stats">
          <Stat label={t('dc.sales')} value={money(tt.sales)}
            sub={<>{t('common.bills', { count: tt.bills })}{tt.due > 0.5 ? <> · <span className="warn-text strong">{t('pos.due', { money: money(tt.due) })}</span></> : ''}</>} />
          <Stat label={t('dc.collected')} value={money(tt.collected)}
            sub={tt.refunds > 0 ? <span className="danger-text">{t('dc.afterHandedBack', { money: money(tt.refunds) })}</span>
              : tt.coins_sold || tt.packages_sold || tt.advances_received ? t('dc.incl', { list: [tt.coins_sold ? t('dc.inclCoins', { money: money(tt.coins_sold) }) : '', tt.packages_sold ? t('dc.inclPackages', { money: money(tt.packages_sold) }) : '', tt.advances_received ? t('dc.inclAdvances', { money: money(tt.advances_received) }) : ''].filter(Boolean).join(', ') })
              : t('dc.cashUpiCard')} />
          <Stat label={t('dc.expectedInDrawer')} value={money(tt.expected_cash)}
            sub={nu ? <span className="num">+ {fmtNu(tt.expected_cash_nu)}</span> : t('dc.openingN', { money: money(tt.opening_cash) })} />
          <Stat label={t('nav.expenses')} value={money(tt.expenses)} sub={tt.expenses_cash ? t('dc.fromDrawer', { money: money(tt.expenses_cash) }) : tt.expenses ? t('dc.noneFromDrawer') : t('dc.nothingSpent')} />
        </div>

        <div className="split dc-split">
          <div className="stack">
            <Panel title={<h2 className="row" style={{ gap: 8 }}><Icon name={closed ? 'lock' : 'cash'} size={18} className="dc-title-icon" />{t('dc.cashInDrawer')}</h2>}
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
            {(tt.coins_sold > 0 || tt.coins_used > 0 || tt.coins_bonus > 0) && (
              <Panel title={<h2 className="row" style={{ gap: 8 }}><Icon name="coins" size={18} className="coin-title-icon" />{t('method.wallet')}</h2>}>
                <div className="coin-report">
                  <div><div className="small muted">{t('dc.sold')}</div><div className="coin-report-value num">{money(tt.coins_sold)}</div><div className="tiny muted">{t('dc.moneyAdvance')}</div></div>
                  <div><div className="small muted">{t('dc.usedOnBills')}</div><div className="coin-report-value num">{fmtCoins(tt.coins_used)}</div><div className="tiny muted">{t('dc.notToday')}</div></div>
                  {tt.coins_bonus > 0 && <div><div className="small muted">{t('dc.bonusGiven')}</div><div className="coin-report-value num">{fmtCoins(tt.coins_bonus)}</div><div className="tiny muted">{t('dc.withPacks')}</div></div>}
                </div>
              </Panel>
            )}
            {(tt.packages_sold > 0 || tt.package_used > 0 || tt.package_refunds > 0) && (
              <Panel title={<h2 className="row" style={{ gap: 8 }}><Icon name="box" size={18} className="pkg-title-icon" />{t('nav.packages')}</h2>}>
                <div className="coin-report">
                  <div><div className="small muted">{t('dc.sold')}</div><div className="coin-report-value num">{money(tt.packages_sold)}</div>
                    <div className="tiny muted">{t('dc.nPackages', { count: tt.packages_sold_count })} · {t('dc.moneyAdvanceLc')}</div></div>
                  <div><div className="small muted">{t('dc.sessionsUsed')}</div><div className="coin-report-value num">{money(tt.package_used)}</div><div className="tiny muted">{t('dc.notToday')}</div></div>
                  {tt.package_refunds > 0 && <div><div className="small muted">{t('rcpt.handedBack')}</div><div className="coin-report-value num danger-text">{money(tt.package_refunds)}</div><div className="tiny muted">{t('dc.onCancelledPackages')}</div></div>}
                </div>
              </Panel>
            )}
            {(tt.advances_received > 0 || tt.advance_used > 0 || tt.advance_refunds > 0) && (
              <Panel title={<h2 className="row" style={{ gap: 8 }}><Icon name="heart" size={18} className="adv-title-icon" />{t('dc.advances')}</h2>}
                actions={<Link className="btn btn-ghost btn-sm no-print" href="/app/events">{t('dc.events')}</Link>}>
                <div className="coin-report">
                  <div><div className="small muted">{t('dc.taken')}</div><div className="coin-report-value num">{money(tt.advances_received)}</div>
                    <div className="tiny muted">{t('dc.nAdvances', { count: tt.advances_received_count })} · {t('dc.moneyReceived')}</div></div>
                  <div><div className="small muted">{t('dc.usedOnBills')}</div><div className="coin-report-value num">{money(tt.advance_used)}</div><div className="tiny muted">{t('dc.notToday')}</div></div>
                  {tt.advance_refunds > 0 && <div><div className="small muted">{t('rcpt.handedBack')}</div><div className="coin-report-value num danger-text">{money(tt.advance_refunds)}</div><div className="tiny muted">{t('dc.refundedAdvances')}</div></div>}
                </div>
              </Panel>
            )}
            <ExpensesPanel {...p} onAdd={() => setSheet({ open: true, expense: null })} onEdit={(e) => setSheet({ open: true, expense: e })} />
          </div>
        </div>
      </div>

      <ExpenseSheet open={sheet.open} expense={sheet.expense} onClose={() => setSheet({ open: false, expense: null })}
        defaultDate={p.date} today={p.today} minDate={p.expenseMinDate} staff={p.staff} canDelete={p.canManageExpenses} />
      <Dialog open={reopenOpen} onClose={() => setReopenOpen(false)} title={p.date === p.today ? t('dc.reopenToday') : t('dc.reopenDate', { date: fmtDateShort(p.date, t.locale) })}
        footer={<><Button onClick={() => setReopenOpen(false)} disabled={pending}>{t('common.cancel')}</Button><Button variant="primary" icon="unlock" onClick={reopen} loading={pending}>{t('dc.reopenDay')}</Button></>}>
        <p className="ink2">{t('dc.reopenBody', { money: money(closed?.counted_cash ?? 0) })}</p>
      </Dialog>
    </>
  );
}

// ---------- Date navigation ----------
function DateBar({ date, today, recent, onGo }: { date: string; today: string; recent: DayCloseProps['recent']; onGo: (d: string) => void }) {
  const t = useT();
  return (
    <div className="dc-datebar no-print">
      <div className="row dc-datepick">
        <Button size="sm" icon="chevronLeft" aria-label={t('cal.prevDay')} onClick={() => onGo(addDays(date, -1))} />
        <input type="date" className="input input-sm date-input" value={date} max={today} aria-label={t('dc.day')}
          onChange={(e) => { if (e.target.value && e.target.value <= today) onGo(e.target.value); }} />
        <Button size="sm" icon="chevronRight" aria-label={t('cal.nextDay')} disabled={date >= today} onClick={() => onGo(addDays(date, 1))} />
      </div>
      <nav className="dc-recent" aria-label={t('dc.recent')}>
        {recent.map((r) => (
          <button key={r.date} type="button" className={`dc-day${r.closed ? ' is-closed' : ''}`} aria-current={r.date === date ? 'date' : undefined} onClick={() => onGo(r.date)}
            title={r.closed ? `${t('dc.closedShort')} · ${r.difference != null && Math.abs(r.difference) >= 0.005 ? t(r.difference > 0 ? 'dc.excessN' : 'dc.shortN', { money: money(Math.abs(r.difference)) }) : t('dc.cashMatched')}` : t('dc.notClosed')}>
            <span className="dc-day-name">{r.date === today ? t('time.today') : dateParts(r.date, t.locale).wd}</span>
            <span className="dc-day-num num">{Number(r.date.slice(8))}</span>
            <span className={`dc-day-mark${r.closed ? (r.difference != null && r.difference < -0.005 ? ' is-short' : ' is-ok') : ''}`} aria-hidden>
              {r.closed ? <Icon name={r.difference != null && r.difference < -0.005 ? 'alert' : 'check'} size={11} strokeWidth={2.6} /> : null}
            </span>
            <span className="sr-only">{r.closed ? t('dc.closedShort') : t('dc.notClosed')}</span>
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
  const t = useT();
  const tt = s.totals;
  const cash = s.by_method.cash ?? { bills: 0, coins: 0, packages: 0, advances: 0, refunds: 0, net: 0 };
  const nuIn = Object.entries(s.by_method).filter(([m]) => m.startsWith('cash_'));
  const nuBills = nuIn.reduce((a, [, r]) => a + r.bills + r.coins + (r.packages || 0) + (r.advances || 0), 0);
  return (
    <div className="stack">
      <div className="dc-recon" role="table" aria-label={t('dc.rupeeCash')}>
        <ReconRow label={t('dc.opening')} value={money(tt.opening_cash)}
          sub={s.opening.from_date ? t('dc.openingFrom', { date: fmtDateShort(s.opening.from_date, t.locale) }) : t('dc.openingNone')} />
        <ReconRow sign="+" label={t('dc.cashBills')} value={money(cash.bills)} sub={t('dc.cashBillsSub')} />
        {cash.coins > 0 && <ReconRow sign="+" label={t('dc.cashCoins')} value={money(cash.coins)} />}
        {cash.packages > 0 && <ReconRow sign="+" label={t('dc.cashPackages')} value={money(cash.packages)} />}
        {cash.advances > 0 && <ReconRow sign="+" label={t('dc.cashAdvances')} value={money(cash.advances)} />}
        {tt.cash_refunds > 0 && <ReconRow sign="−" label={<span className="danger-text">{tt.package_refunds > 0 || tt.advance_refunds > 0 ? t('dc.handedBackAll') : t('dc.handedBackBills')}</span>} value={money(tt.cash_refunds)} />}
        <ReconRow sign="−" label={t('dc.cashExpenses')} value={money(tt.expenses_cash)} />
        <ReconRow sign="=" label={t('dc.expected')} value={money(tt.expected_cash)} strong />
      </div>
      {showsNu(s) && (
        <div className="dc-recon dc-recon-nu" role="table" aria-label={t('dc.nuCash')}>
          <div className="dc-recon-cap tiny muted">{t('dc.nuCap')}</div>
          <ReconRow label={t('dc.nuOpening')} value={fmtNu(tt.opening_cash_nu)} />
          <ReconRow sign="+" label={t('dc.nuReceived')} value={fmtNu(nuBills)} />
          {tt.cash_refunds_nu > 0 && <ReconRow sign="−" label={t('rcpt.handedBack')} value={fmtNu(tt.cash_refunds_nu)} />}
          <ReconRow sign="=" label={t('dc.nuExpected')} value={fmtNu(tt.expected_cash_nu)} strong />
        </div>
      )}
    </div>
  );
}

function DiffBadge({ check, nu }: { check: CashCheck; nu?: boolean }) {
  const t = useT();
  const amt = nu ? fmtNu(Math.abs(check.amount)) : money(Math.abs(check.amount));
  if (check.kind === 'balanced') return <Badge tone="success">{t('dc.matches')}</Badge>;
  return check.kind === 'short' ? <Badge tone="danger">{t('dc.shortN', { money: amt })}</Badge> : <Badge tone="marigold">{t('dc.excessN', { money: amt })}</Badge>;
}

function DiffBox({ check, nu, label }: { check: CashCheck | null; nu?: boolean; label: string }) {
  const t = useT();
  if (!check) return <div className="dc-diff is-empty"><span className="small muted">{label}</span><span className="dc-diff-value muted">—</span><span className="tiny muted">{t('dc.enterCounted')}</span></div>;
  const amt = nu ? fmtNu(Math.abs(check.amount)) : money(Math.abs(check.amount));
  return (
    <div className={`dc-diff is-${check.kind}`} aria-live="polite">
      <span className="small">{label}</span>
      <span className="dc-diff-value num">{check.kind === 'balanced' ? t('dc.matches') : t(check.kind === 'short' ? 'dc.shortBy' : 'dc.excessBy', { money: amt })}</span>
      <span className="tiny">{check.kind === 'balanced' ? t('dc.balancedSub') : check.kind === 'short' ? t('dc.shortSub') : t('dc.excessSub')}</span>
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
  const t = useT();
  const tt = s.totals;
  const blank = (v: string) => v.trim() === '';
  const countedV = parseAmount(counted);
  const nuV = parseAmount(countedNu);
  const outV = parseAmount(out);
  const check = blank(counted) ? null : cashDifference(countedV, tt.expected_cash);
  const checkNu = !nu || blank(countedNu) ? null : cashDifference(nuV, tt.expected_cash_nu);
  const left = Math.max(0, countedV - outV);
  const isToday = date === today;

  const submit = () => start(async () => {
    setError(null);
    if (blank(counted)) return setError(t('dc.errCount'));
    if (nu && blank(countedNu) && tt.expected_cash_nu !== 0) return setError(t('dc.errNu', { nu: fmtNu(tt.expected_cash_nu) }));
    if (outV > countedV) return setError(t('err.outMore'));
    if (check && check.kind !== 'balanced' && !notes.trim()) return setError(t(check.kind === 'short' ? 'dc.errNoteShort' : 'dc.errNoteExcess'));
    const r = await closeDay({ date, countedCash: countedV, countedCashNu: nu && !blank(countedNu) ? nuV : null, cashOut: outV, notes });
    if (!r.ok) return setError(t.err(r.error));
    toast(t('dc.closedToast'));
    router.refresh();
  });

  return (
    <form className="dc-form stack" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="dc-form-head">
        <h3>{isToday ? t('dc.closeToday') : t('dc.closeDate', { date: fmtDateShort(date, t.locale) })}</h3>
        <p className="small muted">{t('dc.countHint')}</p>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="dc-count">
        <div className="field">
          <label htmlFor="dc-counted">{t('dc.counted')}</label>
          <div className="prefix-input dc-big-input"><span>₹</span>
            <input id="dc-counted" className="input num" inputMode="decimal" autoComplete="off" placeholder="0"
              value={counted} onChange={(e) => setCounted(e.target.value.replace(/[^\d.,]/g, ''))} />
          </div>
        </div>
        <DiffBox check={check} label={t('dc.rupees')} />
      </div>
      {nu && (
        <div className="dc-count">
          <div className="field">
            <label htmlFor="dc-counted-nu">{t('dc.nuCounted')}</label>
            <div className="prefix-input dc-big-input"><span>Nu</span>
              <input id="dc-counted-nu" className="input num" inputMode="decimal" autoComplete="off" placeholder="0"
                value={countedNu} onChange={(e) => setCountedNu(e.target.value.replace(/[^\d.,]/g, ''))} />
            </div>
          </div>
          <DiffBox check={checkNu} nu label={t('dc.ngultrum')} />
        </div>
      )}
      <div className="grid-2 dc-form-more">
        <div className="field">
          <label htmlFor="dc-out">{t('dc.out')}</label>
          <div className="prefix-input"><span>₹</span>
            <input id="dc-out" className="input num" inputMode="decimal" autoComplete="off" placeholder="0"
              value={out} onChange={(e) => setOut(e.target.value.replace(/[^\d.,]/g, ''))} />
          </div>
          <span className="hint">{blank(counted) ? t('dc.outHint') : rich(t('dc.outHintLeft'), { money: <span className="strong num">{money(left)}</span> })}</span>
        </div>
        <TextArea label={check && check.kind !== 'balanced' ? t('dc.noteRequired') : t('dc.noteOptional')} rows={2} maxLength={500} value={notes}
          placeholder={check?.kind === 'short' ? t('dc.notePhShort') : t('dc.notePh')}
          onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="dc-form-foot">
        <Button type="submit" variant="primary" size="lg" icon="lock" loading={pending}>{t('dc.closeBtn')}</Button>
        <span className="tiny muted">{t('dc.closeNote')}</span>
      </div>
    </form>
  );
}

function ClosedResult({ close, nu }: { close: DayClose; nu: boolean }) {
  const t = useT();
  const check = cashDifference(close.counted_cash, close.expected_cash);
  const left = close.counted_cash - close.cash_out;
  return (
    <div className="stack">
      <div className="dc-closed">
        <div><span className="small muted">{t('dc.countedShort')}</span><span className="dc-closed-value num">{money(close.counted_cash)}</span></div>
        <div><span className="small muted">{t('dc.expectedShort')}</span><span className="dc-closed-value num">{money(close.expected_cash)}</span></div>
        <div className={`is-${check.kind}`}><span className="small muted">{t('dc.difference')}</span>
          <span className="dc-closed-value num">{check.kind === 'balanced' ? t('dc.matches') : `${check.kind === 'short' ? '−' : '+'}${money(Math.abs(check.amount))}`}</span></div>
      </div>
      {nu && close.counted_cash_nu != null && (
        <div className="dc-closed">
          <div><span className="small muted">{t('dc.nuCountedShort')}</span><span className="dc-closed-value num">{fmtNu(close.counted_cash_nu)}</span></div>
          <div><span className="small muted">{t('dc.nuExpectedShort')}</span><span className="dc-closed-value num">{fmtNu(close.expected_cash_nu)}</span></div>
          <div className={`is-${cashDifference(close.counted_cash_nu, close.expected_cash_nu).kind}`}><span className="small muted">{t('dc.difference')}</span>
            <span className="dc-closed-value num">{(() => { const c = cashDifference(close.counted_cash_nu!, close.expected_cash_nu); return c.kind === 'balanced' ? t('dc.matches') : `${c.amount < 0 ? '−' : '+'}${fmtNu(Math.abs(c.amount))}`; })()}</span></div>
        </div>
      )}
      <dl className="dc-closed-meta">
        <div><dt>{t('dc.takenOut')}</dt><dd className="num">{money(close.cash_out)}{close.cash_out_nu ? ` + ${fmtNu(close.cash_out_nu)}` : ''}</dd></div>
        <div><dt>{t('dc.leftTomorrow')}</dt><dd className="num">{money(left)}{nu && close.counted_cash_nu != null ? ` + ${fmtNu(close.counted_cash_nu - (close.cash_out_nu ?? 0))}` : ''}</dd></div>
      </dl>
      {close.notes && <blockquote className="dc-note">{close.notes}</blockquote>}
    </div>
  );
}

// ---------- Team ----------
function collectedParts(t: Translator, byMethod: Record<string, number>): string[] {
  return sortMethods(Object.keys(byMethod)).filter((m) => byMethod[m]).map((m) => `${mLabel(t, m)} ${m.startsWith('cash_') ? fmtNu(byMethod[m]) : money(byMethod[m])}`);
}
const collectedLine = (t: Translator, byMethod: Record<string, number>) => collectedParts(t, byMethod).join(' · ');

function TeamPanel({ rows }: { rows: DaySummary['by_staff'] }) {
  const t = useT();
  const total = rows.reduce((a, r) => ({ services: a.services + r.services, sales: a.sales + r.sales, collected: a.collected + r.collected }), { services: 0, sales: 0, collected: 0 });
  return (
    <Panel title={t('dc.byTeam')} flush className="dc-clip">
      {rows.length ? (
        <div className="table-wrap">
          <table className="table dc-team">
            <thead><tr><th>{t('common.name')}</th><th className="right hide-mobile">{t('appt.services')}</th><th className="right">{t('dc.sales')} <span className="hide-mobile">{t('dc.beforeGst')}</span></th><th className="right">{t('dc.tookPayments')}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.staff_id ?? ''}-${r.user_id ?? ''}-${r.name}`}>
                  <td>
                    <div className="row nowrap"><span className="dot" style={{ background: r.color ?? 'var(--faint)' }} /><span className="strong">{r.name}</span></div>
                    {r.services > 0 && <div className="tiny muted show-mobile dc-team-sub">{t('common.services', { count: r.services })}</div>}
                  </td>
                  <td className="right num hide-mobile">{r.services || <span className="muted">—</span>}</td>
                  <td className="right num">{r.sales ? money(Math.round(r.sales)) : <span className="muted">—</span>}</td>
                  <td className="right">
                    {r.collected ? <><div className="num strong">{money(r.collected)}</div><div className="tiny muted dc-took">{collectedParts(t, r.collected_by_method).map((x) => <span key={x}>{x}</span>)}</div></> : <span className="muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td className="strong">{t('common.total')}</td><td className="right num hide-mobile">{total.services}</td><td className="right num">{money(Math.round(total.sales))}</td><td className="right num strong">{money(total.collected)}</td></tr></tfoot>
          </table>
        </div>
      ) : <p className="panel-body small muted">{t('dc.teamEmpty')}</p>}
      <div className="panel-foot tiny muted">{t('dc.teamFoot')}</div>
    </Panel>
  );
}

// ---------- Red flags ----------
function VoidsPanel({ voids, tz, date }: { voids: DaySummary['voids']; tz: string; date: string }) {
  const t = useT();
  if (!voids.length) {
    return <div className="dc-okline"><Icon name="check" size={16} />{t('dc.noVoids')}</div>;
  }
  return (
    <section className="panel dc-flag" aria-labelledby="dc-voids">
      <div className="panel-head">
        <h2 id="dc-voids" className="row" style={{ gap: 8 }}><Icon name="alert" size={18} />{t('dc.voids')}</h2>
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
                  <span className="muted"> · {v.customer ?? t('common.walkIn')}</span>
                </div>
                <span className="num strong dc-void-amt">{money(v.total)}</span>
              </div>
              <div className="small ink2">
                {v.voided_by ? t('dc.voidedBy', { name: v.voided_by, time: fmtTime(v.voided_at, tz) }) : t('dc.voidedAt', { time: fmtTime(v.voided_at, tz) })}
                {' · '}{(() => { const when = sameDay ? fmtTime(v.created_at, tz) : fmtDateShort(localDate(new Date(v.created_at), tz), t.locale); return v.billed_by ? t('dc.billedBy', { name: v.billed_by, when }) : t('dc.billedAt', { when }); })()}
              </div>
              {v.reason && <div className="small dc-void-reason">“{v.reason}”</div>}
              {v.paid > 0 && (
                <div className="tiny danger-text strong">{t('dc.voidPaid', { list: collectedLine(t, v.paid_by_method) })}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function DiscountsPanel({ s, tz }: { s: DaySummary; tz: string }) {
  const t = useT();
  const tt = s.totals;
  if (!s.discounts.length) return <div className="dc-okline is-muted"><Icon name="check" size={16} />{t('dc.noDiscounts')}</div>;
  return (
    <Panel title={t('dc.discounts')} flush actions={<span className="small muted num">{t('common.bills', { count: tt.discounted_bills })} · {money(tt.discounts)}</span>}>
      <ul className="list">
        {s.discounts.map((d) => {
          const pct = pctOf(d.discount, d.subtotal);
          return (
            <li key={d.id} className="between">
              <div style={{ minWidth: 0 }}>
                <div><Link href={`/app/invoices/${d.id}`} className="strong num">{d.invoice_no}</Link><span className="muted"> · {d.customer ?? t('common.walkIn')}</span></div>
                <div className="tiny muted">{d.billed_by ? `${t('dc.billedByShort', { name: d.billed_by })} · ` : ''}{fmtTime(d.created_at, tz)} · {t('dc.billTotal', { money: money(d.total) })}</div>
              </div>
              <div className="right nowrap">
                <div className="num strong">−{money(d.discount)}</div>
                {pct >= 20 ? <Badge tone="marigold">{t('dc.pctOff', { pct })}</Badge> : <span className="tiny muted num">{t('dc.pctOff', { pct })}</span>}
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
  const t = useT();
  const rows = methodRows(s.by_method);
  const money_ = rows.filter((r) => !isPrepaid(r.method));
  const coins = rows.find((r) => isCoins(r.method));
  const pkg = rows.find((r) => r.method === 'package');
  const adv = rows.find((r) => r.method === 'advance');
  return (
    <Panel title={t('dc.payments')} flush className="dc-clip" actions={<Link className="btn btn-ghost btn-sm no-print" href={`/app/invoices?range=custom&from=${date}&to=${date}`}>{t('dc.seeBills')}</Link>}>
      {money_.length || coins || pkg || adv ? (
        <ul className="list dc-methods">
          {money_.map(({ method, row }) => {
            const parts = [row.bills ? t('dc.partBills', { money: fmt(method, row.bills) }) : '', row.coins ? t('dc.partCoins', { money: fmt(method, row.coins) }) : '',
              row.packages ? t('dc.partPackages', { money: fmt(method, row.packages) }) : '', row.advances ? t('dc.partAdvances', { money: fmt(method, row.advances) }) : '',
              row.refunds ? t('dc.partRefunds', { money: fmt(method, row.refunds) }) : ''].filter(Boolean);
            return (
              <li key={method} className="row">
                <span className="dc-method-icon"><Icon name={METHOD_ICON[method] ?? 'wallet'} size={17} /></span>
                <div className="grow">
                  <div className="strong">{mLabel(t, method)}</div>
                  {(row.coins > 0 || row.packages > 0 || row.advances > 0 || row.refunds > 0) && <div className="tiny muted">{parts.join(' · ')}</div>}
                </div>
                <span className="num strong">{fmt(method, row.net)}</span>
              </li>
            );
          })}
          <li className="row dc-methods-total"><span className="grow strong">{t('dc.collected')}</span><span className="num strong">{money(s.totals.collected)}</span></li>
          {coins && (
            <li className="row">
              <span className="dc-method-icon is-coins"><Icon name="coins" size={17} /></span>
              <div className="grow"><div>{t('dc.paidCoins')}</div><div className="tiny muted">{t('dc.paidCoinsSub')}</div></div>
              <span className="num muted">{fmtCoins(coins.row.bills - coins.row.refunds)}</span>
            </li>
          )}
          {pkg && (
            <li className="row">
              <span className="dc-method-icon is-coins"><Icon name="box" size={17} /></span>
              <div className="grow"><div>{t('dc.pkgSessions')}</div><div className="tiny muted">{t('dc.pkgSessionsSub')}</div></div>
              <span className="num muted">{money(pkg.row.bills - pkg.row.refunds)}</span>
            </li>
          )}
          {adv && (
            <li className="row">
              <span className="dc-method-icon is-coins"><Icon name="heart" size={17} /></span>
              <div className="grow"><div>{t('dc.advUsed')}</div><div className="tiny muted">{t('dc.advUsedSub')}</div></div>
              <span className="num muted">{money(adv.row.bills - adv.row.refunds)}</span>
            </li>
          )}
        </ul>
      ) : <p className="panel-body small muted">{t('dc.noPayments')}</p>}
    </Panel>
  );
}
const fmt = (method: string, n: number) => (method.startsWith('cash_') ? fmtNu(n) : money(n));

// ---------- Expenses ----------
function ExpensesPanel(p: DayCloseProps & { onAdd: () => void; onEdit: (e: ExpenseRow) => void }) {
  const t = useT();
  const s = p.summary;
  const cats = Object.entries(s.expenses.by_category).filter(([, v]) => v).sort((a, b) => b[1]! - a[1]!);
  const canAddHere = p.canAddExpense && !p.close && (!p.expenseMinDate || p.date >= p.expenseMinDate);
  return (
    <Panel title={t('nav.expenses')} flush className="dc-clip" actions={canAddHere ? <Button size="sm" icon="plus" className="no-print" onClick={p.onAdd}>{t('dc.addExpense')}</Button> : undefined}>
      {p.expensesHidden ? (
        cats.length ? (
          <ul className="list">
            {cats.map(([c, v]) => <li key={c} className="between"><span>{c}</span><span className="num strong">{money(v!)}</span></li>)}
          </ul>
        ) : <p className="panel-body small muted">{t('dc.noExpenses')}</p>
      ) : p.expenses.length ? (
        <ul className="list">
          {p.expenses.map((e) => {
            const editable = p.canManageExpenses && !p.close;
            const body = (
              <>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="strong truncate">{e.category}{e.staff_name ? ` · ${e.staff_name}` : ''}</div>
                  <div className="tiny muted truncate">{[t(`paidFrom.${e.paid_from}`), e.note, e.created_by_name ? t('dc.addedBy', { name: e.created_by_name }) : ''].filter(Boolean).join(' · ')}</div>
                </div>
                <span className="num strong">{money(e.amount)}</span>
              </>
            );
            return (
              <li key={e.id} style={{ padding: 0 }}>
                {editable
                  ? <button type="button" className="dc-exp-row" onClick={() => p.onEdit(e)} aria-label={t('dc.editExpense', { name: e.category, money: money(e.amount) })}>{body}<Icon name="chevronRight" size={16} className="muted no-print" /></button>
                  : <div className="dc-exp-row">{body}</div>}
              </li>
            );
          })}
          <li className="between dc-methods-total"><span className="strong">{t('common.total')}</span><span className="num strong">{money(s.totals.expenses)}</span></li>
        </ul>
      ) : (
        <p className="panel-body small muted">{canAddHere ? t('dc.nothingSpentYet') : t('dc.noExpenses')}</p>
      )}
      {p.expensesHidden && <div className="panel-foot tiny muted">{t('dc.expensesHidden')}</div>}
    </Panel>
  );
}
