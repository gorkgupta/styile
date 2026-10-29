'use client';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Notice, Panel, SearchInput, Segmented, Switch, TextField, cx, useToast } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { Topbar } from './shell';
import { ClientPicker } from './pickers';
import { deskMethods, isUpiMethod, METHOD_ICON, REF_PLACEHOLDER, parseAmount } from './billing-bits';
import { UpiQr } from '@/components/ui/upi-qr';
import { BHUTAN_UPI_LIMITS } from '@/lib/upi';
import { createInvoice } from '@/actions/billing';
import type { ClientLite } from '@/actions/appointments';
import { computeBill, money } from '@/lib/billing';
import { coinsText, fmtCoins, usableCoins } from '@/lib/coins';
import { B2C_ADDRESS_LIMIT, billDocument, billTypeFor, BUSINESS_GSTIN_RE, cleanGstin, HSN_RE, PRODUCT_TAX_TYPES } from '@/lib/gst';
import type { GstMode, PayMethod, ReceiptSize, Service, ServiceCategory, Staff } from '@/lib/types';
import { METHOD_LABEL } from '@/lib/types';

export interface PosPrefillLine { serviceId: string | null; name: string; price: number; staffId: string | null; gstRate: number | null }

export interface PosProps {
  salon: {
    /** Which bill this salon issues: no tax lines unless 'regular'. */
    gstMode: GstMode;
    pricesIncludeTax: boolean;
    /** Statutory GST on services today (serviceGstRate). */
    serviceRate: number;
    waConnected: boolean; nextInvoiceNo: string;
    /** Payment types the desk sees (Settings). */
    payMethods?: PayMethod[];
    /** The salon's own UPI ID for the pay-by-QR (null = not set up). */
    upi?: { vpa: string; name: string } | null;
    /** Paper the bill page prints on after saving. */
    receiptSize?: ReceiptSize;
  };
  services: Service[];
  categories: ServiceCategory[];
  staff: Staff[];
  /** Set when checking out an appointment (?appointment=) or billing a known client (?customer=). */
  prefill?: { appointmentId: string | null; customer: ClientLite | null; lines: PosPrefillLine[]; context?: string } | null;
}

interface Line {
  key: string; kind: 'service' | 'product' | 'custom'; serviceId: string | null; staffId: string;
  name: string; qty: number; unitPrice: number; discount: string;
  /** Services: the menu's override (null = statutory). Products: the rate chosen. Other: null (a service). */
  gstRate: number | null;
  /** Products: HSN code (optional). */
  code: string;
}
/** `auto` rows take whatever is left of the total until someone types an amount into them. */
interface PayRow { key: string; method: PayMethod; amount: string; reference: string; auto: boolean }

let seq = 0;
const nextKey = () => `k${++seq}`;
const freshPay = (method: PayMethod): PayRow => ({ key: nextKey(), method, amount: '', reference: '', auto: true });
const PRINT_PREF = 'styile.printAfterSave';

export function PosScreen({ salon, services, categories, staff, prefill }: PosProps) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const activeStaff = useMemo(() => staff.filter((s) => s.active), [staff]);

  const [client, setClient] = useState<ClientLite | null>(prefill?.customer ?? null);
  const [lines, setLines] = useState<Line[]>(() => (prefill?.lines ?? []).map((l) => ({
    key: nextKey(), kind: l.serviceId ? 'service' : 'custom', serviceId: l.serviceId, staffId: l.staffId ?? '',
    name: l.name, qty: 1, unitPrice: Number(l.price), discount: '', gstRate: l.gstRate, code: '',
  })));
  const [defaultStaff, setDefaultStaff] = useState(prefill?.lines.find((l) => l.staffId)?.staffId ?? '');
  const enabledMethods = deskMethods(salon.payMethods);
  const defaultMethod: PayMethod = enabledMethods.includes('upi') ? 'upi' : enabledMethods.find((m) => m !== 'wallet') ?? 'cash';
  const [pays, setPays] = useState<PayRow[]>(() => [freshPay(defaultMethod)]);
  // Print the receipt straight after saving (remembered on this device).
  const [printAfter, setPrintAfter] = useState(true);
  useEffect(() => { try { const v = localStorage.getItem(PRINT_PREF); if (v !== null) setPrintAfter(v === '1'); } catch { /* private mode */ } }, []);
  const changePrintAfter = (v: boolean) => { setPrintAfter(v); try { localStorage.setItem(PRINT_PREF, v ? '1' : '0'); } catch { /* ignore */ } };
  const [sendWa, setSendWa] = useState(!!prefill?.customer && salon.waConnected);
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Catalogue state
  const [q, setQ] = useState('');
  const [customName, setCustomName] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  const [customKind, setCustomKind] = useState<'product' | 'custom'>('product');
  const [customRate, setCustomRate] = useState<number | null>(null);
  const [customHsn, setCustomHsn] = useState('');
  const customNameRef = useRef<HTMLInputElement>(null);
  // Business client (tax invoices): GSTIN and address printed on the bill.
  const [b2bOpen, setB2bOpen] = useState(false);
  const [clientGstin, setClientGstin] = useState('');
  const [clientAddress, setClientAddress] = useState('');

  const regular = salon.gstMode === 'regular';
  const doc = billDocument(billTypeFor(salon.gstMode));

  const coinBalance = Math.max(0, Number(client?.coin_balance ?? 0));
  const methods = deskMethods(salon.payMethods, { clientHasCoins: coinBalance > 0 });
  const firstClient = useRef(true);
  useEffect(() => {
    if (firstClient.current) { firstClient.current = false; return; }
    setSendWa(!!client && salon.waConnected);
    // Coins belong to the client: a new client without coins can't keep a Coins payment.
    if (!Number(client?.coin_balance ?? 0)) setPays((rows) => rows.map((p) => (p.method === 'wallet' ? { ...p, method: defaultMethod } : p)));
  }, [client, salon.waConnected, defaultMethod]);

  const bill = useMemo(() => computeBill(
    lines.map((l) => ({ kind: l.kind, name: l.name, qty: l.qty, unitPrice: l.unitPrice, discount: parseAmount(l.discount), gstRate: l.gstRate })),
    { gstMode: salon.gstMode, pricesIncludeTax: salon.pricesIncludeTax, serviceRate: salon.serviceRate },
  ), [lines, salon.gstMode, salon.pricesIncludeTax, salon.serviceRate]);

  const fixedSum = pays.filter((p) => !p.auto).reduce((s, p) => s + parseAmount(p.amount), 0);
  const remainder = Math.max(0, Math.round((bill.total - fixedSum) * 100) / 100);
  // A Coins row that fills the rest never takes more than the client has.
  const fixedCoins = pays.filter((p) => !p.auto && p.method === 'wallet').reduce((s, p) => s + parseAmount(p.amount), 0);
  const autoAmount = (p: PayRow) => (p.method === 'wallet' ? usableCoins(coinBalance - fixedCoins, remainder) : remainder);
  const payRows = pays.map((p) => (p.auto ? { ...p, amount: autoAmount(p) ? String(autoAmount(p)) : '' } : p));
  const paid = Math.round(payRows.reduce((s, p) => s + parseAmount(p.amount), 0) * 100) / 100;
  const balance = Math.round((bill.total - paid) * 100) / 100;
  const coinsUsed = Math.round(payRows.filter((p) => p.method === 'wallet').reduce((s, p) => s + parseAmount(p.amount), 0) * 100) / 100;
  const coinsShort = coinsUsed > coinBalance + 0.001;
  const coinsBlocked = !client ? 'Choose the client to pay with their coins.' : coinBalance <= 0 ? `${client.name.split(' ')[0]} has no coins at your salon.` : null;
  const overDiscount = lines.some((l) => parseAmount(l.discount) > l.qty * l.unitPrice);
  const rates = [...new Set(bill.lines.map((l) => l.gstRate))];
  const halfRate = rates.length === 1 ? `${rates[0] / 2}%` : null;
  const gstinClean = cleanGstin(clientGstin);
  const gstinBad = regular && !!gstinClean && !BUSINESS_GSTIN_RE.test(gstinClean);
  const productNoRate = regular && lines.some((l) => l.kind === 'product' && l.gstRate === null);
  // Rule 46: a tax invoice of ₹50,000 or more to an unregistered client needs their name and address.
  const needsAddress = regular && bill.total >= B2C_ADDRESS_LIMIT && (!client || !clientAddress.trim());

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = services.filter((s) => s.active && (!needle || s.name.toLowerCase().includes(needle)));
    const out = categories.map((c) => ({ id: c.id, name: c.name, items: list.filter((s) => s.category_id === c.id) }));
    const other = list.filter((s) => !s.category_id || !categories.some((c) => c.id === s.category_id));
    if (other.length) out.push({ id: 'other', name: 'Other', items: other });
    return out.filter((g) => g.items.length);
  }, [services, categories, q]);

  const countOf = (serviceId: string) => lines.filter((l) => l.serviceId === serviceId).reduce((s, l) => s + l.qty, 0);

  const addService = (s: Service) => {
    setError(null);
    setLines((cur) => {
      const same = cur.find((l) => l.serviceId === s.id && l.staffId === defaultStaff);
      if (same) return cur.map((l) => (l === same ? { ...l, qty: l.qty + 1 } : l));
      return [...cur, { key: nextKey(), kind: 'service', serviceId: s.id, staffId: defaultStaff, name: s.name, qty: 1, unitPrice: Number(s.price), discount: '', gstRate: s.gst_rate, code: '' }];
    });
  };

  const addCustom = () => {
    const name = customName.trim();
    const price = parseAmount(customPrice);
    if (!name) { setError('Give the custom item a name.'); customNameRef.current?.focus(); return; }
    if (!price) { setError(`Enter a price for “${name}”.`); return; }
    const isProduct = customKind === 'product';
    if (isProduct && regular && customRate === null) { setError(`Choose the product type for “${name}” — it sets the GST rate.`); return; }
    const hsn = customHsn.trim();
    if (isProduct && hsn && !HSN_RE.test(hsn)) { setError('HSN code should be 4, 6 or 8 digits, like 3305.'); return; }
    setError(null);
    setLines((cur) => [...cur, {
      key: nextKey(), kind: customKind, serviceId: null, staffId: isProduct ? '' : defaultStaff, name, qty: 1, unitPrice: price, discount: '',
      gstRate: isProduct ? (regular ? customRate : 0) : null, code: isProduct ? hsn : '',
    }]);
    setCustomName(''); setCustomPrice(''); setCustomHsn('');
    customNameRef.current?.focus();
  };

  const update = (key: string, patch: Partial<Line>) => setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: string) => setLines((cur) => cur.filter((l) => l.key !== key));

  const setPays2 = (fn: (rows: PayRow[]) => PayRow[]) => setPays(fn(payRows));
  const setPay = (key: string, patch: Partial<PayRow>) => setPays2((rows) => rows.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const setPayAmount = (key: string, amount: string) => setPay(key, { amount, auto: false });
  // "Full amount": this row takes whatever the other rows leave.
  const fillRest = (key: string) => setPays2((rows) => rows.map((p) => (p.key === key ? { ...p, auto: true } : { ...p, auto: false })));
  const addPayRow = () => {
    const used = new Set(payRows.map((p) => p.method));
    const method = methods.find((m) => !used.has(m) && (m !== 'wallet' || !coinsBlocked)) ?? defaultMethod;
    // Existing rows keep their amounts; the new row picks up the rest once one of them is changed.
    setPays2((rows) => [...rows.map((p) => ({ ...p, auto: false })), freshPay(method)]);
  };

  /** "Use coins": pay as much as the client's coins cover; one other row takes whatever is left. */
  const useCoins = () => setPays2((rows) => {
    const others = rows.filter((p) => p.method !== 'wallet');
    const keyOfRest = others.find((p) => p.auto)?.key ?? others[0]?.key;
    const fixedOthers = others.filter((p) => p.key !== keyOfRest).reduce((s, p) => s + parseAmount(p.amount), 0);
    const amount = usableCoins(coinBalance, bill.total - fixedOthers);
    const rest = Math.round((bill.total - fixedOthers - amount) * 100) / 100;
    const coinRow: PayRow = { key: nextKey(), method: 'wallet', amount: String(amount), reference: '', auto: false };
    // Coins cover the whole bill: the row that would take the rest is no longer needed.
    const kept = others.map((p) => ({ ...p, auto: p.key === keyOfRest })).filter((p) => !(p.key === keyOfRest && rest <= 0));
    if (rest > 0 && !kept.some((p) => p.auto)) kept.push(freshPay(defaultMethod));
    return [coinRow, ...kept];
  });

  const save = () => start(async () => {
    setError(null);
    if (!lines.length) return setError('Add at least one service or item to the bill.');
    if (coinsUsed > 0 && coinsBlocked) return setError(coinsBlocked);
    if (coinsShort) return setError(`${client?.name.split(' ')[0] ?? 'The client'} has only ${coinsText(coinBalance)}. Lower the Coins amount.`);
    if (overDiscount) return setError('A discount is more than the item price. Fix it to continue.');
    if (productNoRate) return setError('Choose the product type (GST rate) for every product on the bill.');
    if (gstinBad) return setError('Client GSTIN should be 15 characters, like 19ABCDE1234F1Z5. Clear it for a walk-in.');
    if (balance < 0) return setError(`Payments are ${money(-balance)} more than the bill. Correct the amounts.`);
    const r = await createInvoice({
      customerId: client?.id ?? null,
      appointmentId: prefill?.appointmentId ?? null,
      items: lines.map((l) => ({
        kind: l.kind, serviceId: l.serviceId, staffId: l.staffId || null, name: l.name,
        qty: l.qty, unitPrice: l.unitPrice, discount: parseAmount(l.discount), gstRate: l.gstRate, code: l.code || null,
      })),
      payments: payRows.filter((p) => parseAmount(p.amount) > 0).map((p) => ({ method: p.method, amount: parseAmount(p.amount), reference: p.reference })),
      notes,
      sendOnWhatsApp: sendWa && !!client,
      clientGstin: regular && b2bOpen ? gstinClean || null : null,
      clientAddress: regular && (b2bOpen || needsAddress || clientAddress.trim()) ? clientAddress.trim() || null : null,
    });
    if (!r.ok) { setError(r.error); toast(r.error, 'error'); return; }
    toast(r.message ?? 'Bill saved');
    router.push(`/app/invoices/${r.data!.id}${printAfter ? '?print=1' : ''}`);
  });

  const saveLabel = `Save bill · ${money(bill.total)}`;
  const canSave = lines.length > 0 && !overDiscount && balance >= 0 && !coinsShort && !productNoRate && !gstinBad;
  const payState = !lines.length ? null
    : balance < 0 ? <span className="small strong danger-text">{money(-balance)} more than the bill</span>
    : balance === 0 ? <span className="small strong success-text">Paid in full</span>
    : paid > 0 ? <span className="small strong warn-text">{money(balance)} balance due · saved as part paid</span>
    : <span className="small strong warn-text">Nothing collected · saved as unpaid</span>;

  return (
    <>
      <Topbar title="New bill" back={prefill?.appointmentId ? '/app' : undefined}
        subtitle={prefill?.context ?? `Next bill no. ${salon.nextInvoiceNo}`}
        actions={lines.length > 0 && !prefill?.appointmentId
          ? <Button variant="ghost" size="sm" onClick={() => { setLines([]); setPays([freshPay(defaultMethod)]); }}>Clear</Button>
          : undefined} />
      <div className="page">
        <div className="pos">
          {/* ---------------- Catalogue ---------------- */}
          <Panel title="Add to bill" className="pos-catalogue">
            <div className="stack-lg">
              {services.length > 8 && <SearchInput value={q} onChange={setQ} placeholder="Find a service" />}
              {groups.map((g) => (
                <section key={g.id} className="stack-sm">
                  <div className="tiny muted strong">{g.name}</div>
                  <div className="pos-chips">
                    {g.items.map((s) => {
                      const n = countOf(s.id);
                      return (
                        <button key={s.id} type="button" className={cx('chip', 'pos-chip', n > 0 && 'is-on')} onClick={() => addService(s)}
                          aria-label={`Add ${s.name}, ${money(s.price)}${n ? ` (${n} on bill)` : ''}`}>
                          {n > 0 ? <span className="pos-chip-count num">{n}</span> : <Icon name="plus" size={14} className="pos-chip-icon" />}
                          <span className="pos-chip-name">{s.name}</span>
                          <span className="num pos-chip-price">{money(s.price)}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
              {!groups.length && <p className="small muted">{q ? `No service matches “${q}”. Add it as a custom item below.` : 'Your service menu is empty. Add services under Services, or use a custom item.'}</p>}

              <section className="stack-sm pos-custom">
                <div className="between">
                  <div className="tiny muted strong">Custom item or product</div>
                  <Segmented label="Item type" value={customKind} onChange={setCustomKind}
                    options={[{ value: 'product', label: 'Product' }, { value: 'custom', label: 'Other' }]} />
                </div>
                <form className="stack-sm" onSubmit={(e) => { e.preventDefault(); addCustom(); }}>
                  {customKind === 'product' && regular && (
                    <div className="pos-tax-types" role="group" aria-label="Product type (sets the GST rate)">
                      {PRODUCT_TAX_TYPES.map((t) => (
                        <button key={t.key} type="button" className="chip chip-sm" aria-pressed={customRate === t.rate} title={t.hint}
                          onClick={() => setCustomRate(t.rate)}>{t.label}</button>
                      ))}
                    </div>
                  )}
                  <div className="pos-custom-row">
                    <input ref={customNameRef} className="input" placeholder={customKind === 'product' ? 'e.g. Argan oil serum 100 ml' : 'e.g. Hair spa add-on'}
                      value={customName} onChange={(e) => setCustomName(e.target.value)} aria-label="Item name" />
                    <div className="prefix-input pos-price">
                      <span>₹</span>
                      <input className="input num" inputMode="decimal" placeholder="Price" value={customPrice}
                        onChange={(e) => setCustomPrice(e.target.value)} aria-label="Item price" />
                    </div>
                    <Button type="submit" icon="plus">Add</Button>
                  </div>
                  {customKind === 'product' && regular && (
                    <div className="row-wrap pos-hsn">
                      <input className="input input-sm num" inputMode="numeric" maxLength={8} placeholder="HSN (optional)" value={customHsn}
                        onChange={(e) => setCustomHsn(e.target.value.replace(/\D/g, ''))} aria-label="HSN code (optional)" />
                      <span className="tiny muted">{PRODUCT_TAX_TYPES.find((t) => t.rate === customRate)?.hint ?? 'Pick the type: it sets the GST rate on this product.'}</span>
                    </div>
                  )}
                  {customKind === 'custom' && regular && <span className="tiny muted">Billed as a salon service at {salon.serviceRate}% GST.</span>}
                </form>
              </section>
            </div>
          </Panel>

          {/* ---------------- The bill ---------------- */}
          <div className="stack pos-bill">
            <Panel title="Client" className="pos-client" actions={!client ? <span className="small muted">Optional for walk-ins</span> : undefined}>
              <ClientPicker value={client} onChange={setClient} />
              {regular && (b2bOpen || needsAddress) && (
                <div className="stack-sm pos-b2b">
                  {b2bOpen && (
                    <TextField label="Client GSTIN" value={clientGstin} maxLength={15} className="mono-upper" placeholder="19ABCDE1234F1Z5"
                      onChange={(e) => setClientGstin(e.target.value.toUpperCase().replace(/\s/g, ''))}
                      error={gstinBad ? 'A GSTIN has 15 letters and numbers, like 19ABCDE1234F1Z5.' : undefined}
                      hint="Printed on the tax invoice so a business client can claim it." />
                  )}
                  <TextField label="Client address" value={clientAddress} maxLength={240} onChange={(e) => setClientAddress(e.target.value)}
                    placeholder="Business or home address" hint={needsAddress ? undefined : 'Printed under “Bill to”.'} />
                  {needsAddress && <Notice tone="warn">Tax invoices of {money(B2C_ADDRESS_LIMIT)} or more need the client’s name and address.{!client ? ' Choose the client above.' : ''}</Notice>}
                </div>
              )}
              {regular && !b2bOpen && (
                <button type="button" className="link-btn small pos-b2b-link" onClick={() => setB2bOpen(true)}>Business client? Add their GSTIN</button>
              )}
            </Panel>

            <Panel className="pos-lines" title={lines.length ? `${doc.title} · ${lines.length} item${lines.length > 1 ? 's' : ''}` : doc.title} flush
              actions={activeStaff.length > 0 && lines.length > 0 ? (
                <select className="select input-sm pos-default-staff" value={defaultStaff} aria-label="Stylist for new items"
                  onChange={(e) => setDefaultStaff(e.target.value)}>
                  <option value="">New items: no stylist</option>
                  {activeStaff.map((s) => <option key={s.id} value={s.id}>New items: {s.name}</option>)}
                </select>
              ) : undefined}>
              {lines.length ? (
                <ul className="list">
                  {lines.map((l, i) => {
                    const calc = bill.lines[i];
                    const base = l.qty * l.unitPrice;
                    const disc = parseAmount(l.discount);
                    const bad = disc > base;
                    return (
                      <li key={l.key} className="bill-line">
                        <div className="between" style={{ alignItems: 'flex-start' }}>
                          <div className="grow">
                            <div className="strong">{l.name}</div>
                            {(l.qty > 1 || l.kind === 'product' || (regular && calc.gstRate !== salon.serviceRate)) && (
                              <div className="tiny muted num">
                                {[l.qty > 1 ? `${money(l.unitPrice)} × ${l.qty}` : '', l.kind === 'product' ? 'Product' : '',
                                  regular && (l.kind === 'product' || calc.gstRate !== salon.serviceRate) ? (l.gstRate === null && l.kind === 'product' ? 'choose GST' : `GST ${calc.gstRate}%`) : '',
                                  regular && l.code ? `HSN ${l.code}` : ''].filter(Boolean).join(' · ')}
                              </div>
                            )}
                          </div>
                          <div className="right">
                            <div className="strong num">{money(calc.lineTotal)}</div>
                            {disc > 0 && !bad && <div className="tiny muted num"><s>{money(base)}</s></div>}
                          </div>
                          <Button size="sm" variant="ghost" icon="x" aria-label={`Remove ${l.name}`} onClick={() => remove(l.key)} />
                        </div>
                        <div className="bill-line-controls">
                          {l.kind === 'product' && regular && (
                            <select className="select input-sm pos-line-tax" value={l.gstRate ?? ''} aria-label={`Product type (GST) for ${l.name}`}
                              aria-invalid={l.gstRate === null || undefined} onChange={(e) => update(l.key, { gstRate: e.target.value === '' ? null : Number(e.target.value) })}>
                              <option value="">Product type…</option>
                              {PRODUCT_TAX_TYPES.map((t) => <option key={t.key} value={t.rate}>{t.label}</option>)}
                            </select>
                          )}
                          <select className="select input-sm" value={l.staffId} aria-label={`Stylist for ${l.name}`}
                            onChange={(e) => { update(l.key, { staffId: e.target.value }); if (e.target.value) setDefaultStaff(e.target.value); }}>
                            <option value="">{l.kind === 'product' ? 'No stylist' : 'Stylist…'}</option>
                            {activeStaff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                          <div className="stepper" role="group" aria-label={`Quantity of ${l.name}`}>
                            <button type="button" aria-label="One less" disabled={l.qty <= 1} onClick={() => update(l.key, { qty: l.qty - 1 })}><Icon name="minus" size={15} /></button>
                            <span className="num" aria-live="polite">{l.qty}</span>
                            <button type="button" aria-label="One more" onClick={() => update(l.key, { qty: l.qty + 1 })}><Icon name="plus" size={15} /></button>
                          </div>
                          <div className="prefix-input pos-disc">
                            <span>−₹</span>
                            <input className="input input-sm num" inputMode="decimal" placeholder="Discount" value={l.discount}
                              aria-label={`Discount on ${l.name} in rupees`} aria-invalid={bad || undefined}
                              onChange={(e) => update(l.key, { discount: e.target.value })} />
                          </div>
                          {[10, 20].map((pct) => {
                            const v = String(Math.round((base * pct) / 100));
                            return (
                              <button key={pct} type="button" className="chip chip-sm chip-pct" aria-pressed={l.discount === v}
                                onClick={() => update(l.key, { discount: l.discount === v ? '' : v })}>{pct}%</button>
                            );
                          })}
                        </div>
                        {bad && <div className="error-text">Discount is more than {money(base)}.</div>}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="pos-empty">
                  <Icon name="receipt" size={22} />
                  <div className="strong">No items yet</div>
                  <div className="small muted">Tap a service to add it. Add products or anything else as a custom item.</div>
                </div>
              )}
              {lines.length > 0 && (
                <div className="panel-foot">
                  <dl className="totals">
                    <dt>Subtotal</dt><dd className="num">{money(bill.subtotal)}</dd>
                    {bill.discountTotal > 0 && <><dt>Discount</dt><dd className="num">−{money(bill.discountTotal)}</dd></>}
                    {regular && <>
                      <dt className="muted">Taxable value</dt><dd className="num muted">{money(bill.taxableTotal)}</dd>
                      <dt className="muted">CGST{halfRate ? ` @ ${halfRate}` : ''}</dt><dd className="num muted">{money(bill.cgst)}</dd>
                      <dt className="muted">SGST{halfRate ? ` @ ${halfRate}` : ''}</dt><dd className="num muted">{money(bill.sgst)}</dd>
                    </>}
                    {bill.roundOff !== 0 && <><dt className="muted">Round off</dt><dd className="num muted">{bill.roundOff > 0 ? '+' : '−'}{money(Math.abs(bill.roundOff))}</dd></>}
                    <dt className="grand">Total</dt><dd className="grand num">{money(bill.total)}</dd>
                  </dl>
                  <div className="tiny muted" style={{ marginTop: 6 }}>
                    {regular ? (salon.pricesIncludeTax ? 'Prices include GST.' : 'GST is added to prices.')
                      : salon.gstMode === 'composition' ? 'Bill of supply: no GST is charged to the client (composition scheme).'
                      : 'No GST on this bill — your salon isn’t GST registered.'}
                  </div>
                </div>
              )}
            </Panel>

            <Panel title="Payment" className="pos-pay" actions={payState}>
              <div className="stack">
                {client && coinBalance > 0 && (
                  <div className="coin-strip">
                    <span className="coin-badge" aria-hidden><Icon name="coins" size={18} /></span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="strong num">Coins: {fmtCoins(coinBalance)} available</div>
                      <div className="tiny muted num truncate">
                        {coinsUsed > 0 ? `${fmtCoins(coinsUsed)} on this bill · ${fmtCoins(Math.max(coinBalance - coinsUsed, 0))} left after` : `${client.name.split(' ')[0]}’s balance · 1 coin = ₹1`}
                      </div>
                    </div>
                    {lines.length > 0 && (coinsUsed === 0 || (coinsUsed < Math.min(coinBalance, bill.total) && balance > 0)) && (
                      <Button size="sm" icon="coins" onClick={useCoins}>Use coins</Button>
                    )}
                  </div>
                )}
                {payRows.map((p, idx) => (
                  <div key={p.key} className="pay-row">
                    <div className="between">
                      <div className="pay-methods" role="group" aria-label={`Payment ${idx + 1} method`}>
                        {methods.map((m) => {
                          const off = m === 'wallet' && !!coinsBlocked && p.method !== 'wallet';
                          return (
                            <button key={m} type="button" className="chip chip-sm" aria-pressed={p.method === m} disabled={off}
                              title={off ? coinsBlocked ?? undefined : undefined} onClick={() => setPay(p.key, { method: m })}>
                              <Icon name={METHOD_ICON[m]} size={14} className="hide-mobile" />{METHOD_LABEL[m]}
                            </button>
                          );
                        })}
                      </div>
                      {payRows.length > 1 && <Button size="sm" variant="ghost" icon="x" aria-label="Remove this payment" onClick={() => setPays2((rows) => rows.filter((x) => x.key !== p.key))} />}
                    </div>
                    <div className="pay-inputs">
                      <div className="prefix-input">
                        <span>₹</span>
                        <input className="input num pay-amount" inputMode="decimal" placeholder="0" value={p.amount}
                          aria-label={`Amount paid by ${METHOD_LABEL[p.method]}`} onChange={(e) => setPayAmount(p.key, e.target.value)} />
                      </div>
                      {p.method !== 'cash' && p.method !== 'cash_nu' && p.method !== 'wallet' && (
                        <input className="input" placeholder={REF_PLACEHOLDER[p.method]} value={p.reference}
                          aria-label="Payment reference" onChange={(e) => setPay(p.key, { reference: e.target.value })} />
                      )}
                      {p.method === 'wallet' && (
                        <span className={coinsShort ? 'small strong danger-text' : 'small muted num'}>
                          {coinsShort ? `Only ${coinsText(coinBalance)} available` : coinsBlocked ?? `of ${coinsText(coinBalance)}`}
                        </span>
                      )}
                      {!p.auto && balance !== 0 && parseAmount(p.amount) + balance > 0 && (
                        <Button size="sm" onClick={() => fillRest(p.key)}>Full amount</Button>
                      )}
                    </div>
                    {p.method === 'upi_bhutan' && parseAmount(p.amount) > BHUTAN_UPI_LIMITS.perPayment && (
                      <p className="tiny warn-text">Bhutanese bank apps allow up to {money(BHUTAN_UPI_LIMITS.perPayment)} a payment and {money(BHUTAN_UPI_LIMITS.perDay)} a day. Split it or take the rest another way.</p>
                    )}
                    {isUpiMethod(p.method) && parseAmount(p.amount) > 0 && lines.length > 0 && (salon.upi ? (
                      <div className="pay-qr">
                        <UpiQr vpa={salon.upi.vpa} name={salon.upi.name} amount={parseAmount(p.amount)} note={`Bill ${salon.nextInvoiceNo}`} size={132} caption="short" />
                        <p className="tiny muted">To {salon.upi.name} · <span className="mono">{salon.upi.vpa}</span><br />The client scans and pays you directly. Check the payment on your phone or soundbox, then save the bill.</p>
                      </div>
                    ) : (
                      <p className="tiny muted">Show a pay-by-QR here: add your UPI ID in <Link href="/app/settings#payments">Settings</Link>.</p>
                    ))}
                  </div>
                ))}
                {coinsBlocked && methods.includes('wallet') && <p className="tiny muted row" style={{ gap: 6 }}><Icon name="coins" size={14} />{client ? `${coinsBlocked} Sell coins from their client profile.` : `Coins: ${coinsBlocked.charAt(0).toLowerCase()}${coinsBlocked.slice(1)}`}</p>}
                {!payRows.length && (
                  <p className="small muted">No payment taken now. The bill will be saved as unpaid and you can record payment later.</p>
                )}
                <div className="row-wrap">
                  {payRows.length > 0 && payRows.length < 4 && <Button size="sm" variant="ghost" icon="plus" onClick={addPayRow}>Split payment</Button>}
                  {payRows.length === 0 && <Button size="sm" icon="plus" onClick={addPayRow}>Add payment</Button>}
                  {payRows.length > 0 && <Button size="sm" variant="ghost" onClick={() => setPays([])}>Collect later</Button>}
                  {!showNotes && <Button size="sm" variant="ghost" icon="edit" onClick={() => setShowNotes(true)}>Add note</Button>}
                </div>
                {showNotes && <TextField label="Note on bill" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Printed on the bill" autoFocus />}

                <div className="divider" />
                <Switch checked={sendWa && !!client} disabled={!client || !salon.waConnected} onChange={setSendWa}
                  label={<span className="small">
                    Send bill on WhatsApp
                    {!salon.waConnected ? <span className="muted"> · connect WhatsApp in Settings</span> : !client ? <span className="muted"> · choose a client first</span> : null}
                  </span>} />
                <Switch checked={printAfter} onChange={changePrintAfter}
                  label={<span className="small">Print receipt after saving <span className="muted">· {salon.receiptSize === 'a4' ? 'A4' : `${salon.receiptSize ?? '80'} mm`}</span></span>} />
                {error && <Notice tone="error">{error}</Notice>}
                <Button variant="primary" size="lg" block loading={pending} disabled={!canSave} onClick={save} className="hide-mobile">{saveLabel}</Button>
              </div>
            </Panel>
          </div>
        </div>
      </div>

      {/* Phones: total and save always in reach */}
      <div className="pos-bar show-mobile">
        <div className="grow">
          <div className="tiny muted">{lines.length ? `${lines.length} item${lines.length > 1 ? 's' : ''}${balance > 0 && paid > 0 ? ` · ${money(balance)} due` : ''}` : 'No items'}</div>
          <div className="strong num pos-bar-total">{money(bill.total)}</div>
        </div>
        <Button variant="primary" size="lg" loading={pending} disabled={!canSave} onClick={save}>Save bill</Button>
      </div>
    </>
  );
}
