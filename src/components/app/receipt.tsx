'use client';
// Thermal receipt for 80 mm and 58 mm roll printers. The same facts as the A4 bill, in one narrow column:
// salon header, bill type, lines, totals, GST summary (tax invoices only), payments, a UPI QR when money is due.
import { amountInWords, money2, taxByRate } from '@/lib/billing';
import { billDocument } from '@/lib/gst';
import { formatPhone } from '@/lib/phone';
import { fmtDateYear } from '@/lib/periods';
import { fmtTime } from '@/lib/time';
import type { Invoice, InvoiceItem, Payment } from '@/lib/types';
import { METHOD_LABEL } from '@/lib/types';
import { isValidVpa } from '@/lib/upi';
import { UpiQr } from '@/components/ui/upi-qr';

export type ReceiptWidth = '80' | '58';

export interface ReceiptProps {
  width: ReceiptWidth;
  invoice: Invoice;
  items: InvoiceItem[];
  payments: Payment[];
  customer: { name: string; phone: string } | null;
  salon: {
    name: string; legal_name: string | null; gstin: string | null; phone: string | null; address: string | null;
    city: string | null; state: string | null; pincode: string | null; upiVpa?: string | null; upiName?: string | null;
  };
  staffNames?: Record<string, string>;
  tz: string;
}

/** Printable width inside the roll's margins (80 mm paper prints ~72 mm, 58 mm prints ~48 mm). */
export const RECEIPT_MM: Record<ReceiptWidth, number> = { '80': 72, '58': 48 };

const amt = (n: number | string) => money2(n).replace('₹', '');

export function Receipt({ width, invoice: inv, items, payments, customer, salon, staffNames = {}, tz }: ReceiptProps) {
  const doc = billDocument(inv.bill_type);
  const narrow = width === '58';
  const isVoid = inv.status === 'void';
  const total = Number(inv.total);
  const due = isVoid ? 0 : Math.max(Math.round((total - Number(inv.paid_total)) * 100) / 100, 0);
  const gstin = doc.showGstin ? inv.seller_gstin ?? salon.gstin : null;
  const rates = doc.showTax ? taxByRate(items) : [];
  const half = rates.length === 1 ? ` @${rates[0].rate / 2}%` : '';
  const place = [salon.address, [salon.city, salon.pincode].filter(Boolean).join(' ')].filter((x) => x && x.trim());
  const upi = due > 0 && isValidVpa(salon.upiVpa) ? { vpa: salon.upiVpa, name: salon.upiName || salon.name } : null;

  return (
    <article className={`receipt receipt-${width}${isVoid ? ' is-void' : ''}`} aria-label={`${doc.title} ${inv.invoice_no}, ${width} mm receipt`}>
      <header className="rc-center">
        <div className="rc-salon">{salon.name}</div>
        {salon.legal_name && salon.legal_name !== salon.name && <div>{salon.legal_name}</div>}
        {place.map((l) => <div key={l}>{l}</div>)}
        {salon.phone && <div>Ph {formatPhone(salon.phone)}</div>}
        {gstin && <div>GSTIN {gstin}</div>}
      </header>
      <div className="rc-rule" />
      <div className="rc-center rc-kind">{isVoid ? `${doc.title} — cancelled` : doc.title}</div>
      {doc.declaration && <div className="rc-center rc-small">{doc.declaration}</div>}
      <div className="rc-row"><span>Bill {inv.invoice_no}</span><span>{fmtDateYear(inv.created_at, tz)}</span></div>
      <div className="rc-row"><span className="rc-trunc">{customer ? customer.name : 'Walk-in'}</span><span>{fmtTime(inv.created_at, tz)}</span></div>
      {customer && !narrow && <div className="rc-small">{formatPhone(customer.phone)}</div>}
      {inv.client_gstin && <div className="rc-small">Client GSTIN {inv.client_gstin}</div>}
      {inv.client_address && <div className="rc-small">{inv.client_address}</div>}
      {doc.showTax && inv.place_of_supply && <div className="rc-small">Place of supply: {inv.place_of_supply}</div>}
      <div className="rc-rule" />

      <div className="rc-row rc-head"><span>Item</span><span className="rc-nowrap">{!narrow && <span className="rc-qty">Qty</span>}Amount</span></div>
      {items.map((it) => {
        const qty = Number(it.qty);
        const meta = [
          narrow || qty > 1 ? `${qty} × ${amt(it.unit_price)}` : '',
          Number(it.discount) > 0 ? `less ${amt(it.discount)}` : '',
          doc.showTax ? `${it.code ? `${it.kind === 'product' ? 'HSN' : 'SAC'} ${it.code} · ` : ''}GST ${Number(it.gst_rate)}%` : '',
          !narrow && it.staff_id && staffNames[it.staff_id] ? staffNames[it.staff_id] : '',
        ].filter(Boolean);
        return (
          <div key={it.id} className="rc-line">
            <div className="rc-row">
              <span className="rc-name">{it.name}</span>
              <span className="rc-nowrap">{!narrow && <span className="rc-qty">{qty}</span>}{amt(it.line_total)}</span>
            </div>
            {meta.length > 0 && <div className="rc-small">{meta.join(' · ')}</div>}
          </div>
        );
      })}
      <div className="rc-rule" />

      <div className="rc-row"><span>Subtotal</span><span>{amt(inv.subtotal)}</span></div>
      {Number(inv.discount_total) > 0 && <div className="rc-row"><span>Discount</span><span>-{amt(inv.discount_total)}</span></div>}
      {doc.showTax && <>
        <div className="rc-row"><span>Taxable value</span><span>{amt(inv.taxable_total)}</span></div>
        <div className="rc-row"><span>CGST{half}</span><span>{amt(inv.cgst)}</span></div>
        <div className="rc-row"><span>SGST{half}</span><span>{amt(inv.sgst)}</span></div>
      </>}
      {Number(inv.round_off) !== 0 && <div className="rc-row"><span>Round off</span><span>{Number(inv.round_off) > 0 ? '+' : '-'}{amt(Math.abs(Number(inv.round_off)))}</span></div>}
      <div className="rc-rule rc-double" />
      <div className="rc-row rc-total"><span>TOTAL</span><span>{money2(total)}</span></div>
      {!narrow && <div className="rc-small">{amountInWords(total)}</div>}

      {rates.length > 1 && <>
        <div className="rc-rule" />
        <div className="rc-row rc-head rc-gst"><span>GST</span><span>Taxable</span><span>CGST</span><span>SGST</span></div>
        {rates.map((r) => {
          const c = Math.round((r.tax / 2) * 100) / 100;
          return <div key={r.rate} className="rc-row rc-gst"><span>{r.rate}%</span><span>{amt(r.taxable)}</span><span>{amt(c)}</span><span>{amt(r.tax - c)}</span></div>;
        })}
      </>}

      <div className="rc-rule" />
      {payments.length ? payments.map((p) => (
        <div key={p.id} className="rc-row"><span>Paid · {METHOD_LABEL[p.method]}</span><span>{amt(p.amount)}</span></div>
      )) : <div className="rc-row"><span>Paid</span><span>0.00</span></div>}
      <div className="rc-row rc-strong"><span>{due > 0 ? 'Balance due' : 'Balance'}</span><span>{money2(due)}</span></div>

      {upi && (
        <div className="rc-center rc-upi">
          <UpiQr vpa={upi.vpa} name={upi.name} amount={due} note={`Bill ${inv.invoice_no}`} size={narrow ? 120 : 150} caption="none" />
          <div className="rc-strong">Scan to pay {money2(due)}</div>
          <div className="rc-small">UPI · {upi.vpa}</div>
        </div>
      )}

      <div className="rc-rule" />
      <footer className="rc-center rc-small">
        <div className="rc-strong">Thank you for visiting!</div>
        {doc.showTax && inv.prices_include_tax && <div>Prices include GST.</div>}
        <div>Computer-generated {doc.noun}.</div>
      </footer>
    </article>
  );
}

/**
 * Print the bill on the chosen paper. Receipts get a page exactly as tall as the receipt (thermal drivers then cut
 * right after it); A4 uses the invoice's own print styles.
 */
export function printPaper(paper: 'a4' | ReceiptWidth) {
  if (typeof window === 'undefined') return;
  const root = document.documentElement;
  document.getElementById('receipt-page-size')?.remove();
  if (paper !== 'a4') {
    const el = document.querySelector<HTMLElement>('.receipt');
    // CSS px are 1/96 inch; add a little paper below the footer for the tear bar.
    // The receipt is shown on screen at its real width, so its screen height is its printed height.
    const heightMm = el ? Math.ceil((el.scrollHeight / 96) * 25.4) + 8 : 200;
    const style = document.createElement('style');
    style.id = 'receipt-page-size';
    style.textContent = `@page { size: ${paper}mm ${heightMm}mm; margin: 0; }`;
    document.head.appendChild(style);
    root.dataset.print = 'receipt';
  }
  const done = () => { delete root.dataset.print; document.getElementById('receipt-page-size')?.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}
