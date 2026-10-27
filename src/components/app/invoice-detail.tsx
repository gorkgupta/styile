'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Dialog, Notice, TextArea, useToast } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { Topbar } from './shell';
import { InvoiceStatusBadge, METHOD_ICON, PAY_METHODS, REF_PLACEHOLDER, parseAmount } from './billing-bits';
import { addPayment, resendInvoice, voidInvoice } from '@/actions/billing';
import { amountInWords, money, money2 } from '@/lib/billing';
import { coinsText, usableCoins } from '@/lib/coins';
import { formatPhone } from '@/lib/phone';
import { fmtDateYear } from '@/lib/periods';
import { fmtTime } from '@/lib/time';
import type { Invoice, InvoiceItem, PayMethod, Payment } from '@/lib/types';
import { METHOD_LABEL } from '@/lib/types';

/** SAC for hairdressing, barbers' and beauty services (GST). */
const SALON_SAC = '999721';

const STATE_CODES: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi',
  '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha',
  '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra',
  '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman & Nicobar',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
};

export interface InvoiceDetailProps {
  invoice: Invoice;
  items: InvoiceItem[];
  payments: Payment[];
  customer: { id: string; name: string; phone: string; email: string | null; coin_balance?: number } | null;
  salon: {
    name: string; legal_name: string | null; gstin: string | null; phone: string | null; email: string | null;
    address: string | null; city: string | null; state: string | null; pincode: string | null; waConnected: boolean;
  };
  staffNames: Record<string, string>;
  tz: string;
  canVoid: boolean;
}

export function InvoiceDetail({ invoice: inv, items, payments, customer, salon, staffNames, tz, canVoid }: InvoiceDetailProps) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [payOpen, setPayOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [method, setMethod] = useState<PayMethod>('upi');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const total = Number(inv.total);
  const paidTotal = Number(inv.paid_total);
  const due = Math.max(Math.round((total - paidTotal) * 100) / 100, 0);
  const isVoid = inv.status === 'void';
  const rates = [...new Set(items.map((i) => Number(i.gst_rate)))];
  const half = rates.length === 1 ? ` @ ${rates[0] / 2}%` : '';
  const stateCode = salon.gstin?.slice(0, 2) ?? '';
  const placeOfSupply = salon.state || STATE_CODES[stateCode] || '';
  const addressLines = [salon.address, [salon.city, salon.state].filter(Boolean).join(', ') + (salon.pincode ? ` – ${salon.pincode}` : '')].filter((x) => x && x.trim());
  const totalQty = items.reduce((s, i) => s + Number(i.qty), 0);

  const coinBalance = Number(customer?.coin_balance ?? 0);
  const coinsPaid = payments.filter((p) => p.method === 'wallet').reduce((s, p) => s + Number(p.amount), 0);
  const coinsBlocked = !customer ? 'This bill has no client, so coins can’t be used.' : coinBalance <= 0 ? `${customer.name.split(' ')[0]} has no coins.` : null;
  const pickMethod = (m: PayMethod) => {
    setMethod(m);
    if (m === 'wallet') setAmount(String(usableCoins(coinBalance, due)));
    else if (method === 'wallet') setAmount(String(due));
  };
  const openPay = () => { setError(null); setMethod('upi'); setAmount(String(due)); setReference(''); setPayOpen(true); };
  const savePayment = () => start(async () => {
    setError(null);
    const amt = parseAmount(amount);
    if (!amt) return setError('Enter the amount received.');
    if (amt > due) return setError(`Only ${money(due)} is due on this bill.`);
    if (method === 'wallet' && amt > coinBalance) return setError(`${customer?.name.split(' ')[0] ?? 'The client'} has only ${coinsText(coinBalance)}.`);
    const r = await addPayment(inv.id, method, amt, reference);
    if (!r.ok) return setError(r.error);
    toast(r.message ?? 'Payment recorded'); setPayOpen(false); router.refresh();
  });
  const cancelBill = () => start(async () => {
    setError(null);
    if (!reason.trim()) return setError('Give a reason — it is kept with the bill for your GST records.');
    const r = await voidInvoice(inv.id, reason);
    if (!r.ok) return setError(r.error);
    toast(r.message ?? 'Bill cancelled'); setVoidOpen(false); router.refresh();
  });
  const send = () => start(async () => {
    const r = await resendInvoice(inv.id);
    if (!r.ok) return toast(r.error, 'error');
    toast(r.message ?? 'Sent on WhatsApp');
  });

  return (
    <>
      <Topbar back="/app/invoices" title={<span className="row">Bill {inv.invoice_no} <InvoiceStatusBadge status={inv.status} /></span>}
        subtitle={`${customer?.name ?? 'Walk-in'} · ${fmtDateYear(inv.created_at, tz)}, ${fmtTime(inv.created_at, tz)}`}
        actions={<Button icon="printer" onClick={() => window.print()}><span className="hide-mobile">Print</span></Button>} />
      <div className="page invoice-page">
        <div className="invoice-actions no-print">
          {!isVoid && due > 0 && <Button variant="primary" icon="wallet" onClick={openPay}>Record payment · {money(due)}</Button>}
          {!isVoid && customer && (
            <Button icon="whatsapp" loading={pending && !payOpen && !voidOpen} onClick={send} disabled={!salon.waConnected}
              title={salon.waConnected ? undefined : 'Connect WhatsApp in Settings to send bills'}>Send on WhatsApp</Button>
          )}
          {customer && <Link className="btn btn-ghost" href={`/app/customers/${customer.id}`}><Icon name="user" size={18} />Client profile</Link>}
          {canVoid && !isVoid && <Button variant="ghost" className="invoice-void-btn" icon="trash" onClick={() => { setError(null); setReason(''); setVoidOpen(true); }}>Cancel bill</Button>}
        </div>
        {isVoid && <div className="no-print"><Notice tone="error">This bill was cancelled{inv.void_reason ? `: ${inv.void_reason}` : ''}. Its number stays used and it is left out of your sales and GST totals.</Notice></div>}
        {!isVoid && !salon.gstin && <div className="no-print"><Notice tone="warn">Add your GSTIN in <Link href="/app/settings">Settings</Link> so it prints on your tax invoices.</Notice></div>}

        <article className={`invoice-doc${isVoid ? ' is-cancelled' : ''}`} aria-label={`Tax invoice ${inv.invoice_no}`}>
          {isVoid && <div className="invoice-watermark" aria-hidden>CANCELLED</div>}
          <header className="invoice-head">
            <div className="invoice-seller">
              <div className="invoice-salon">{salon.name}</div>
              {salon.legal_name && salon.legal_name !== salon.name && <div className="strong small">{salon.legal_name}</div>}
              {addressLines.map((l) => <div key={l} className="small ink2">{l}</div>)}
              <div className="small ink2">
                {[salon.phone ? `Ph: ${formatPhone(salon.phone)}` : '', salon.email ?? ''].filter(Boolean).join(' · ')}
              </div>
              {salon.gstin && <div className="small"><span className="muted">GSTIN </span><span className="strong mono">{salon.gstin}</span></div>}
            </div>
            <div className="invoice-title">
              <div className="invoice-kind">{isVoid ? 'Tax Invoice — Cancelled' : 'Tax Invoice'}</div>
              <dl className="invoice-meta">
                <dt>Bill no.</dt><dd className="strong num">{inv.invoice_no}</dd>
                <dt>Date</dt><dd className="num">{fmtDateYear(inv.created_at, tz)}</dd>
                <dt>Time</dt><dd className="num">{fmtTime(inv.created_at, tz)}</dd>
                {placeOfSupply && <><dt>Place of supply</dt><dd>{placeOfSupply}{stateCode && STATE_CODES[stateCode] ? ` (${stateCode})` : ''}</dd></>}
              </dl>
            </div>
          </header>

          <section className="invoice-billto">
            <div className="tiny muted invoice-label">Bill to</div>
            {customer ? (
              <>
                <div className="strong">{customer.name}</div>
                <div className="small ink2 num">{formatPhone(customer.phone)}{customer.email ? ` · ${customer.email}` : ''}</div>
              </>
            ) : <div className="strong">Walk-in client</div>}
          </section>

          <table className="invoice-table">
            <thead>
              <tr>
                <th className="col-n">#</th>
                <th>Description</th>
                <th className="col-opt">SAC/HSN</th>
                <th className="right">Qty</th>
                <th className="right col-opt">Rate</th>
                <th className="right col-opt">Discount</th>
                <th className="right col-opt">Taxable</th>
                <th className="right col-opt">GST</th>
                <th className="right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={it.id}>
                  <td className="col-n muted num">{i + 1}</td>
                  <td>
                    <div className="strong">{it.name}</div>
                    {it.staff_id && staffNames[it.staff_id] && <div className="tiny muted">by {staffNames[it.staff_id]}</div>}
                    <div className="tiny muted show-narrow num">
                      {money2(it.unit_price)} each{Number(it.discount) > 0 ? ` · −${money2(it.discount)} discount` : ''}
                    </div>
                  </td>
                  <td className="col-opt num small">{it.kind === 'product' ? '—' : SALON_SAC}</td>
                  <td className="right num">{Number(it.qty)}</td>
                  <td className="right num col-opt">{money2(it.unit_price)}</td>
                  <td className="right num col-opt">{Number(it.discount) > 0 ? money2(it.discount) : '—'}</td>
                  <td className="right num col-opt">{money2(it.taxable)}</td>
                  <td className="right num col-opt">{Number(it.gst_rate)}%</td>
                  <td className="right num strong">{money2(it.line_total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="col-n" />
                <td className="muted small">{items.length} item{items.length === 1 ? '' : 's'}</td>
                <td className="col-opt" />
                <td className="right num small">{totalQty}</td>
                <td className="col-opt" />
                <td className="right num col-opt small">{Number(inv.discount_total) > 0 ? money2(inv.discount_total) : ''}</td>
                <td className="right num col-opt small">{money2(inv.taxable_total)}</td>
                <td className="col-opt" />
                <td />
              </tr>
            </tfoot>
          </table>

          <section className="invoice-bottom">
            <div className="invoice-words stack-sm">
              <div>
                <div className="tiny muted invoice-label">Amount in words</div>
                <div className="strong small">{amountInWords(total)}</div>
              </div>
              <div>
                <div className="tiny muted invoice-label">Payments received</div>
                {payments.length ? (
                  <ul className="invoice-payments">
                    {payments.map((p) => (
                      <li key={p.id}>
                        <span>{METHOD_LABEL[p.method]}{p.reference ? <span className="muted"> · {p.reference}</span> : null}
                          <span className="muted tiny invoice-pay-when">{fmtDateYear(p.created_at, tz)}, {fmtTime(p.created_at, tz)}</span></span>
                        <span className="num">{money2(p.amount)}</span>
                      </li>
                    ))}
                  </ul>
                ) : <div className="small ink2">None yet</div>}
              </div>
              {inv.notes && <div><div className="tiny muted invoice-label">Note</div><div className="small">{inv.notes}</div></div>}
            </div>
            <dl className="totals invoice-totals">
              <dt>Subtotal</dt><dd>{money2(inv.subtotal)}</dd>
              {Number(inv.discount_total) > 0 && <><dt>Discount</dt><dd>−{money2(inv.discount_total)}</dd></>}
              <dt>Taxable value</dt><dd>{money2(inv.taxable_total)}</dd>
              {Number(inv.igst) > 0 ? (
                <><dt>IGST</dt><dd>{money2(inv.igst)}</dd></>
              ) : (
                <><dt>CGST{half}</dt><dd>{money2(inv.cgst)}</dd><dt>SGST{half}</dt><dd>{money2(inv.sgst)}</dd></>
              )}
              {Number(inv.round_off) !== 0 && <><dt>Round off</dt><dd>{Number(inv.round_off) > 0 ? '+' : '−'}{money2(Math.abs(Number(inv.round_off)))}</dd></>}
              <dt className="grand">Total</dt><dd className="grand">{money2(total)}</dd>
              <dt>Paid</dt><dd>{money2(paidTotal)}</dd>
              <dt className={due > 0 && !isVoid ? 'strong warn-text' : 'strong'}>Balance due</dt>
              <dd className={due > 0 && !isVoid ? 'strong warn-text' : 'strong'}>{money2(isVoid ? 0 : due)}</dd>
            </dl>
          </section>

          <footer className="invoice-foot">
            <div className="strong">Thank you for visiting {salon.name}!</div>
            <div className="tiny muted">{inv.prices_include_tax ? 'Prices are inclusive of GST. ' : ''}This is a computer-generated invoice and needs no signature.</div>
          </footer>
        </article>
      </div>

      <Dialog open={payOpen} onClose={() => setPayOpen(false)} title="Record payment"
        footer={<><Button variant="ghost" onClick={() => setPayOpen(false)}>Cancel</Button><Button variant="primary" loading={pending} onClick={savePayment}>Record {money(parseAmount(amount))}</Button></>}>
        <p className="small ink2">{money(due)} is due on bill {inv.invoice_no}{customer ? ` for ${customer.name}` : ''}.</p>
        <div className="field">
          <span className="label">Paid by</span>
          <div className="row-wrap">
            {PAY_METHODS.map((m) => (
              <button key={m} type="button" className="chip chip-sm" aria-pressed={method === m} onClick={() => pickMethod(m)}
                disabled={m === 'wallet' && !!coinsBlocked} title={m === 'wallet' ? coinsBlocked ?? undefined : undefined}>
                <Icon name={METHOD_ICON[m]} size={14} />{METHOD_LABEL[m]}
              </button>
            ))}
          </div>
          {method === 'wallet' ? <span className="hint num">{coinsText(coinBalance)} available · 1 coin = ₹1</span>
            : coinBalance > 0 ? <span className="hint num">{customer?.name.split(' ')[0]} has {coinsText(coinBalance)}</span>
            : <span className="hint">{coinsBlocked}</span>}
        </div>
        <div className="field">
          <label htmlFor="pay-amt">Amount</label>
          <div className="prefix-input"><span>₹</span><input id="pay-amt" className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></div>
        </div>
        {method !== 'cash' && method !== 'wallet' && <input className="input" placeholder={REF_PLACEHOLDER[method]} value={reference} onChange={(e) => setReference(e.target.value)} aria-label="Payment reference" />}
        {error && <Notice tone="error">{error}</Notice>}
      </Dialog>

      <Dialog open={voidOpen} onClose={() => setVoidOpen(false)} title={`Cancel bill ${inv.invoice_no}?`}
        footer={<><Button variant="ghost" onClick={() => setVoidOpen(false)}>Keep bill</Button><Button variant="danger" loading={pending} onClick={cancelBill}>Cancel bill</Button></>}>
        <p className="small ink2">The bill stays on record marked as cancelled (GST rules need the number kept). {money(total)} is removed from sales{customer ? ` and from ${customer.name}’s total spend` : ''}.</p>
        <div className="row-wrap">
          {['Billed twice by mistake', 'Wrong items or amount', 'Client did not take the service'].map((r) => (
            <button key={r} type="button" className="chip chip-sm" aria-pressed={reason === r} onClick={() => setReason(r)}>{r}</button>
          ))}
        </div>
        <TextArea label="Reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this bill being cancelled?" />
        {coinsPaid > 0 && <p className="tiny ink2">{coinsText(coinsPaid)} paid on this bill go back to {customer?.name ?? 'the client'}’s balance.</p>}
        {paidTotal - coinsPaid > 0 && <p className="tiny muted">{money(paidTotal - coinsPaid)} was collected on this bill — refund it separately if needed.</p>}
        {error && <Notice tone="error">{error}</Notice>}
      </Dialog>
    </>
  );
}
