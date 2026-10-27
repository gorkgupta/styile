'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Button, Empty, Panel } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { Topbar } from './shell';
import { money } from '@/lib/billing';
import { fmtCoins } from '@/lib/coins';
import { daysInRange, eachDay, RANGE_PRESETS, rangeLabel, type ReportRange } from '@/lib/report-range';
import { dayKeyOf, fmtDateShort } from '@/lib/time';
import type { ApptStatus, BookingSource, PayMethod, SalonReport } from '@/lib/types';
import { METHOD_LABEL, SOURCE_LABEL } from '@/lib/types';

export interface ReportsProps {
  report: SalonReport;
  /** Same-length period just before, for comparisons. null when unavailable. */
  previous: SalonReport | null;
  range: ReportRange;
  today: string;
  salonName: string;
}

const n = (v: unknown) => Number(v ?? 0) || 0;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** ₹1.2L / ₹12K / ₹850 — Indian short form for axes and tight labels. */
function moneyShort(v: number): string {
  const a = Math.abs(v);
  const trim = (x: number) => (Math.abs(x) >= 100 ? Math.round(x).toString() : (Math.round(x * 10) / 10).toString());
  if (a >= 1e7) return `₹${trim(v / 1e7)}Cr`;
  if (a >= 1e5) return `₹${trim(v / 1e5)}L`;
  if (a >= 1e3) return `₹${trim(v / 1e3)}K`;
  return `₹${Math.round(v)}`;
}

function Delta({ now, before, label }: { now: number; before: number | null; label: string }) {
  if (before === null) return null;
  if (before === 0) return now > 0 ? <span className="delta">New this period</span> : null;
  const change = Math.round(((now - before) / before) * 100);
  if (change === 0) return <span className="delta">Same as {label}</span>;
  const up = change > 0;
  return (
    <span className={`delta ${up ? 'delta-up' : 'delta-down'}`}>
      <span aria-hidden>{up ? '▲' : '▼'}</span> {Math.abs(change)}%<span className="sr-only">{up ? ' up' : ' down'}</span> vs {label}
    </span>
  );
}

export function ReportsScreen({ report, previous, range, today, salonName }: ReportsProps) {
  const days = daysInRange(range.from, range.to);
  const prevLabel = range.key === 'today' ? 'yesterday' : range.key === 'yesterday' ? 'day before' : range.key === 'month' || range.key === 'lastmonth' ? 'previous month' : `previous ${days} days`;
  const series = useMemo(() => {
    const byDay = new Map<string, { revenue: number; bills: number }>(report.by_day.map((d) => [d.day, { revenue: n(d.revenue), bills: n(d.bills) }]));
    return eachDay(range.from, range.to).map((day) => ({ day, revenue: byDay.get(day)?.revenue ?? 0, bills: byDay.get(day)?.bills ?? 0 }));
  }, [report.by_day, range.from, range.to]);

  const appts = report.appointments ?? {};
  const totalAppts = Object.values(appts).reduce((s, v) => s + n(v), 0);
  const empty = n(report.bills) === 0 && totalAppts === 0 && n(report.new_clients) === 0;

  const exportCsv = () => {
    const rows = [['Date', 'Revenue (INR)', 'Bills'], ...series.map((d) => [d.day, d.revenue.toFixed(2), String(d.bills)])];
    const blob = new Blob(['﻿' + rows.map((r) => r.join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${salonName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-revenue-${range.from}-to-${range.to}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <>
      <Topbar title="Reports" subtitle={rangeLabel(range.from, range.to)}
        actions={<Button onClick={exportCsv} disabled={empty}><span className="hide-mobile">Export CSV</span><span className="show-mobile">CSV</span></Button>} />
      <div className="page">
        <RangePicker range={range} today={today} />

        <div className="stats stats-6">
          <StatTile label="Revenue" value={money(n(report.revenue))} delta={<Delta now={n(report.revenue)} before={previous ? n(previous.revenue) : null} label={prevLabel} />} />
          <StatTile label="Collected" value={money(n(report.collected))}
            sub={n(report.revenue) - n(report.collected) > 0.5 ? <span className="warn-text">{money(n(report.revenue) - n(report.collected))} still due</span> : 'All bills paid'} />
          <StatTile label="Bills" value={n(report.bills).toLocaleString('en-IN')} delta={<Delta now={n(report.bills)} before={previous ? n(previous.bills) : null} label={prevLabel} />} />
          <StatTile label="Average bill" value={money(n(report.avg_bill))} delta={<Delta now={n(report.avg_bill)} before={previous ? n(previous.avg_bill) : null} label={prevLabel} />} />
          <StatTile label="New clients" value={n(report.new_clients).toLocaleString('en-IN')} delta={<Delta now={n(report.new_clients)} before={previous ? n(previous.new_clients) : null} label={prevLabel} />} />
          <StatTile label="GST collected" value={money(n(report.tax))} sub="CGST + SGST on bills" />
        </div>

        {empty ? (
          <div className="panel">
            <Empty icon="chart" title="No sales or bookings in this period" action={<Link className="btn btn-secondary" href="/app/reports?range=month">See this month</Link>}>
              Reports fill in as you bill clients and take bookings. Try a longer range.
            </Empty>
          </div>
        ) : (
          <>
            <Panel title="Revenue by day" actions={<span className="legend"><span className="legend-key" style={{ background: 'var(--peacock)' }} />Weekday<span className="legend-key" style={{ background: 'var(--marigold)' }} />Weekend</span>}>
              {days > 1 ? <RevenueChart series={series} today={today} /> : (
                <p className="small muted">Pick a longer range to see how revenue changes day to day.</p>
              )}
            </Panel>

            <div className="split reports-split">
              <TeamTable rows={report.by_staff} />
              <div className="stack">
                <SourcesPanel bySource={report.by_source ?? {}} />
                <MethodsPanel byMethod={report.by_method ?? {}} />
                <CoinsReportPanel report={report} />
              </div>
            </div>

            <div className="grid-2 reports-bottom">
              <TopServices rows={report.by_service} />
              <OutcomesPanel appts={appts} total={totalAppts} />
            </div>
          </>
        )}
      </div>
    </>
  );
}

function StatTile({ label, value, sub, delta }: { label: string; value: string; sub?: ReactNode; delta?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-sub">{delta ?? sub ?? ' '}</div>
    </div>
  );
}

function RangePicker({ range, today }: { range: ReportRange; today: string }) {
  const router = useRouter();
  const [custom, setCustom] = useState(range.key === 'custom');
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  useEffect(() => { setFrom(range.from); setTo(range.to); setCustom(range.key === 'custom'); }, [range]);
  const valid = !!from && !!to && from <= to && to <= today;

  return (
    <div className="range-bar">
      <select className="select show-mobile range-select" aria-label="Date range" value={custom ? 'custom' : range.key}
        onChange={(e) => { if (e.target.value === 'custom') setCustom(true); else router.push(`/app/reports?range=${e.target.value}`); }}>
        {RANGE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        <option value="custom">Custom dates…</option>
      </select>
      <nav className="segmented range-presets hide-mobile" aria-label="Date range">
        {RANGE_PRESETS.map((p) => (
          <Link key={p.key} href={`/app/reports?range=${p.key}`} aria-current={range.key === p.key && !custom ? 'page' : undefined} onClick={() => setCustom(false)}>{p.label}</Link>
        ))}
        <button type="button" aria-pressed={custom} onClick={() => setCustom(true)}>Custom</button>
      </nav>
      {custom && (
        <form className="range-custom" onSubmit={(e) => { e.preventDefault(); if (valid) router.push(`/app/reports?range=custom&from=${from}&to=${to}`); }}>
          <label className="sr-only" htmlFor="rep-from">From</label>
          <input id="rep-from" type="date" className="input input-sm" value={from} max={today} onChange={(e) => setFrom(e.target.value)} />
          <span className="muted small">to</span>
          <label className="sr-only" htmlFor="rep-to">To</label>
          <input id="rep-to" type="date" className="input input-sm" value={to} max={today} onChange={(e) => setTo(e.target.value)} />
          <Button type="submit" size="sm" variant="primary" disabled={!valid}>Show</Button>
        </form>
      )}
    </div>
  );
}

// ---------- Revenue by day: hand-drawn SVG column chart ----------

/** A round step so 3–4 gridlines land on clean values (₹5K, ₹10K, ₹25K…). */
function niceStep(v: number): number {
  if (v <= 0) return 250;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

function RevenueChart({ series, today }: { series: { day: string; revenue: number; bills: number }[]; today: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    setWidth(el.clientWidth || 800);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = 220, top = 22, bottom = 26, left = 44, right = 4;
  const plotW = Math.max(width - left - right, 50), plotH = H - top - bottom;
  const max = Math.max(...series.map((d) => d.revenue), 0);
  const step = niceStep(max / 3);
  const yMax = Math.max(step, Math.ceil(max / step) * step);
  const ticks = Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step);
  const slot = plotW / series.length;
  const barW = Math.max(2, Math.min(24, slot * 0.66));
  const y = (v: number) => top + plotH - (v / yMax) * plotH;
  const x = (i: number) => left + slot * i + (slot - barW) / 2;

  const withSales = series.map((d, i) => ({ ...d, i })).filter((d) => d.revenue > 0);
  const maxPt = withSales.reduce<typeof withSales[number] | null>((m, d) => (!m || d.revenue > m.revenue ? d : m), null);
  const minPt = withSales.length > 2 ? withSales.reduce<typeof withSales[number] | null>((m, d) => (!m || d.revenue < m.revenue ? d : m), null) : null;
  const total = series.reduce((s, d) => s + d.revenue, 0);
  const openDays = withSales.length;

  // x labels: every day when roomy, else every Nth plus the last.
  const every = Math.ceil(series.length / Math.max(1, Math.floor(plotW / 46)));
  const showLabel = (i: number) => i % every === 0;
  const short = series.length <= 10;
  const xLabel = (day: string) => (short ? fmtDateShort(day).split(',')[0] : String(Number(day.slice(8))));

  const bar = (d: { revenue: number }, i: number) => {
    const h = Math.max(d.revenue > 0 ? 2 : 0, (d.revenue / yMax) * plotH);
    const r = Math.min(4, barW / 2, h);
    const x0 = x(i), y0 = top + plotH - h, x1 = x0 + barW, base = top + plotH;
    return `M${x0},${base}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x1 - r}Q${x1},${y0} ${x1},${y0 + r}V${base}Z`;
  };
  const hv = hover !== null ? series[hover] : null;
  const valueLabel = (pt: { revenue: number; i: number } | null, kind: string) => {
    if (!pt) return null;
    const cx = Math.min(Math.max(x(pt.i) + barW / 2, left + 24), left + plotW - 24);
    return <text x={cx} y={y(pt.revenue) - 7} textAnchor="middle" className="chart-val">{moneyShort(pt.revenue)}<title>{kind}</title></text>;
  };

  return (
    <div className="stack-sm">
      <div className="chart-readout" aria-live="polite">
        {hv ? (
          <><span className="strong">{fmtDateShort(hv.day)}</span><span className="num">{money(hv.revenue)}</span><span className="muted">{hv.bills} bill{hv.bills === 1 ? '' : 's'}</span></>
        ) : (
          <><span className="muted">Daily average</span><span className="num strong">{money(openDays ? Math.round(total / openDays) : 0)}</span>
            <span className="muted">on {openDays} day{openDays === 1 ? '' : 's'} with sales{maxPt ? ` · best ${fmtDateShort(maxPt.day)}` : ''}</span></>
        )}
      </div>
      <div ref={wrap} className="chart-wrap">
        <svg width={width} height={H} role="img" aria-labelledby="rev-title rev-desc" onMouseLeave={() => setHover(null)}>
          <title id="rev-title">Revenue by day</title>
          <desc id="rev-desc">{`Highest ${maxPt ? `${money(maxPt.revenue)} on ${fmtDateShort(maxPt.day)}` : 'none'}. Total ${money(total)}.`}</desc>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={left + plotW} y1={y(t)} y2={y(t)} className={t === 0 ? 'chart-base' : 'chart-grid'} />
              <text x={left - 8} y={y(t) + 4} textAnchor="end" className="chart-tick">{moneyShort(t)}</text>
            </g>
          ))}
          {series.map((d, i) => {
            const wk = ['sat', 'sun'].includes(dayKeyOf(d.day));
            return (
              <g key={d.day}>
                <path d={bar(d, i)} className={`chart-bar${wk ? ' is-weekend' : ''}${hover !== null && hover !== i ? ' is-dim' : ''}`} />
                {(showLabel(i) || d.day === today) && (
                  <text x={x(i) + barW / 2} y={H - 8} textAnchor="middle" className={`chart-tick${d.day === today ? ' is-today' : ''}`}>{d.day === today && !short ? 'Today' : xLabel(d.day)}</text>
                )}
                <rect x={left + slot * i} y={top} width={slot} height={plotH} fill="transparent" tabIndex={-1}
                  onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)}>
                  <title>{`${fmtDateShort(d.day)}: ${money(d.revenue)}, ${d.bills} bills`}</title>
                </rect>
              </g>
            );
          })}
          {valueLabel(maxPt, 'Highest')}
          {minPt && minPt.i !== maxPt?.i && slot >= 30 && valueLabel(minPt, 'Lowest')}
        </svg>
      </div>
      <table className="sr-only">
        <caption>Revenue by day</caption>
        <thead><tr><th>Date</th><th>Revenue</th><th>Bills</th></tr></thead>
        <tbody>{series.map((d) => <tr key={d.day}><td>{d.day}</td><td>{money(d.revenue)}</td><td>{d.bills}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

// ---------- Panels ----------

function TeamTable({ rows }: { rows: SalonReport['by_staff'] }) {
  const total = rows.reduce((s, r) => ({ revenue: s.revenue + n(r.revenue), services: s.services + n(r.services), commission: s.commission + n(r.commission) }), { revenue: 0, services: 0, commission: 0 });
  return (
    <Panel title="Team performance" flush>
      {rows.length ? (
        <div className="table-wrap">
          <table className="table team-table">
            <thead>
              <tr><th>Stylist</th><th className="right hide-mobile">Services</th><th className="right">Sales <span className="hide-mobile">(before GST)</span></th><th className="right">Commission</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.staff_id}>
                  <td>
                    <div className="row nowrap"><span className="dot" style={{ background: r.color }} /><span className="strong">{r.name}</span></div>
                    <div className="bar team-share" aria-hidden><span style={{ width: `${pct(n(r.revenue), total.revenue)}%` }} /></div>
                  </td>
                  <td className="right num hide-mobile">{n(r.services)}</td>
                  <td className="right num">{money(Math.round(n(r.revenue)))}</td>
                  <td className="right num strong">{money(Math.round(n(r.commission)))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td className="strong">Total</td><td className="right num hide-mobile">{total.services}</td><td className="right num">{money(Math.round(total.revenue))}</td><td className="right num strong">{money(Math.round(total.commission))}</td></tr>
            </tfoot>
          </table>
        </div>
      ) : <p className="panel-body small muted">No services billed to a stylist in this period. Pick the stylist on each bill line to track commission.</p>}
      <div className="panel-foot tiny muted">Commission is worked out on each stylist’s sales before GST, using the rate set under Team.</div>
    </Panel>
  );
}

const SOURCE_ORDER: BookingSource[] = ['whatsapp', 'online', 'walk_in', 'staff', 'phone'];

function SourcesPanel({ bySource }: { bySource: Partial<Record<BookingSource, number>> }) {
  const total = SOURCE_ORDER.reduce((s, k) => s + n(bySource[k]), 0);
  const wa = n(bySource.whatsapp);
  const selfServe = wa + n(bySource.online);
  return (
    <Panel title="Where bookings came from">
      {total ? (
        <div className="stack">
          <div className="wa-callout">
            <span className="wa-callout-icon"><Icon name="whatsapp" size={20} /></span>
            <div>
              <div><span className="wa-callout-num num">{pct(wa, total)}%</span> <span className="ink2">booked on WhatsApp</span></div>
              <div className="small muted">{wa.toLocaleString('en-IN')} of {total.toLocaleString('en-IN')} appointments, most without a call to the front desk. {pct(selfServe, total)}% booked themselves online or on WhatsApp.</div>
            </div>
          </div>
          <div className="stack-sm">
            {SOURCE_ORDER.map((k) => (
              <div key={k} className="bar-row">
                <span className={k === 'whatsapp' ? 'strong' : 'ink2'}>{SOURCE_LABEL[k]}</span>
                <div className="bar" aria-hidden><span className={k === 'whatsapp' ? undefined : 'bar-muted'} style={{ width: `${pct(n(bySource[k]), total)}%` }} /></div>
                <span className="num small nowrap bar-val">{n(bySource[k])} <span className="muted">· {pct(n(bySource[k]), total)}%</span></span>
              </div>
            ))}
          </div>
        </div>
      ) : <p className="small muted">No bookings in this period.</p>}
    </Panel>
  );
}

const METHOD_ORDER: PayMethod[] = ['upi', 'card', 'cash', 'wallet', 'other'];
const METHOD_COLOR: Record<PayMethod, string> = { upi: '#0F6E73', card: '#7A3FB8', cash: '#C2541B', wallet: '#2F6DB5', other: '#7A7486' };

function MethodsPanel({ byMethod }: { byMethod: Partial<Record<PayMethod, number>> }) {
  const present = METHOD_ORDER.filter((m) => n(byMethod[m]) > 0);
  const total = present.reduce((s, m) => s + n(byMethod[m]), 0);
  return (
    <Panel title="Payment methods">
      {total ? (
        <div className="stack">
          <div className="stacked-bar" role="img" aria-label={present.map((m) => `${METHOD_LABEL[m]} ${pct(n(byMethod[m]), total)}%`).join(', ')}>
            {present.map((m) => <span key={m} style={{ flexGrow: n(byMethod[m]), background: METHOD_COLOR[m] }} />)}
          </div>
          <ul className="legend-list">
            {present.map((m) => (
              <li key={m}>
                <span className="legend-key" style={{ background: METHOD_COLOR[m] }} />
                <span className="grow">{METHOD_LABEL[m]}</span>
                <span className="num">{money(Math.round(n(byMethod[m])))}</span>
                <span className="num muted legend-pct">{pct(n(byMethod[m]), total)}%</span>
              </li>
            ))}
          </ul>
        </div>
      ) : <p className="small muted">No payments recorded in this period.</p>}
    </Panel>
  );
}

function CoinsReportPanel({ report }: { report: SalonReport }) {
  const sold = n(report.coins_sold), bonus = n(report.coins_bonus), used = n(report.coins_redeemed), owed = n(report.coins_outstanding);
  if (!sold && !bonus && !used && !owed) return null;
  return (
    <Panel title={<h2 className="row" style={{ gap: 8 }}><Icon name="coins" size={18} className="coin-title-icon" />Coins</h2>}>
      <div className="stack">
        <div className="coin-report">
          <div><div className="small muted">Coins sold</div><div className="coin-report-value num">{money(Math.round(sold))}</div><div className="tiny muted">Received in this period</div></div>
          <div><div className="small muted">Bonus given</div><div className="coin-report-value num">{fmtCoins(Math.round(bonus))}</div><div className="tiny muted">{sold ? `${pct(bonus, sold)}% on top of sales` : 'coins'}</div></div>
          <div><div className="small muted">Coins used</div><div className="coin-report-value num">{fmtCoins(Math.round(used))}</div><div className="tiny muted">On bills, net of refunds</div></div>
          <div><div className="small muted">Outstanding</div><div className="coin-report-value num">{money(Math.round(owed))}</div><div className="tiny muted">All clients’ balances now</div></div>
        </div>
        <p className="tiny muted">Coins sold are advances, not revenue — bills paid with coins already count in revenue and GST. Outstanding is services you still owe clients.</p>
      </div>
    </Panel>
  );
}

function TopServices({ rows }: { rows: SalonReport['by_service'] }) {
  const max = Math.max(...rows.map((r) => n(r.revenue)), 1);
  return (
    <Panel title="Top services" actions={rows.length ? <span className="small muted">By revenue</span> : undefined}>
      {rows.length ? (
        <div className="stack-sm">
          {rows.slice(0, 8).map((r) => (
            <div key={r.name} className="bar-row">
              <span className="truncate" title={r.name}>{r.name}</span>
              <div className="bar" aria-hidden><span style={{ width: `${(n(r.revenue) / max) * 100}%` }} /></div>
              <span className="num small nowrap bar-val">{money(Math.round(n(r.revenue)))} <span className="muted">· {n(r.count)}</span></span>
            </div>
          ))}
        </div>
      ) : <p className="small muted">No services billed in this period.</p>}
    </Panel>
  );
}

const OUTCOMES: { key: string; label: string; statuses: ApptStatus[]; color: string }[] = [
  { key: 'done', label: 'Completed', statuses: ['completed'], color: 'var(--success)' },
  { key: 'upcoming', label: 'Still to come', statuses: ['booked', 'confirmed', 'checked_in', 'in_service', 'waiting'], color: 'var(--peacock-100)' },
  { key: 'cancelled', label: 'Cancelled', statuses: ['cancelled'], color: 'var(--faint)' },
  { key: 'no_show', label: 'No-show', statuses: ['no_show'], color: 'var(--danger)' },
];

function OutcomesPanel({ appts, total }: { appts: Partial<Record<ApptStatus, number>>; total: number }) {
  const counts = OUTCOMES.map((o) => ({ ...o, count: o.statuses.reduce((s, st) => s + n(appts[st]), 0) }));
  const noShow = counts.find((c) => c.key === 'no_show')!.count;
  const cancelled = counts.find((c) => c.key === 'cancelled')!.count;
  return (
    <Panel title="Appointment outcomes" actions={total ? <span className="small muted num">{total.toLocaleString('en-IN')} appointments</span> : undefined}>
      {total ? (
        <div className="stack">
          <div className="stacked-bar" role="img" aria-label={counts.map((c) => `${c.label} ${pct(c.count, total)}%`).join(', ')}>
            {counts.filter((c) => c.count > 0).map((c) => <span key={c.key} style={{ flexGrow: c.count, background: c.color }} />)}
          </div>
          <div className="outcomes">
            {counts.map((c) => (
              <div key={c.key} className="outcome">
                <div className="row small ink2"><span className="legend-key" style={{ background: c.color }} />{c.label}</div>
                <div className="outcome-num num">{pct(c.count, total)}%</div>
                <div className="tiny muted num">{c.count.toLocaleString('en-IN')}</div>
              </div>
            ))}
          </div>
          {pct(noShow, total) >= 5 ? (
            <p className="small ink2 row" style={{ alignItems: 'flex-start' }}><Badge tone="marigold">Tip</Badge><span>No-shows are {pct(noShow, total)}% of bookings. WhatsApp reminders go out automatically — ask for an advance on long services to cut this further.</span></p>
          ) : (
            <p className="small muted">{cancelled ? `${cancelled} cancelled, mostly freeing the slot for someone else.` : 'No cancellations.'} No-shows are low — reminders are working.</p>
          )}
        </div>
      ) : <p className="small muted">No appointments in this period.</p>}
    </Panel>
  );
}
