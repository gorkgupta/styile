'use client';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Notice, Panel, SearchInput, Segmented, Switch, TextField, cx, useToast } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { Topbar } from './shell';
import { ClientPicker } from './pickers';
import { deskMethods, isUpiMethod, METHOD_ICON, parseAmount, refPlaceholder } from './billing-bits';
import { UpiQr } from '@/components/ui/upi-qr';
import { BHUTAN_UPI_LIMITS } from '@/lib/upi';
import { createInvoice } from '@/actions/billing';
import { getClientBenefits } from '@/actions/packages';
import type { ClientLite } from '@/actions/appointments';
import { computeBill, money } from '@/lib/billing';
import { fmtCoins, usableCoins } from '@/lib/coins';
import { memberPctFor, pctText, usableSessions } from '@/lib/packages';
import { localDate } from '@/lib/time';
import { B2C_ADDRESS_LIMIT, billDocument, billTypeFor, BUSINESS_GSTIN_RE, cleanGstin, HSN_RE, PRODUCT_TAX_TYPES } from '@/lib/gst';
import type { ClientMembership, ClientPackage, GstMode, PayMethod, ReceiptSize, Service, ServiceCategory, Staff } from '@/lib/types';
import { rich, useT } from '@/lib/i18n/react';
import { coinsT, dayTextT, perksT } from '@/lib/i18n/format';

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
    /** The salon's local date (package expiry, membership). */
    today?: string;
    timezone?: string;
  };
  services: Service[];
  categories: ServiceCategory[];
  staff: Staff[];
  /** Set when checking out an appointment (?appointment=) or billing a known client (?customer=). */
  prefill?: {
    appointmentId: string | null; customer: ClientLite | null; lines: PosPrefillLine[]; context?: string;
    /** Checking out a bridal / group event (its advances are applied by default). */
    eventId?: string | null;
    /** The client's packages with sessions left and their membership card (loaded with the page). */
    benefits?: Benefits | null;
  } | null;
}

/** What the client can use on this bill: package sessions and their member discount. */
export interface Benefits {
  packages: ClientPackage[]; membership: ClientMembership | null;
  /** Advances paid earlier (bridal / event bookings) still to be used. */
  advance?: { left: number; receipts: string[] };
}

interface Line {
  key: string; kind: 'service' | 'product' | 'custom'; serviceId: string | null; staffId: string;
  name: string; qty: number; unitPrice: number; discount: string;
  /** Services: the menu's override (null = statutory). Products: the rate chosen. Other: null (a service). */
  gstRate: number | null;
  /** Products: HSN code (optional). */
  code: string;
  /** Taken from this package of the client's (priced at the session's value, paid from the package). */
  packageId: string | null;
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
  const t = useT();
  const [pending, start] = useTransition();
  const activeStaff = useMemo(() => staff.filter((s) => s.active), [staff]);

  const [client, setClient] = useState<ClientLite | null>(prefill?.customer ?? null);
  const [lines, setLines] = useState<Line[]>(() => (prefill?.lines ?? []).map((l) => ({
    key: nextKey(), kind: l.serviceId ? 'service' : 'custom', serviceId: l.serviceId, staffId: l.staffId ?? '',
    name: l.name, qty: 1, unitPrice: Number(l.price), discount: '', gstRate: l.gstRate, code: '', packageId: null,
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
  const today = salon.today ?? localDate(new Date(), salon.timezone ?? 'Asia/Kolkata');

  // Packages and membership: loaded for the client on the bill.
  const [benefits, setBenefits] = useState<Benefits | null>(prefill?.benefits ?? null);
  const benefitsFor = useRef<string | null>(prefill?.customer?.id ?? null);
  useEffect(() => {
    const id = client?.id ?? null;
    if (benefitsFor.current === id) return;
    benefitsFor.current = id;
    setBenefits(null);
    // Package sessions belong to the client: a different client can't keep them on the bill.
    setLines((cur) => cur.map((l) => (l.packageId ? { ...l, packageId: null, unitPrice: menuPrice(l) } : l)));
    if (!id) return;
    let live = true;
    getClientBenefits(id).then((r) => { if (live && r.ok) setBenefits(r.data ?? null); });
    return () => { live = false; };
  }, [client?.id]);
  const membership = benefits?.membership ?? null;
  const menuPrice = (l: Line) => Number(services.find((x) => x.id === l.serviceId)?.price ?? l.unitPrice);
  /** Sessions of a package item already put on this bill (other than `exceptKey`). */
  const sessionsOnBill = (packageId: string, serviceId: string | null, exceptKey?: string) =>
    lines.filter((l) => l.packageId === packageId && l.serviceId === serviceId && l.key !== exceptKey).reduce((s, l) => s + l.qty, 0);
  const sessionsFor = (l: Line) => usableSessions(benefits?.packages ?? [], l.serviceId, today)
    .map((u) => ({ ...u, free: u.left - sessionsOnBill(u.packageId, l.serviceId, l.key) }));
  const usePackage = (l: Line, packageId: string | null) => {
    const u = packageId ? sessionsFor(l).find((x) => x.packageId === packageId) : null;
    update(l.key, u ? { packageId: u.packageId, unitPrice: u.unitValue, discount: '', qty: Math.min(l.qty, Math.max(1, u.free)) } : { packageId: null, unitPrice: menuPrice(l) });
  };

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
    lines.map((l) => ({
      kind: l.kind, name: l.name, qty: l.qty, unitPrice: l.unitPrice, discount: l.packageId ? 0 : parseAmount(l.discount), gstRate: l.gstRate,
      fromPackage: !!l.packageId, memberPct: l.packageId ? 0 : memberPctFor(l.kind, membership),
    })),
    { gstMode: salon.gstMode, pricesIncludeTax: salon.pricesIncludeTax, serviceRate: salon.serviceRate },
  ), [lines, salon.gstMode, salon.pricesIncludeTax, salon.serviceRate, membership]);
  // Package sessions are paid from the package; the client pays the rest now.
  const fromPackages = bill.packageTotal;
  // Advances paid earlier: on by default when checking out an event.
  const advanceAvail = benefits?.advance?.left ?? 0;
  const [useAdvance, setUseAdvance] = useState(!!prefill?.eventId);
  const advanceUsed = useAdvance ? Math.round(Math.min(advanceAvail, Math.max(0, bill.total - fromPackages)) * 100) / 100 : 0;
  const prepaid = fromPackages + advanceUsed;
  const packagesUsed = [...new Set(lines.filter((l) => l.packageId).map((l) => benefits?.packages.find((p) => p.id === l.packageId)?.name).filter(Boolean))];

  const fixedSum = pays.filter((p) => !p.auto).reduce((s, p) => s + parseAmount(p.amount), 0);
  const remainder = Math.max(0, Math.round((bill.total - prepaid - fixedSum) * 100) / 100);
  // A Coins row that fills the rest never takes more than the client has.
  const fixedCoins = pays.filter((p) => !p.auto && p.method === 'wallet').reduce((s, p) => s + parseAmount(p.amount), 0);
  const autoAmount = (p: PayRow) => (p.method === 'wallet' ? usableCoins(coinBalance - fixedCoins, remainder) : remainder);
  const payRows = pays.map((p) => (p.auto ? { ...p, amount: autoAmount(p) ? String(autoAmount(p)) : '' } : p));
  const paid = Math.round((prepaid + payRows.reduce((s, p) => s + parseAmount(p.amount), 0)) * 100) / 100;
  const balance = Math.round((bill.total - paid) * 100) / 100;
  const coinsUsed = Math.round(payRows.filter((p) => p.method === 'wallet').reduce((s, p) => s + parseAmount(p.amount), 0) * 100) / 100;
  const coinsShort = coinsUsed > coinBalance + 0.001;
  const coinsBlocked = !client ? t('pos.coinsNeedClient') : coinBalance <= 0 ? t('pos.noCoins', { name: client.name.split(' ')[0] }) : null;
  const overDiscount = bill.lines.some((b, i) => !lines[i]?.packageId && b.discount > Math.round(lines[i].qty * lines[i].unitPrice * 100) / 100);
  const packageOver = lines.some((l) => {
    if (!l.packageId) return false;
    const u = sessionsFor(l).find((x) => x.packageId === l.packageId);
    return !u || u.free < l.qty;
  });
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
    if (other.length) out.push({ id: 'other', name: t('common.other'), items: other });
    return out.filter((g) => g.items.length);
  }, [services, categories, q, t]);

  const countOf = (serviceId: string) => lines.filter((l) => l.serviceId === serviceId).reduce((s, l) => s + l.qty, 0);

  const addService = (s: Service) => {
    setError(null);
    setLines((cur) => {
      const same = cur.find((l) => l.serviceId === s.id && l.staffId === defaultStaff && !l.packageId);
      if (same) return cur.map((l) => (l === same ? { ...l, qty: l.qty + 1 } : l));
      return [...cur, { key: nextKey(), kind: 'service', serviceId: s.id, staffId: defaultStaff, name: s.name, qty: 1, unitPrice: Number(s.price), discount: '', gstRate: s.gst_rate, code: '', packageId: null }];
    });
  };

  const addCustom = () => {
    const name = customName.trim();
    const price = parseAmount(customPrice);
    if (!name) { setError(t('pos.customNoName')); customNameRef.current?.focus(); return; }
    if (!price) { setError(t('pos.customNoPrice', { name })); return; }
    const isProduct = customKind === 'product';
    if (isProduct && regular && customRate === null) { setError(t('pos.customNoType', { name })); return; }
    const hsn = customHsn.trim();
    if (isProduct && hsn && !HSN_RE.test(hsn)) { setError(t('pos.badHsn')); return; }
    setError(null);
    setLines((cur) => [...cur, {
      key: nextKey(), kind: customKind, serviceId: null, staffId: isProduct ? '' : defaultStaff, name, qty: 1, unitPrice: price, discount: '',
      gstRate: isProduct ? (regular ? customRate : 0) : null, code: isProduct ? hsn : '', packageId: null,
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
    const amount = usableCoins(coinBalance, bill.total - prepaid - fixedOthers);
    const rest = Math.round((bill.total - prepaid - fixedOthers - amount) * 100) / 100;
    const coinRow: PayRow = { key: nextKey(), method: 'wallet', amount: String(amount), reference: '', auto: false };
    // Coins cover the whole bill: the row that would take the rest is no longer needed.
    const kept = others.map((p) => ({ ...p, auto: p.key === keyOfRest })).filter((p) => !(p.key === keyOfRest && rest <= 0));
    if (rest > 0 && !kept.some((p) => p.auto)) kept.push(freshPay(defaultMethod));
    return [coinRow, ...kept];
  });

  const save = () => start(async () => {
    setError(null);
    if (!lines.length) return setError(t('err.emptyBill'));
    if (coinsUsed > 0 && coinsBlocked) return setError(coinsBlocked);
    if (coinsShort) return setError(t('pos.coinsShort', { name: client?.name.split(' ')[0] ?? t('pos.theClient'), coins: coinsT(t, coinBalance) }));
    if (overDiscount) return setError(t('pos.overDiscount'));
    if (packageOver) return setError(t('pos.packageOver'));
    if (productNoRate) return setError(t('pos.productNoRate'));
    if (gstinBad) return setError(t('pos.gstinBadSave'));
    if (balance < 0) return setError(t('pos.overpaid', { money: money(-balance) }));
    const r = await createInvoice({
      customerId: client?.id ?? null,
      appointmentId: prefill?.appointmentId ?? null,
      eventId: prefill?.eventId ?? null,
      items: lines.map((l) => ({
        kind: l.kind, serviceId: l.serviceId, staffId: l.staffId || null, name: l.name,
        qty: l.qty, unitPrice: l.unitPrice, discount: l.packageId ? 0 : parseAmount(l.discount), gstRate: l.gstRate, code: l.code || null,
        clientPackageId: l.packageId,
      })),
      payments: [
        ...(advanceUsed > 0 ? [{ method: 'advance' as const, amount: advanceUsed }] : []),
        ...payRows.filter((p) => parseAmount(p.amount) > 0).map((p) => ({ method: p.method, amount: parseAmount(p.amount), reference: p.reference })),
      ],
      notes,
      sendOnWhatsApp: sendWa && !!client,
      clientGstin: regular && b2bOpen ? gstinClean || null : null,
      clientAddress: regular && (b2bOpen || needsAddress || clientAddress.trim()) ? clientAddress.trim() || null : null,
    });
    if (!r.ok) { setError(t.err(r.error)); toast(t.err(r.error), 'error'); return; }
    // The server's message is English ("Bill GS-01043 saved and sent on WhatsApp"); say the same in the desk's language.
    const no = r.data?.invoiceNo ?? '';
    const msg = r.message ?? '';
    toast(t.locale === 'en' && msg ? msg : msg.includes('not sent on WhatsApp') ? t('pos.savedNotSent', { no }) : msg.includes('sent on WhatsApp') ? t('pos.savedSent', { no }) : t('pos.savedNo', { no }));
    router.push(`/app/invoices/${r.data!.id}${printAfter ? '?print=1' : ''}`);
  });

  const saveLabel = t('pos.saveTotal', { money: money(bill.total) });
  const canSave = lines.length > 0 && !overDiscount && !packageOver && balance >= 0 && !coinsShort && !productNoRate && !gstinBad;
  const payState = !lines.length ? null
    : balance < 0 ? <span className="small strong danger-text">{t('pos.moreThanBill', { money: money(-balance) })}</span>
    : balance === 0 ? <span className="small strong success-text">{t('pos.paidInFull')}</span>
    : paid > 0 ? <span className="small strong warn-text">{t('pos.partPaid', { money: money(balance) })}</span>
    : <span className="small strong warn-text">{t('pos.unpaid')}</span>;

  return (
    <>
      <Topbar title={t('nav.pos')} back={prefill?.eventId ? `/app/events/${prefill.eventId}` : prefill?.appointmentId ? '/app' : undefined}
        subtitle={prefill?.context ?? t('pos.nextNo', { no: salon.nextInvoiceNo })}
        actions={lines.length > 0 && !prefill?.appointmentId && !prefill?.eventId
          ? <Button variant="ghost" size="sm" onClick={() => { setLines([]); setPays([freshPay(defaultMethod)]); }}>{t('pos.clear')}</Button>
          : undefined} />
      <div className="page">
        <div className="pos">
          {/* ---------------- Catalogue ---------------- */}
          <Panel title={t('pos.addToBill')} className="pos-catalogue">
            <div className="stack-lg">
              {services.length > 8 && <SearchInput value={q} onChange={setQ} placeholder={t('appt.findService')} />}
              {groups.map((g) => (
                <section key={g.id} className="stack-sm">
                  <div className="tiny muted strong">{g.name}</div>
                  <div className="pos-chips">
                    {g.items.map((s) => {
                      const n = countOf(s.id);
                      return (
                        <button key={s.id} type="button" className={cx('chip', 'pos-chip', n > 0 && 'is-on')} onClick={() => addService(s)}
                          aria-label={n ? t('pos.addAriaOn', { name: s.name, money: money(s.price), n }) : t('pos.addAria', { name: s.name, money: money(s.price) })}>
                          {n > 0 ? <span className="pos-chip-count num">{n}</span> : <Icon name="plus" size={14} className="pos-chip-icon" />}
                          <span className="pos-chip-name">{s.name}</span>
                          <span className="num pos-chip-price">{money(s.price)}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
              {!groups.length && <p className="small muted">{q ? t('pos.noMatch', { q }) : t('pos.menuEmpty')}</p>}

              <section className="stack-sm pos-custom">
                <div className="between">
                  <div className="tiny muted strong">{t('pos.custom')}</div>
                  <Segmented label={t('pos.itemType')} value={customKind} onChange={setCustomKind}
                    options={[{ value: 'product', label: t('pos.product') }, { value: 'custom', label: t('common.other') }]} />
                </div>
                <form className="stack-sm" onSubmit={(e) => { e.preventDefault(); addCustom(); }}>
                  {customKind === 'product' && regular && (
                    <div className="pos-tax-types" role="group" aria-label={t('pos.productTypeAria')}>
                      {PRODUCT_TAX_TYPES.map((x) => (
                        <button key={x.key} type="button" className="chip chip-sm" aria-pressed={customRate === x.rate} title={t(`gst.${x.key}Hint`)}
                          onClick={() => setCustomRate(x.rate)}>{x.rate}% · {t(`gst.${x.key}`)}</button>
                      ))}
                    </div>
                  )}
                  <div className="pos-custom-row">
                    <input ref={customNameRef} className="input" placeholder={customKind === 'product' ? t('pos.productPh') : t('pos.otherPh')}
                      value={customName} onChange={(e) => setCustomName(e.target.value)} aria-label={t('pos.itemName')} />
                    <div className="prefix-input pos-price">
                      <span>₹</span>
                      <input className="input num" inputMode="decimal" placeholder={t('pos.price')} value={customPrice}
                        onChange={(e) => setCustomPrice(e.target.value)} aria-label={t('pos.itemPrice')} />
                    </div>
                    <Button type="submit" icon="plus">{t('pos.add')}</Button>
                  </div>
                  {customKind === 'product' && regular && (
                    <div className="row-wrap pos-hsn">
                      <input className="input input-sm num" inputMode="numeric" maxLength={8} placeholder={t('pos.hsnPh')} value={customHsn}
                        onChange={(e) => setCustomHsn(e.target.value.replace(/\D/g, ''))} aria-label={t('pos.hsnAria')} />
                      <span className="tiny muted">{(() => { const x = PRODUCT_TAX_TYPES.find((y) => y.rate === customRate); return x ? t(`gst.${x.key}Hint`) : t('pos.pickType'); })()}</span>
                    </div>
                  )}
                  {customKind === 'custom' && regular && <span className="tiny muted">{t('pos.asService', { rate: salon.serviceRate })}</span>}
                </form>
              </section>
            </div>
          </Panel>

          {/* ---------------- The bill ---------------- */}
          <div className="stack pos-bill">
            <Panel title={t('appt.client')} className="pos-client" actions={!client ? <span className="small muted">{t('pos.clientOptional')}</span> : undefined}>
              <ClientPicker value={client} onChange={setClient} />
              {client && membership && (
                <div className="member-strip">
                  <span className="member-badge" aria-hidden><Icon name="idcard" size={17} /></span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="strong small">{t('pt.member', { name: membership.name })}</div>
                    <div className="tiny muted truncate">{perksT(t, membership)} · {t('pos.until', { day: dayTextT(t, membership.ends_on, today) })}</div>
                  </div>
                  {bill.memberDiscountTotal > 0 && <span className="small strong success-text num nowrap">−{money(bill.memberDiscountTotal)}</span>}
                </div>
              )}
              {client && !!benefits?.packages.length && (
                <div className="tiny muted row" style={{ gap: 6 }}>
                  <Icon name="box" size={14} />
                  {benefits.packages.map((p) => p.name).join(', ')} · {t('pos.tapUsePackage')}
                </div>
              )}
              {regular && (b2bOpen || needsAddress) && (
                <div className="stack-sm pos-b2b">
                  {b2bOpen && (
                    <TextField label={t('pos.clientGstin')} value={clientGstin} maxLength={15} className="mono-upper" placeholder="19ABCDE1234F1Z5"
                      onChange={(e) => setClientGstin(e.target.value.toUpperCase().replace(/\s/g, ''))}
                      error={gstinBad ? t('pos.gstinBad') : undefined}
                      hint={t('pos.gstinHint')} />
                  )}
                  <TextField label={t('pos.clientAddress')} value={clientAddress} maxLength={240} onChange={(e) => setClientAddress(e.target.value)}
                    placeholder={t('pos.addressPh')} hint={needsAddress ? undefined : t('pos.addressHint')} />
                  {needsAddress && <Notice tone="warn">{t('pos.needsAddress', { money: money(B2C_ADDRESS_LIMIT) })}{!client ? ` ${t('pos.chooseClientAbove')}` : ''}</Notice>}
                </div>
              )}
              {regular && !b2bOpen && (
                <button type="button" className="link-btn small pos-b2b-link" onClick={() => setB2bOpen(true)}>{t('pos.b2bLink')}</button>
              )}
            </Panel>

            <Panel className="pos-lines" title={lines.length ? `${t(`doc.${doc.type}`)} · ${t('common.items', { count: lines.length })}` : t(`doc.${doc.type}`)} flush
              actions={activeStaff.length > 0 && lines.length > 0 ? (
                <select className="select input-sm pos-default-staff" value={defaultStaff} aria-label={t('pos.stylistNewItems')}
                  onChange={(e) => setDefaultStaff(e.target.value)}>
                  <option value="">{t('pos.newItemsNone')}</option>
                  {activeStaff.map((s) => <option key={s.id} value={s.id}>{t('pos.newItems', { name: s.name })}</option>)}
                </select>
              ) : undefined}>
              {lines.length ? (
                <ul className="list">
                  {lines.map((l, i) => {
                    const calc = bill.lines[i];
                    const base = l.qty * l.unitPrice;
                    const disc = calc.discount;
                    const bad = !l.packageId && disc > base;
                    const pkgName = l.packageId ? benefits?.packages.find((p) => p.id === l.packageId)?.name ?? t('rcpt.package') : null;
                    const sessions = l.kind === 'service' ? sessionsFor(l) : [];
                    const using = l.packageId ? sessions.find((u) => u.packageId === l.packageId) : undefined;
                    return (
                      <li key={l.key} className={cx('bill-line', l.packageId && 'is-package')}>
                        <div className="between" style={{ alignItems: 'flex-start' }}>
                          <div className="grow">
                            <div className="strong">{l.name}</div>
                            {(l.qty > 1 || l.kind === 'product' || (regular && calc.gstRate !== salon.serviceRate)) && (
                              <div className="tiny muted num">
                                {[l.qty > 1 ? `${money(l.unitPrice)} × ${l.qty}` : '', l.kind === 'product' ? t('pos.product') : '',
                                  regular && (l.kind === 'product' || calc.gstRate !== salon.serviceRate) ? (l.gstRate === null && l.kind === 'product' ? t('pos.chooseGst') : `GST ${calc.gstRate}%`) : '',
                                  regular && l.code ? `HSN ${l.code}` : ''].filter(Boolean).join(' · ')}
                              </div>
                            )}
                            {pkgName && <div className="tiny strong pkg-line-note"><Icon name="box" size={13} />{t('pos.fromPackage', { name: pkgName, money: money(l.unitPrice) })}</div>}
                            {calc.memberDiscount > 0 && <div className="tiny strong success-text num">{t('pos.memberLine', { pct: pctText(calc.memberPct) })} · −{money(calc.memberDiscount)}</div>}
                          </div>
                          <div className="right">
                            <div className="strong num">{money(calc.lineTotal)}</div>
                            {disc > 0 && !bad && <div className="tiny muted num"><s>{money(base)}</s></div>}
                            {l.packageId && <div className="tiny muted">{t('pos.paidFromPackage')}</div>}
                          </div>
                          <Button size="sm" variant="ghost" icon="x" aria-label={t('pos.remove', { name: l.name })} onClick={() => remove(l.key)} />
                        </div>
                        <div className="bill-line-controls">
                          {l.kind === 'product' && regular && (
                            <select className="select input-sm pos-line-tax" value={l.gstRate ?? ''} aria-label={t('pos.lineTaxAria', { name: l.name })}
                              aria-invalid={l.gstRate === null || undefined} onChange={(e) => update(l.key, { gstRate: e.target.value === '' ? null : Number(e.target.value) })}>
                              <option value="">{t('pos.productTypeChoose')}</option>
                              {PRODUCT_TAX_TYPES.map((x) => <option key={x.key} value={x.rate}>{x.rate}% · {t(`gst.${x.key}`)}</option>)}
                            </select>
                          )}
                          <select className="select input-sm" value={l.staffId} aria-label={t('pos.stylistFor', { name: l.name })}
                            onChange={(e) => { update(l.key, { staffId: e.target.value }); if (e.target.value) setDefaultStaff(e.target.value); }}>
                            <option value="">{l.kind === 'product' ? t('pos.noStylist') : t('pos.stylistChoose')}</option>
                            {activeStaff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                          <div className="stepper" role="group" aria-label={t('pos.qtyOf', { name: l.name })}>
                            <button type="button" aria-label={t('pos.oneLess')} disabled={l.qty <= 1} onClick={() => update(l.key, { qty: l.qty - 1 })}><Icon name="minus" size={15} /></button>
                            <span className="num" aria-live="polite">{l.qty}</span>
                            <button type="button" aria-label={t('pos.oneMore')} disabled={!!using && l.qty >= using.free} onClick={() => update(l.key, { qty: l.qty + 1 })}><Icon name="plus" size={15} /></button>
                          </div>
                          {!l.packageId && <>
                          <div className="prefix-input pos-disc">
                            <span>−₹</span>
                            <input className="input input-sm num" inputMode="decimal" placeholder={t('common.discount')} value={l.discount}
                              aria-label={t('pos.discountOn', { name: l.name })} aria-invalid={bad || undefined}
                              onChange={(e) => update(l.key, { discount: e.target.value })} />
                          </div>
                          {[10, 20].map((pct) => {
                            const v = String(Math.round((base * pct) / 100));
                            return (
                              <button key={pct} type="button" className="chip chip-sm chip-pct" aria-pressed={l.discount === v}
                                onClick={() => update(l.key, { discount: l.discount === v ? '' : v })}>{pct}%</button>
                            );
                          })}
                          </>}
                        </div>
                        {(sessions.length > 0 || l.packageId) && (
                          <div className="pkg-chips" role="group" aria-label={t('pos.usePackageFor', { name: l.name })}>
                            {l.packageId ? (
                              <button type="button" className="chip chip-sm pkg-chip" aria-pressed onClick={() => usePackage(l, null)}
                                title={t('pos.menuPriceInstead')}>
                                <Icon name="box" size={14} />{t('pos.using', { name: pkgName ?? '' })}{using ? (using.free - l.qty <= 0 ? ` · ${t('pos.lastSession')}` : ` · ${t('pos.leftAfter', { left: using.free - l.qty, total: using.total })}`) : ''}
                                <Icon name="x" size={13} />
                              </button>
                            ) : sessions.filter((u) => u.free > 0).map((u) => (
                              <button key={u.packageId} type="button" className="chip chip-sm pkg-chip" aria-pressed={false} onClick={() => usePackage(l, u.packageId)}>
                                <Icon name="box" size={14} />{t('pos.usePackage', { name: l.name, left: u.free, total: u.total })}
                              </button>
                            ))}
                          </div>
                        )}
                        {bad && <div className="error-text">{t('pos.discountTooBig', { money: money(base) })}</div>}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="pos-empty">
                  <Icon name="receipt" size={22} />
                  <div className="strong">{t('pos.noItems')}</div>
                  <div className="small muted">{t('pos.noItemsBody')}</div>
                </div>
              )}
              {lines.length > 0 && (
                <div className="panel-foot">
                  <dl className="totals">
                    <dt>{t('common.subtotal')}</dt><dd className="num">{money(bill.subtotal)}</dd>
                    {bill.discountTotal > 0 && <><dt>{t('common.discount')}</dt><dd className="num">−{money(bill.discountTotal)}</dd></>}
                    {regular && <>
                      <dt className="muted">{t('bill.taxable')}</dt><dd className="num muted">{money(bill.taxableTotal)}</dd>
                      <dt className="muted">CGST{halfRate ? ` @ ${halfRate}` : ''}</dt><dd className="num muted">{money(bill.cgst)}</dd>
                      <dt className="muted">SGST{halfRate ? ` @ ${halfRate}` : ''}</dt><dd className="num muted">{money(bill.sgst)}</dd>
                    </>}
                    {bill.roundOff !== 0 && <><dt className="muted">{t('common.roundOff')}</dt><dd className="num muted">{bill.roundOff > 0 ? '+' : '−'}{money(Math.abs(bill.roundOff))}</dd></>}
                    <dt className="grand">{t('common.total')}</dt><dd className="grand num">{money(bill.total)}</dd>
                  </dl>
                  <div className="tiny muted" style={{ marginTop: 6 }}>
                    {regular ? (salon.pricesIncludeTax ? t('bill.inclGst') : t('pos.gstAdded'))
                      : salon.gstMode === 'composition' ? t('pos.composition')
                      : t('pos.unregistered')}
                  </div>
                </div>
              )}
            </Panel>

            <Panel title={t('pos.payment')} className="pos-pay" actions={payState}>
              <div className="stack">
                {fromPackages > 0 && (
                  <div className="pkg-strip">
                    <span className="pkg-badge" aria-hidden><Icon name="box" size={18} /></span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="strong num">{t('pos.pkgSessions', { money: money(fromPackages) })}</div>
                      <div className="tiny muted truncate">{t('pos.pkgPaidFrom', { names: packagesUsed.join(', ') })}</div>
                    </div>
                  </div>
                )}
                {client && advanceAvail > 0 && (
                  <div className="adv-strip">
                    <span className="adv-badge" aria-hidden><Icon name="heart" size={18} /></span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="strong num">{t('pos.advanceEarlier', { money: money(advanceAvail) })}</div>
                      <div className="tiny muted truncate">{useAdvance && advanceUsed > 0 ? t('pos.onThisBill', { money: money(advanceUsed) }) : t('pos.notUsed')} · {benefits?.advance?.receipts.join(', ')}</div>
                    </div>
                    <Switch checked={useAdvance} onChange={setUseAdvance} label={<span className="sr-only">{t('pos.useAdvance')}</span>} />
                  </div>
                )}
                {client && coinBalance > 0 && (
                  <div className="coin-strip">
                    <span className="coin-badge" aria-hidden><Icon name="coins" size={18} /></span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="strong num">{t('pos.coinsAvail', { n: fmtCoins(coinBalance) })}</div>
                      <div className="tiny muted num truncate">
                        {coinsUsed > 0 ? t('pos.coinsOnBill', { used: fmtCoins(coinsUsed), left: fmtCoins(Math.max(coinBalance - coinsUsed, 0)) }) : t('pos.coinsBalance', { name: client.name.split(' ')[0] })}
                      </div>
                    </div>
                    {lines.length > 0 && bill.total - prepaid > 0 && (coinsUsed === 0 || (coinsUsed < Math.min(coinBalance, bill.total - prepaid) && balance > 0)) && (
                      <Button size="sm" icon="coins" onClick={useCoins}>{t('pos.useCoins')}</Button>
                    )}
                  </div>
                )}
                {payRows.map((p, idx) => (
                  <div key={p.key} className="pay-row">
                    <div className="between">
                      <div className="pay-methods" role="group" aria-label={t('pos.payMethodAria', { n: idx + 1 })}>
                        {methods.map((m) => {
                          const off = m === 'wallet' && !!coinsBlocked && p.method !== 'wallet';
                          return (
                            <button key={m} type="button" className="chip chip-sm" aria-pressed={p.method === m} disabled={off}
                              title={off ? coinsBlocked ?? undefined : undefined} onClick={() => setPay(p.key, { method: m })}>
                              <Icon name={METHOD_ICON[m]} size={14} className="hide-mobile" />{t(`method.${m}`)}
                            </button>
                          );
                        })}
                      </div>
                      {payRows.length > 1 && <Button size="sm" variant="ghost" icon="x" aria-label={t('pos.removePay')} onClick={() => setPays2((rows) => rows.filter((x) => x.key !== p.key))} />}
                    </div>
                    <div className="pay-inputs">
                      <div className="prefix-input">
                        <span>₹</span>
                        <input className="input num pay-amount" inputMode="decimal" placeholder="0" value={p.amount}
                          aria-label={t('pos.amountBy', { method: t(`method.${p.method}`) })} onChange={(e) => setPayAmount(p.key, e.target.value)} />
                      </div>
                      {p.method !== 'cash' && p.method !== 'cash_nu' && p.method !== 'wallet' && (
                        <input className="input" placeholder={refPlaceholder(t, p.method)} value={p.reference}
                          aria-label={t('pos.payRef')} onChange={(e) => setPay(p.key, { reference: e.target.value })} />
                      )}
                      {p.method === 'wallet' && (
                        <span className={coinsShort ? 'small strong danger-text' : 'small muted num'}>
                          {coinsShort ? t('pos.onlyCoins', { coins: coinsT(t, coinBalance) }) : coinsBlocked ?? t('pos.ofCoins', { coins: coinsT(t, coinBalance) })}
                        </span>
                      )}
                      {!p.auto && balance !== 0 && parseAmount(p.amount) + balance > 0 && (
                        <Button size="sm" onClick={() => fillRest(p.key)}>{t('pos.fullAmount')}</Button>
                      )}
                    </div>
                    {p.method === 'upi_bhutan' && parseAmount(p.amount) > BHUTAN_UPI_LIMITS.perPayment && (
                      <p className="tiny warn-text">{t('pos.bhutanLimit', { per: money(BHUTAN_UPI_LIMITS.perPayment), day: money(BHUTAN_UPI_LIMITS.perDay) })}</p>
                    )}
                    {isUpiMethod(p.method) && parseAmount(p.amount) > 0 && lines.length > 0 && (salon.upi ? (
                      <div className="pay-qr">
                        <UpiQr vpa={salon.upi.vpa} name={salon.upi.name} amount={parseAmount(p.amount)} note={`Bill ${salon.nextInvoiceNo}`} size={132} caption="short" />
                        <p className="tiny muted">{t('pos.upiTo', { name: salon.upi.name })} · <span className="mono">{salon.upi.vpa}</span><br />{t('pos.upiHow')}</p>
                      </div>
                    ) : (
                      <p className="tiny muted">{rich(t('pos.upiSetup'), { settings: <Link href="/app/settings#payments">{t('nav.settings')}</Link> })}</p>
                    ))}
                  </div>
                ))}
                {coinsBlocked && methods.includes('wallet') && <p className="tiny muted row" style={{ gap: 6 }}><Icon name="coins" size={14} />{client ? `${coinsBlocked} ${t('pos.sellCoinsHint')}` : `${t('method.wallet')}: ${coinsBlocked}`}</p>}
                {!payRows.length && (
                  <p className="small muted">{t('pos.noPayment')}</p>
                )}
                <div className="row-wrap">
                  {payRows.length > 0 && payRows.length < 4 && <Button size="sm" variant="ghost" icon="plus" onClick={addPayRow}>{t('pos.split')}</Button>}
                  {payRows.length === 0 && <Button size="sm" icon="plus" onClick={addPayRow}>{t('pos.addPayment')}</Button>}
                  {payRows.length > 0 && <Button size="sm" variant="ghost" onClick={() => setPays([])}>{t('pos.later')}</Button>}
                  {!showNotes && <Button size="sm" variant="ghost" icon="edit" onClick={() => setShowNotes(true)}>{t('pos.addNote')}</Button>}
                </div>
                {showNotes && <TextField label={t('pos.noteLabel')} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('pos.notePh')} autoFocus />}

                <div className="divider" />
                <Switch checked={sendWa && !!client} disabled={!client || !salon.waConnected} onChange={setSendWa}
                  label={<span className="small">
                    {t('pos.sendWa')}
                    {!salon.waConnected ? <span className="muted"> · {t('pos.connectWa')}</span> : !client ? <span className="muted"> · {t('pos.chooseClientFirst')}</span> : null}
                  </span>} />
                <Switch checked={printAfter} onChange={changePrintAfter}
                  label={<span className="small">{t('pos.printAfter')} <span className="muted">· {salon.receiptSize === 'a4' ? 'A4' : `${salon.receiptSize ?? '80'} mm`}</span></span>} />
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
          <div className="tiny muted">{lines.length ? `${t('common.items', { count: lines.length })}${balance > 0 && paid > 0 ? ` · ${t('pos.due', { money: money(balance) })}` : ''}` : t('pos.noItemsShort')}</div>
          <div className="strong num pos-bar-total">{money(bill.total)}</div>
        </div>
        <Button variant="primary" size="lg" loading={pending} disabled={!canSave} onClick={save}>{t('pos.save')}</Button>
      </div>
    </>
  );
}
