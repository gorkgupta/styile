'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Empty, Panel, SearchInput, Segmented, Stat } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { Topbar } from './shell';
import { InvoiceStatusBadge, methodSummary } from './billing-bits';
import { money } from '@/lib/billing';
import { formatPhone } from '@/lib/phone';
import { describeRange, RANGE_LABEL, type DateRange, type RangeKey } from '@/lib/periods';
import { fmtDateShort, fmtTime, localDate } from '@/lib/time';
import { COMPOSITION_RATE } from '@/lib/gst';
import type { GstMode, InvoiceStatus, PayMethod } from '@/lib/types';

export interface InvoiceListRow {
  id: string; invoice_no: string; created_at: string; total: number; paid_total: number; tax: number; status: InvoiceStatus;
  /** Composition salons: estimated 6% the salon pays on this bill. */
  composition_tax?: number;
  customer: { id: string; name: string; phone: string } | null; methods: PayMethod[];
}

type StatusFilter = 'all' | 'paid' | 'due' | 'void';

export interface InvoicesProps {
  rows: InvoiceListRow[];
  range: DateRange;
  today: string;
  tz: string;
  /** True when the period has more bills than were loaded. */
  truncated?: boolean;
  initialStatus?: string;
  initialQuery?: string;
  /** Which tax tile to show: GST (regular), composition estimate, or none. */
  gstMode?: GstMode;
}

const PRESETS: RangeKey[] = ['today', 'yesterday', 'week', 'month', 'custom'];

export function InvoicesScreen({ rows, range, today, tz, truncated, initialStatus, initialQuery, gstMode = 'regular' }: InvoicesProps) {
  const router = useRouter();
  const [status, setStatus] = useState<StatusFilter>(['paid', 'due', 'void'].includes(initialStatus ?? '') ? initialStatus as StatusFilter : 'all');
  const [q, setQ] = useState(initialQuery ?? '');
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [customOpen, setCustomOpen] = useState(range.key === 'custom');

  const totals = useMemo(() => {
    const live = rows.filter((r) => r.status !== 'void');
    return {
      count: live.length,
      total: live.reduce((s, r) => s + r.total, 0),
      collected: live.reduce((s, r) => s + r.paid_total, 0),
      due: live.reduce((s, r) => s + Math.max(r.total - r.paid_total, 0), 0),
      gst: live.reduce((s, r) => s + r.tax, 0),
      composition: live.reduce((s, r) => s + (r.composition_tax ?? 0), 0),
      cancelled: rows.length - live.length,
    };
  }, [rows]);

  const counts = useMemo(() => ({
    all: rows.length,
    paid: rows.filter((r) => r.status === 'paid').length,
    due: rows.filter((r) => r.status === 'unpaid' || r.status === 'partial').length,
    void: rows.filter((r) => r.status === 'void').length,
  }), [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const digits = needle.replace(/\D/g, '');
    return rows.filter((r) => {
      if (status === 'paid' && r.status !== 'paid') return false;
      if (status === 'due' && r.status !== 'unpaid' && r.status !== 'partial') return false;
      if (status === 'void' && r.status !== 'void') return false;
      if (!needle) return true;
      return r.invoice_no.toLowerCase().includes(needle) || !!r.customer?.name.toLowerCase().includes(needle)
        || (digits.length >= 4 && !!r.customer?.phone.includes(digits));
    });
  }, [rows, status, q]);

  const singleDay = range.from === range.to;
  const go = (key: RangeKey, f?: string, t?: string) => {
    if (key === 'custom') {
      setCustomOpen(true);
      if (!f || !t) return;
      router.push(`/app/invoices?range=custom&from=${f}&to=${t}`);
      return;
    }
    setCustomOpen(false);
    router.push(key === 'today' ? '/app/invoices' : `/app/invoices?range=${key}`);
  };

  const when = (iso: string) => {
    const d = localDate(new Date(iso), tz);
    if (singleDay) return fmtTime(iso, tz);
    return `${d === today ? 'Today' : fmtDateShort(d)}, ${fmtTime(iso, tz)}`;
  };

  return (
    <>
      <Topbar title="Bills" subtitle={`${RANGE_LABEL[range.key]} · ${describeRange(range)}`}
        actions={<Link className="btn btn-primary" href="/app/pos"><Icon name="plus" /><span className="hide-mobile">New bill</span></Link>} />
      <div className="page">
        <div className="filters">
          <div className="filters-scroll">
            <Segmented label="Period" value={customOpen ? 'custom' : range.key} onChange={(k) => go(k)}
              options={PRESETS.map((k) => ({ value: k, label: RANGE_LABEL[k] }))} />
          </div>
          {customOpen && (
            <form className="row-wrap" onSubmit={(e) => { e.preventDefault(); go('custom', from, to); }}>
              <input type="date" className="input input-sm date-input" value={from} max={today} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
              <span className="muted small">to</span>
              <input type="date" className="input input-sm date-input" value={to} max={today} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
              <Button type="submit" size="sm">Show</Button>
            </form>
          )}
        </div>

        <div className="stats">
          <Stat label={singleDay ? 'Bills' : 'Bills in period'} value={totals.count} sub={totals.cancelled ? `${totals.cancelled} cancelled` : 'None cancelled'} />
          <Stat label="Billed" value={money(Math.round(totals.total))} sub={totals.count ? `Average ${money(Math.round(totals.total / totals.count))}` : '—'} />
          <Stat label="Collected" value={money(Math.round(totals.collected))} sub={totals.due > 0 ? <span className="warn-text strong">{money(Math.round(totals.due))} still due</span> : 'Nothing pending'} />
          {gstMode === 'regular' ? <Stat label="GST" value={money(Math.round(totals.gst))} sub="CGST + SGST" />
            : gstMode === 'composition' ? <Stat label="Composition tax (est.)" value={money(Math.round(totals.composition))} sub={`${COMPOSITION_RATE}% · payable by you`} />
            : <Stat label="GST" value="None" sub="Not registered · no GST charged" />}
        </div>

        <Panel flush title={
          <div className="filters grow">
            <div className="filters-scroll">
              <Segmented label="Bill status" value={status} onChange={setStatus} options={[
                { value: 'all', label: <>All <span className="seg-count">{counts.all}</span></> },
                { value: 'paid', label: <>Paid <span className="seg-count">{counts.paid}</span></> },
                { value: 'due', label: <>Unpaid <span className="seg-count">{counts.due}</span></> },
                { value: 'void', label: <>Cancelled <span className="seg-count">{counts.void}</span></> },
              ]} />
            </div>
            <div className="filters-search"><SearchInput value={q} onChange={setQ} placeholder="Bill no. or client" /></div>
          </div>
        }>
          {shown.length ? (
            <>
              <div className="table-wrap hide-mobile">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Bill no.</th><th>{singleDay ? 'Time' : 'Date'}</th><th>Client</th>
                      <th>Paid by</th><th>Status</th><th className="right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.id} className={`clickable${r.status === 'void' ? ' is-void' : ''}`} onClick={() => router.push(`/app/invoices/${r.id}`)}>
                        <td className="nowrap"><Link href={`/app/invoices/${r.id}`} className="strong num" onClick={(e) => e.stopPropagation()}>{r.invoice_no}</Link></td>
                        <td className="num nowrap ink2">{when(r.created_at)}</td>
                        <td>{r.customer ? <><div className="strong">{r.customer.name}</div><div className="tiny muted num">{formatPhone(r.customer.phone)}</div></> : <span className="muted">Walk-in</span>}</td>
                        <td className="ink2 small">{methodSummary(r.methods)}</td>
                        <td>
                          <InvoiceStatusBadge status={r.status} />
                          {r.status === 'partial' && <div className="tiny muted num" style={{ marginTop: 2 }}>{money(r.total - r.paid_total)} due</div>}
                        </td>
                        <td className="right num strong amount-cell">{money(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="list show-mobile">
                {shown.map((r) => (
                  <li key={r.id} style={{ padding: 0 }}>
                    <Link href={`/app/invoices/${r.id}`} className={`list-link${r.status === 'void' ? ' is-void' : ''}`}>
                      <div className="grow">
                        <div className="strong truncate">{r.customer?.name ?? 'Walk-in'}</div>
                        <div className="tiny muted num truncate">{[r.invoice_no, when(r.created_at), r.methods.length ? methodSummary(r.methods) : ''].filter(Boolean).join(' · ')}</div>
                      </div>
                      <div className="right stack-sm" style={{ gap: 3, alignItems: 'flex-end' }}>
                        <span className="num strong amount-cell">{money(r.total)}</span>
                        <InvoiceStatusBadge status={r.status} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
              {truncated && <div className="panel-foot small muted">Showing the latest {rows.length} bills. Pick a shorter period to see older ones.</div>}
            </>
          ) : rows.length ? (
            <Empty icon="search" title="No bills match" action={<Button size="sm" onClick={() => { setQ(''); setStatus('all'); }}>Clear filters</Button>}>
              Try another bill number or client name.
            </Empty>
          ) : (
            <Empty icon="receipt" title={range.key === 'today' ? 'No bills yet today' : 'No bills in this period'}
              action={<Link className="btn btn-primary btn-sm" href="/app/pos"><Icon name="plus" size={16} />New bill</Link>}>
              Bills you create at checkout appear here with their payment status.
            </Empty>
          )}
        </Panel>
      </div>
    </>
  );
}
