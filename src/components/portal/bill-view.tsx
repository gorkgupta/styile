'use client';
import Link from 'next/link';
import { Badge, Button } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { amountInWords, money2 } from '@/lib/billing';
import { formatPhone } from '@/lib/phone';
import { fmtDateTime } from '@/lib/time';
import type { InvoiceStatus, PayMethod } from '@/lib/types';
import { METHOD_LABEL } from '@/lib/types';
import { PortalHeader } from './portal';

export interface CustomerBill {
  salon: { name: string; legalName: string | null; gstin: string | null; address: string | null; city: string | null; state: string | null; pincode: string | null; phone: string | null; slug: string; timezone: string };
  invoice: {
    invoice_no: string; created_at: string; status: InvoiceStatus; prices_include_tax: boolean;
    subtotal: number; discount_total: number; taxable_total: number; cgst: number; sgst: number; igst: number; round_off: number; total: number; paid_total: number;
  };
  customer: { name: string; phone: string } | null;
  items: { id: string; name: string; qty: number; unit_price: number; discount: number; gst_rate: number; line_total: number; stylist: string | null }[];
  payments: { method: PayMethod; amount: number }[];
}

const STATUS: Record<InvoiceStatus, { label: string; tone: 'success' | 'marigold' | 'danger' }> = {
  paid: { label: 'Paid', tone: 'success' }, partial: { label: 'Part paid', tone: 'marigold' }, unpaid: { label: 'Unpaid', tone: 'marigold' }, void: { label: 'Cancelled', tone: 'danger' },
};

export function BillView({ bill, phone }: { bill: CustomerBill; phone?: string }) {
  const { salon, invoice: inv } = bill;
  const balance = Math.max(0, Number(inv.total) - Number(inv.paid_total));
  const address = [salon.address, salon.city, salon.state, salon.pincode].filter(Boolean).join(', ');
  const rates = [...new Set(bill.items.map((i) => Number(i.gst_rate)))];
  const halfRate = rates.length === 1 ? `${rates[0] / 2}%` : '';
  return (
    <div className="pt">
      <div className="no-print"><PortalHeader phone={phone} /></div>
      <main className="pt-wrap pt-main">
        <div className="between no-print">
          <Link href="/me" className="btn btn-ghost btn-sm"><Icon name="chevronLeft" size={16} />All bookings</Link>
          <Button size="sm" icon="printer" onClick={() => window.print()}>Print or save PDF</Button>
        </div>
        <article className="pt-bill">
          <header className="pt-bill-head">
            <div style={{ minWidth: 0 }}>
              <h1>{salon.name}</h1>
              {salon.legalName && salon.legalName !== salon.name && <div className="small ink2">{salon.legalName}</div>}
              {address && <div className="small muted">{address}</div>}
              {salon.phone && <div className="small muted">{formatPhone(salon.phone)}</div>}
              {salon.gstin && <div className="small"><span className="muted">GSTIN</span> <span className="num strong">{salon.gstin}</span></div>}
            </div>
            <div className="pt-bill-meta">
              <div className="tiny muted">{salon.gstin ? 'Tax invoice' : 'Bill'}</div>
              <div className="strong num">{inv.invoice_no}</div>
              <div className="small muted">{fmtDateTime(inv.created_at, salon.timezone)}</div>
              <Badge tone={STATUS[inv.status].tone}>{STATUS[inv.status].label}</Badge>
            </div>
          </header>

          {bill.customer && (
            <div className="pt-bill-to small">
              <span className="muted">Billed to</span> <span className="strong">{bill.customer.name}</span> <span className="muted num">{formatPhone(bill.customer.phone)}</span>
            </div>
          )}

          <div className="table-wrap">
            <table className="table pt-bill-table">
              <thead><tr><th>Item</th><th className="right">Qty</th><th className="right hide-mobile">Rate</th><th className="right">Amount</th></tr></thead>
              <tbody>
                {bill.items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <div className="strong">{i.name}</div>
                      <div className="tiny muted">{[i.stylist, `GST ${Number(i.gst_rate)}%`, Number(i.discount) ? `Discount ${money2(i.discount)}` : null].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="right num">{Number(i.qty)}</td>
                    <td className="right num hide-mobile">{money2(i.unit_price)}</td>
                    <td className="right num">{money2(i.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <dl className="pt-bill-totals">
            <div><dt>Subtotal</dt><dd className="num">{money2(inv.subtotal)}</dd></div>
            {Number(inv.discount_total) > 0 && <div><dt>Discount</dt><dd className="num">−{money2(inv.discount_total)}</dd></div>}
            <div><dt>Taxable value</dt><dd className="num">{money2(inv.taxable_total)}</dd></div>
            {Number(inv.igst) > 0 ? (
              <div><dt>IGST</dt><dd className="num">{money2(inv.igst)}</dd></div>
            ) : (
              <>
                <div><dt>CGST {halfRate}</dt><dd className="num">{money2(inv.cgst)}</dd></div>
                <div><dt>SGST {halfRate}</dt><dd className="num">{money2(inv.sgst)}</dd></div>
              </>
            )}
            {Number(inv.round_off) !== 0 && <div><dt>Round off</dt><dd className="num">{money2(inv.round_off)}</dd></div>}
            <div className="pt-bill-grand"><dt>Total</dt><dd className="num">{money2(inv.total)}</dd></div>
          </dl>
          <p className="small ink2 pt-bill-words">{amountInWords(Number(inv.total))}</p>
          {inv.prices_include_tax && <p className="tiny muted">Prices include GST.</p>}

          <div className="pt-bill-paid">
            {bill.payments.length > 0 && (
              <div className="row-wrap small">
                <span className="muted">Paid by</span>
                {bill.payments.map((p, i) => <span key={i} className="badge badge-outline">{METHOD_LABEL[p.method]} <span className="num">{money2(p.amount)}</span></span>)}
              </div>
            )}
            <div className="between">
              <span className="strong">{balance > 0 && inv.status !== 'void' ? 'Balance due' : 'Paid'}</span>
              <span className="strong num">{money2(balance > 0 && inv.status !== 'void' ? balance : inv.paid_total)}</span>
            </div>
          </div>
          <p className="tiny muted" style={{ textAlign: 'center' }}>Thank you for visiting {salon.name}.</p>
        </article>
        <div className="no-print" style={{ textAlign: 'center' }}>
          <Link className="btn btn-secondary" href={`/s/${salon.slug}`}>Book again at {salon.name}</Link>
        </div>
      </main>
    </div>
  );
}
