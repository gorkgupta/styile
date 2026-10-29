'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Dialog, Notice, TextArea, useToast } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { Topbar } from './shell';
import { deskMethods, InvoiceStatusBadge, isUpiMethod, METHOD_ICON, parseAmount, refPlaceholder } from './billing-bits';
import { printPaper, Receipt } from './receipt';
import { UpiQr } from '@/components/ui/upi-qr';
import { isValidVpa } from '@/lib/upi';
import { addPayment, resendInvoice, voidInvoice } from '@/actions/billing';
import { amountInWords, money, money2, taxByRate } from '@/lib/billing';
import { billDocument, placeOfSupply as placeOf } from '@/lib/gst';
import { usableCoins } from '@/lib/coins';
import { formatPhone } from '@/lib/phone';
import { fmtDateYear } from '@/lib/periods';
import { fmtTime } from '@/lib/time';
import type { Invoice, InvoiceItem, PayMethod, Payment, ReceiptSize } from '@/lib/types';
import { METHOD_LABEL } from '@/lib/types';
import { rich, useT } from '@/lib/i18n/react';
import { coinsT } from '@/lib/i18n/format';

/** SAC printed on bills issued before per-line codes were stored (0007). */
const SALON_SAC = '999721';

export interface InvoiceDetailProps {
  invoice: Invoice;
  items: InvoiceItem[];
  payments: Payment[];
  customer: { id: string; name: string; phone: string; email: string | null; coin_balance?: number } | null;
  salon: {
    name: string; legal_name: string | null; gstin: string | null; phone: string | null; email: string | null;
    address: string | null; city: string | null; state: string | null; pincode: string | null; waConnected: boolean;
    /** The salon's own UPI ID: a pay-by-QR is shown while money is due. */
    upiVpa?: string | null; upiName?: string | null;
    /** Default paper for printing (Settings); can be changed here before printing. */
    receiptSize?: ReceiptSize;
    /** Payment types the desk sees. */
    payMethods?: PayMethod[];
  };
  staffNames: Record<string, string>;
  tz: string;
  canVoid: boolean;
  /** Just saved at the POS with "Print receipt" on: print once on arrival. */
  autoPrint?: boolean;
}

// The printed bill itself (A4 invoice and thermal receipt) stays in English: it is a GST document. The screen around it
// (actions, dialogs, notices) is in the desk's language.
const PAPERS: ReceiptSize[] = ['a4', '80', '58'];

export function InvoiceDetail({ invoice: inv, items, payments, customer, salon, staffNames, tz, canVoid, autoPrint }: InvoiceDetailProps) {
  const router = useRouter();
  const tr = useT();
  const [paper, setPaper] = useState<ReceiptSize>(salon.receiptSize ?? 'a4');
  const printed = useRef(false);
  useEffect(() => {
    if (!autoPrint || printed.current) return;
    printed.current = true;
    // Let the receipt lay out (and fonts load) before measuring it for the page size.
    const t = setTimeout(() => { printPaper(paper); router.replace(`/app/invoices/${inv.id}`); }, 350);
    return () => clearTimeout(t);
  }, [autoPrint, paper, inv.id, router]);
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
  // The bill prints as it was issued: its own type, GSTIN and place of supply, whatever the salon's settings are now.
  const doc = billDocument(inv.bill_type ?? (Number(inv.cgst) + Number(inv.sgst) + Number(inv.igst) > 0 ? 'tax_invoice' : 'bill'));
  const gstin = doc.showGstin ? inv.seller_gstin ?? salon.gstin : null;
  const placeOfSupply = doc.showTax ? inv.place_of_supply ?? placeOf(salon.state, salon.gstin) : null;
  const rateSummary = doc.showTax ? taxByRate(items) : [];
  const half = rateSummary.length === 1 ? ` @ ${rateSummary[0].rate / 2}%` : '';
  const addressLines = [salon.address, [salon.city, salon.state].filter(Boolean).join(', ') + (salon.pincode ? ` – ${salon.pincode}` : '')].filter((x) => x && x.trim());
  const totalQty = items.reduce((s, i) => s + Number(i.qty), 0);

  const coinBalance = Number(customer?.coin_balance ?? 0);
  const upi = isValidVpa(salon.upiVpa) ? { vpa: salon.upiVpa, name: salon.upiName || salon.name } : null;
  const methods = deskMethods(salon.payMethods, { clientHasCoins: coinBalance > 0 });
  const payAmt = parseAmount(amount);
  const coinsPaid = payments.filter((p) => p.method === 'wallet').reduce((s, p) => s + Number(p.amount), 0);
  const coinsBlocked = !customer ? tr('inv.noClientCoins') : coinBalance <= 0 ? tr('inv.noCoins', { name: customer.name.split(' ')[0] }) : null;
  const pickMethod = (m: PayMethod) => {
    setMethod(m);
    if (m === 'wallet') setAmount(String(usableCoins(coinBalance, due)));
    else if (method === 'wallet') setAmount(String(due));
  };
  const openPay = () => { setError(null); setMethod(methods.includes('upi') ? 'upi' : methods[0]); setAmount(String(due)); setReference(''); setPayOpen(true); };
  const savePayment = () => start(async () => {
    setError(null);
    const amt = parseAmount(amount);
    if (!amt) return setError(tr('err.enterAmount'));
    if (amt > due) return setError(tr('inv.onlyDue', { money: money(due) }));
    if (method === 'wallet' && amt > coinBalance) return setError(tr('inv.onlyCoins', { name: customer?.name.split(' ')[0] ?? tr('pos.theClient'), coins: coinsT(tr, coinBalance) }));
    const r = await addPayment(inv.id, method, amt, reference);
    if (!r.ok) return setError(tr.err(r.error));
    toast(tr('err.paymentRecorded')); setPayOpen(false); router.refresh();
  });
  const cancelBill = () => start(async () => {
    setError(null);
    if (!reason.trim()) return setError(tr('inv.reasonNeeded'));
    const r = await voidInvoice(inv.id, reason);
    if (!r.ok) return setError(tr.err(r.error));
    toast(tr('err.billCancelled')); setVoidOpen(false); router.refresh();
  });
  const send = () => start(async () => {
    const r = await resendInvoice(inv.id);
    if (!r.ok) return toast(tr.err(r.error), 'error');
    toast(tr('err.billSent'));
  });

  return (
    <>
      <Topbar back="/app/invoices" title={<span className="row">{tr('common.billNo', { no: inv.invoice_no })} <InvoiceStatusBadge status={inv.status} /></span>}
        subtitle={`${customer?.name ?? tr('common.walkIn')} · ${fmtDateYear(inv.created_at, tz, tr.locale)}, ${fmtTime(inv.created_at, tz)}`}
        actions={<div className="row invoice-print">
          <select className="select input-sm" value={paper} aria-label={tr('inv.paper')} onChange={(e) => setPaper(e.target.value as ReceiptSize)}>
            {PAPERS.map((k) => <option key={k} value={k}>{tr(`inv.paper.${k}`)}</option>)}
          </select>
          <Button icon="printer" onClick={() => printPaper(paper)} aria-label={tr('common.print')}><span className="hide-mobile">{tr('common.print')}</span></Button>
        </div>} />
      <div className="page invoice-page">
        <div className="invoice-actions no-print">
          {!isVoid && due > 0 && <Button variant="primary" icon="wallet" onClick={openPay}>{tr('inv.recordPaymentN', { money: money(due) })}</Button>}
          {!isVoid && customer && (
            <Button icon="whatsapp" loading={pending && !payOpen && !voidOpen} onClick={send} disabled={!salon.waConnected}
              title={salon.waConnected ? undefined : tr('inv.connectWa')}>{tr('inv.sendWa')}</Button>
          )}
          {customer && <Link className="btn btn-ghost" href={`/app/customers/${customer.id}`}><Icon name="user" size={18} />{tr('inv.clientProfile')}</Link>}
          {canVoid && !isVoid && <Button variant="ghost" className="invoice-void-btn" icon="trash" onClick={() => { setError(null); setReason(''); setVoidOpen(true); }}>{tr('inv.cancelBill')}</Button>}
        </div>
        {isVoid && <div className="no-print"><Notice tone="error">{inv.void_reason ? tr('inv.voidedReason', { reason: inv.void_reason }) : tr('inv.voided')}</Notice></div>}
        {!isVoid && doc.showGstin && !gstin && <div className="no-print"><Notice tone="warn">{rich(tr('inv.addGstin'), { settings: <Link href="/app/settings#billing">{tr('nav.settings')}</Link> })}</Notice></div>}

        {paper !== 'a4' ? (
          <div className="receipt-stage">
            <Receipt width={paper} invoice={inv} items={items} payments={payments} customer={customer} staffNames={staffNames} tz={tz}
              salon={{ ...salon, upiVpa: upi?.vpa ?? null, upiName: upi?.name ?? null }} />
            <p className="tiny muted no-print">{tr('inv.receiptWidth')}</p>
          </div>
        ) : (
        <article className={`invoice-doc${isVoid ? ' is-cancelled' : ''}`} aria-label={`${doc.title} ${inv.invoice_no}`}>
          {isVoid && <div className="invoice-watermark" aria-hidden>CANCELLED</div>}
          <header className="invoice-head">
            <div className="invoice-seller">
              <div className="invoice-salon">{salon.name}</div>
              {salon.legal_name && salon.legal_name !== salon.name && <div className="strong small">{salon.legal_name}</div>}
              {addressLines.map((l) => <div key={l} className="small ink2">{l}</div>)}
              <div className="small ink2">
                {[salon.phone ? `Ph: ${formatPhone(salon.phone)}` : '', salon.email ?? ''].filter(Boolean).join(' · ')}
              </div>
              {gstin && <div className="small"><span className="muted">GSTIN </span><span className="strong mono">{gstin}</span></div>}
            </div>
            <div className="invoice-title">
              <div className="invoice-kind">{isVoid ? `${doc.title} — Cancelled` : doc.title}</div>
              <dl className="invoice-meta">
                <dt>Bill no.</dt><dd className="strong num">{inv.invoice_no}</dd>
                <dt>Date</dt><dd className="num">{fmtDateYear(inv.created_at, tz)}</dd>
                <dt>Time</dt><dd className="num">{fmtTime(inv.created_at, tz)}</dd>
                {placeOfSupply && <><dt>Place of supply</dt><dd>{placeOfSupply}</dd></>}
              </dl>
            </div>
          </header>
          {doc.declaration && <p className="invoice-declaration">{doc.declaration}</p>}

          <section className="invoice-billto">
            <div className="tiny muted invoice-label">Bill to</div>
            {customer ? (
              <>
                <div className="strong">{customer.name}</div>
                <div className="small ink2 num">{formatPhone(customer.phone)}{customer.email ? ` · ${customer.email}` : ''}</div>
              </>
            ) : <div className="strong">Walk-in client</div>}
            {inv.client_address && <div className="small ink2">{inv.client_address}</div>}
            {inv.client_gstin && <div className="small"><span className="muted">GSTIN </span><span className="strong mono">{inv.client_gstin}</span></div>}
          </section>

          <table className="invoice-table">
            <thead>
              <tr>
                <th className="col-n">#</th>
                <th>Description</th>
                {doc.showTax && <th className="col-opt">SAC/HSN</th>}
                <th className="right">Qty</th>
                <th className="right col-opt">Rate</th>
                <th className="right col-opt">Discount</th>
                {doc.showTax && <th className="right col-opt">Taxable</th>}
                {doc.showTax && <th className="right col-opt">GST</th>}
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
                    {it.discount_note && <div className="tiny strong line-note">{it.discount_note === 'Package' ? 'From package — paid with the package' : `${it.discount_note} member discount`}</div>}
                    <div className="tiny muted show-narrow num">
                      {money2(it.unit_price)} each{Number(it.discount) > 0 ? ` · −${money2(it.discount)} discount` : ''}
                      {doc.showTax ? ` · GST ${Number(it.gst_rate)}%${it.code ? ` · ${it.kind === 'product' ? 'HSN' : 'SAC'} ${it.code}` : ''}` : ''}
                    </div>
                  </td>
                  {doc.showTax && <td className="col-opt num small">{it.code ?? (it.kind === 'product' ? '—' : SALON_SAC)}</td>}
                  <td className="right num">{Number(it.qty)}</td>
                  <td className="right num col-opt">{money2(it.unit_price)}</td>
                  <td className="right num col-opt">{Number(it.discount) > 0 ? money2(it.discount) : '—'}</td>
                  {doc.showTax && <td className="right num col-opt">{money2(it.taxable)}</td>}
                  {doc.showTax && <td className="right num col-opt">{Number(it.gst_rate)}%</td>}
                  <td className="right num strong">{money2(it.line_total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="col-n" />
                <td className="muted small">{items.length} item{items.length === 1 ? '' : 's'}</td>
                {doc.showTax && <td className="col-opt" />}
                <td className="right num small">{totalQty}</td>
                <td className="col-opt" />
                <td className="right num col-opt small">{Number(inv.discount_total) > 0 ? money2(inv.discount_total) : ''}</td>
                {doc.showTax && <td className="right num col-opt small">{money2(inv.taxable_total)}</td>}
                {doc.showTax && <td className="col-opt" />}
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
              {rateSummary.length > 1 && (
                <div>
                  <div className="tiny muted invoice-label">GST summary</div>
                  <table className="invoice-gst-summary num">
                    <thead><tr><th>Rate</th><th className="right">Taxable</th><th className="right">CGST</th><th className="right">SGST</th></tr></thead>
                    <tbody>
                      {rateSummary.map((r) => {
                        const c = Math.round((r.tax / 2) * 100) / 100;
                        return <tr key={r.rate}><td>{r.rate}%</td><td className="right">{money2(r.taxable)}</td><td className="right">{money2(c)}</td><td className="right">{money2(r.tax - c)}</td></tr>;
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {inv.notes && <div><div className="tiny muted invoice-label">Note</div><div className="small">{inv.notes}</div></div>}
              {!isVoid && due > 0 && upi && (
                <div className="invoice-upi">
                  <div className="tiny muted invoice-label">Pay by UPI</div>
                  <UpiQr vpa={upi.vpa} name={upi.name} amount={due} note={`Bill ${inv.invoice_no}`} size={132} />
                </div>
              )}
            </div>
            <dl className="totals invoice-totals">
              <dt>Subtotal</dt><dd>{money2(inv.subtotal)}</dd>
              {Number(inv.discount_total) > 0 && <><dt>Discount</dt><dd>−{money2(inv.discount_total)}</dd></>}
              {doc.showTax && <>
                <dt>Taxable value</dt><dd>{money2(inv.taxable_total)}</dd>
                {Number(inv.igst) > 0 ? (
                  <><dt>IGST</dt><dd>{money2(inv.igst)}</dd></>
                ) : (
                  <><dt>CGST{half}</dt><dd>{money2(inv.cgst)}</dd><dt>SGST{half}</dt><dd>{money2(inv.sgst)}</dd></>
                )}
              </>}
              {Number(inv.round_off) !== 0 && <><dt>Round off</dt><dd>{Number(inv.round_off) > 0 ? '+' : '−'}{money2(Math.abs(Number(inv.round_off)))}</dd></>}
              <dt className="grand">Total</dt><dd className="grand">{money2(total)}</dd>
              <dt>Paid</dt><dd>{money2(paidTotal)}</dd>
              <dt className={due > 0 && !isVoid ? 'strong warn-text' : 'strong'}>Balance due</dt>
              <dd className={due > 0 && !isVoid ? 'strong warn-text' : 'strong'}>{money2(isVoid ? 0 : due)}</dd>
            </dl>
          </section>

          <footer className="invoice-foot">
            <div className="strong">Thank you for visiting {salon.name}!</div>
            <div className="tiny muted">{doc.showTax && inv.prices_include_tax ? 'Prices are inclusive of GST. ' : ''}This is a computer-generated {doc.noun} and needs no signature.</div>
          </footer>
        </article>
        )}
      </div>

      <Dialog open={payOpen} onClose={() => setPayOpen(false)} title={tr('inv.recordPayment')}
        footer={<><Button variant="ghost" onClick={() => setPayOpen(false)}>{tr('common.cancel')}</Button><Button variant="primary" loading={pending} onClick={savePayment}>{tr('inv.recordN', { money: money(parseAmount(amount)) })}</Button></>}>
        <p className="small ink2">{customer ? tr('inv.dueOnFor', { money: money(due), no: inv.invoice_no, name: customer.name }) : tr('inv.dueOn', { money: money(due), no: inv.invoice_no })}</p>
        <div className="field">
          <span className="label">{tr('bill.paidBy')}</span>
          <div className="row-wrap">
            {methods.map((m) => (
              <button key={m} type="button" className="chip chip-sm" aria-pressed={method === m} onClick={() => pickMethod(m)}
                disabled={m === 'wallet' && !!coinsBlocked} title={m === 'wallet' ? coinsBlocked ?? undefined : undefined}>
                <Icon name={METHOD_ICON[m]} size={14} />{tr(`method.${m}`)}
              </button>
            ))}
          </div>
          {method === 'wallet' ? <span className="hint num">{tr('inv.coinsAvail', { coins: coinsT(tr, coinBalance) })}</span>
            : coinBalance > 0 ? <span className="hint num">{tr('inv.hasCoins', { name: customer?.name.split(' ')[0] ?? '', coins: coinsT(tr, coinBalance) })}</span>
            : <span className="hint">{coinsBlocked}</span>}
        </div>
        <div className="field">
          <label htmlFor="pay-amt">{tr('bill.amount')}</label>
          <div className="prefix-input"><span>₹</span><input id="pay-amt" className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></div>
        </div>
        {method !== 'cash' && method !== 'cash_nu' && method !== 'wallet' && <input className="input" placeholder={refPlaceholder(tr, method)} value={reference} onChange={(e) => setReference(e.target.value)} aria-label={tr('pos.payRef')} />}
        {isUpiMethod(method) && payAmt > 0 && (upi
          ? <UpiQr vpa={upi.vpa} name={upi.name} amount={payAmt} note={`Bill ${inv.invoice_no}`} size={150} />
          : <p className="tiny muted">{rich(tr('pos.upiSetup'), { settings: <Link href="/app/settings#payments">{tr('nav.settings')}</Link> })}</p>)}
        {method === 'upi_bhutan' && payAmt > 10000 && <p className="tiny warn-text">{tr('pos.bhutanLimit', { per: money(10000), day: money(25000) })}</p>}
        {error && <Notice tone="error">{error}</Notice>}
      </Dialog>

      <Dialog open={voidOpen} onClose={() => setVoidOpen(false)} title={tr('inv.cancelTitle', { no: inv.invoice_no })}
        footer={<><Button variant="ghost" onClick={() => setVoidOpen(false)}>{tr('inv.keepBill')}</Button><Button variant="danger" loading={pending} onClick={cancelBill}>{tr('inv.cancelBill')}</Button></>}>
        <p className="small ink2">{tr('inv.cancelBody')} {customer ? tr('inv.removedFromSalesFor', { money: money(total), name: customer.name }) : tr('inv.removedFromSales', { money: money(total) })}</p>
        <div className="row-wrap">
          {[tr('inv.reasonTwice'), tr('inv.reasonWrong'), tr('inv.reasonNoService')].map((r) => (
            <button key={r} type="button" className="chip chip-sm" aria-pressed={reason === r} onClick={() => setReason(r)}>{r}</button>
          ))}
        </div>
        <TextArea label={tr('inv.reason')} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tr('inv.reasonPh')} />
        {coinsPaid > 0 && <p className="tiny ink2">{tr('inv.coinsBack', { coins: coinsT(tr, coinsPaid), name: customer?.name ?? tr('pos.theClient') })}</p>}
        {paidTotal - coinsPaid > 0 && <p className="tiny muted">{tr('inv.refundSeparately', { money: money(paidTotal - coinsPaid) })}</p>}
        {error && <Notice tone="error">{error}</Notice>}
      </Dialog>
    </>
  );
}
