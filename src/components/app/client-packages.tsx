'use client';
// Packages and membership cards on the client profile: sessions left, expiry, history; selling a package (with a
// package receipt — not a tax invoice) or a membership card (a normal bill line); owners/managers cancel packages.
import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Button, Dialog, Notice, Panel, Sheet, Switch, TextArea, TextField, cx, useToast } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { deskMethods, METHOD_ICON, REF_PLACEHOLDER, parseAmount } from './billing-bits';
import { cancelPackage, sellMembership, sellPackage } from '@/actions/packages';
import { money } from '@/lib/billing';
import { coinsText } from '@/lib/coins';
import {
  cardDates, dayText, daysLeft, membershipState, packageExpiry, packageLeft, packageSavingPct, packageState, packageTotalSessions, PACKAGE_STATE_LABEL,
  perksText, sessionsLeft, sessionsText, sessionValues, validityText,
} from '@/lib/packages';
import { fmtDateYear } from '@/lib/periods';
import { fmtTime } from '@/lib/time';
import { MONEY_METHODS, METHOD_LABEL, type ClientMembership, type ClientPackage, type GstMode, type MembershipPlan, type PayMethod } from '@/lib/types';

/** A package on the salon's menu with its services' names and menu prices. */
export interface PackageMenuItem { id: string; name: string; price: number; validity_days: number; items: { service_id: string; name: string; sessions: number; price: number }[] }

export interface ClientBenefitsProps {
  customer: { id: string; name: string; coinBalance: number };
  salon: { name: string; methods?: PayMethod[]; waConnected: boolean; gstMode: GstMode };
  today: string;
  tz: string;
  packages: ClientPackage[];
  /** Packages on sale now. */
  menu: PackageMenuItem[];
  memberships: ClientMembership[];
  /** Membership cards on sale now. */
  plans: MembershipPlan[];
  canSell: boolean;
  /** Owner / manager: cancel a package. */
  canCancel: boolean;
  /** Owner / manager: links to the menu of packages and cards. */
  canManage: boolean;
}

const STATE_TONE = { active: 'success', used: 'outline', expired: 'danger', cancelled: 'outline' } as const;
const moneyMethods = (enabled?: PayMethod[]) => deskMethods(enabled).filter((m) => MONEY_METHODS.includes(m) && m !== 'other');

// ---------------------------------------------------------------------------
// Packages panel
// ---------------------------------------------------------------------------
export function PackagesPanel(p: ClientBenefitsProps) {
  const [selling, setSelling] = useState(false);
  const [cancelling, setCancelling] = useState<ClientPackage | null>(null);
  const [showOld, setShowOld] = useState(false);
  const first = p.customer.name.split(' ')[0];
  const current = p.packages.filter((x) => packageState(x, p.today) === 'active');
  const old = p.packages.filter((x) => packageState(x, p.today) !== 'active');
  const example = p.menu[0];

  return (
    <>
      <Panel flush className="cpk-panel"
        title={<h2 className="row" style={{ gap: 8 }}><Icon name="box" size={18} className="pkg-title-icon" />Packages</h2>}
        actions={p.canSell && p.menu.length > 0 ? <Button size="sm" variant={current.length ? 'ghost' : 'primary'} icon="plus" onClick={() => setSelling(true)}>Sell package</Button> : undefined}>
        {current.length > 0 ? (
          <ul className="list">
            {current.map((x) => <li key={x.id}><PackageCard pkg={x} today={p.today} tz={p.tz} onCancel={p.canCancel ? () => setCancelling(x) : undefined} /></li>)}
          </ul>
        ) : (
          <div className="panel-body small muted">
            {example && p.canSell
              ? <>No package yet. Sell {first} a package to prepay visits — e.g. <span className="strong ink2">{example.name}</span> for <span className="num">{money(example.price)}</span>.</>
              : p.canManage ? <>Put packages like “6 Facials” on your menu under <Link href="/app/packages">Packages & memberships</Link>.</>
              : 'No packages.'}
          </div>
        )}
        {old.length > 0 && (
          <div className="panel-foot cpk-old">
            <button type="button" className="link-btn small" aria-expanded={showOld} onClick={() => setShowOld((v) => !v)}>
              {showOld ? 'Hide' : 'Show'} used, expired and cancelled ({old.length})
            </button>
          </div>
        )}
        {showOld && old.length > 0 && (
          <ul className="list cpk-old-list">
            {old.map((x) => <li key={x.id}><PackageCard pkg={x} today={p.today} tz={p.tz} /></li>)}
          </ul>
        )}
      </Panel>
      {p.canSell && <SellPackageSheet open={selling} onClose={() => setSelling(false)} {...p} />}
      {p.canCancel && <CancelPackageDialog pkg={cancelling} onClose={() => setCancelling(null)} methods={p.salon.methods} />}
    </>
  );
}

export function PackageCard({ pkg, today, tz, onCancel, compact }: { pkg: ClientPackage; today: string; tz: string; onCancel?: () => void; compact?: boolean }) {
  const state = packageState(pkg, today);
  const left = packageLeft(pkg);
  const dl = daysLeft(pkg.expires_on, today);
  return (
    <div className={cx('cpk', `is-${state}`)}>
      <div className="between cpk-head">
        <div style={{ minWidth: 0 }}>
          <div className="strong truncate">{pkg.name}</div>
          <div className="tiny muted num">
            {state === 'active' ? <>{sessionsText(left)} left · use by {dayText(pkg.expires_on, today)}{dl <= 14 ? <span className="warn-text strong"> · {dl === 0 ? 'last day today' : `${dl} day${dl === 1 ? '' : 's'} left`}</span> : ''}</>
              : state === 'expired' ? <>Ended {dayText(pkg.expires_on, today)} · {sessionsText(left)} unused</>
              : state === 'cancelled' ? <>Cancelled{pkg.cancel_reason ? ` · ${pkg.cancel_reason}` : ''}</>
              : <>All {packageTotalSessions(pkg)} sessions used</>}
          </div>
        </div>
        <Badge tone={STATE_TONE[state]}>{PACKAGE_STATE_LABEL[state]}</Badge>
      </div>
      <ul className="cpk-items">
        {pkg.items.map((i) => {
          const pct = Math.round((i.sessions_used / i.sessions_total) * 100);
          return (
            <li key={i.id}>
              <div className="between small">
                <span className="truncate">{i.name}</span>
                <span className="num nowrap"><span className="strong">{sessionsLeft(i)}</span> of {i.sessions_total} left</span>
              </div>
              <div className="cpk-bar" role="progressbar" aria-valuemin={0} aria-valuemax={i.sessions_total} aria-valuenow={i.sessions_used}
                aria-label={`${i.name}: ${i.sessions_used} of ${i.sessions_total} used`}>
                {Array.from({ length: Math.min(i.sessions_total, 24) }, (_, k) => (
                  <span key={k} className={k < Math.round((i.sessions_used / i.sessions_total) * Math.min(i.sessions_total, 24)) ? 'is-used' : undefined} />
                ))}
                {i.sessions_total > 24 && <span className="sr-only">{pct}% used</span>}
              </div>
            </li>
          );
        })}
      </ul>
      {!compact && (
        <div className="between cpk-foot tiny muted">
          <span className="num truncate">{pkg.receipt_no} · {money(pkg.amount_paid)} by {METHOD_LABEL[pkg.method]} · {fmtDateYear(pkg.purchased_at, tz)}
            {pkg.refund_amount ? <> · <span className="danger-text">{money(pkg.refund_amount)} handed back</span></> : ''}</span>
          {onCancel && state !== 'cancelled' && <button type="button" className="link-btn tiny danger-text nowrap" onClick={onCancel}>Cancel package</button>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sell a package
// ---------------------------------------------------------------------------
function SellPackageSheet({ open, onClose, customer, salon, menu, today, tz }: ClientBenefitsProps & { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const methods = moneyMethods(salon.methods);
  const [pick, setPick] = useState<string>('');
  const [method, setMethod] = useState<PayMethod>('upi');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [sendWa, setSendWa] = useState(salon.waConnected);
  const [error, setError] = useState<string | null>(null);
  const [sold, setSold] = useState<{ pkg: ClientPackage; sent: boolean } | null>(null);

  useEffect(() => {
    if (!open) return;
    setPick(menu[0]?.id ?? ''); setMethod(methods.includes('upi') ? 'upi' : methods[0] ?? 'cash');
    setReference(''); setNote(''); setError(null); setSold(null); setSendWa(salon.waConnected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const chosen = menu.find((m) => m.id === pick) ?? null;
  const values = useMemo(() => chosen ? sessionValues(chosen.price, chosen.items.map((i) => ({ sessions: i.sessions, menuPrice: i.price }))) : [], [chosen]);
  const first = customer.name.split(' ')[0];

  const submit = () => start(async () => {
    setError(null);
    if (!chosen) return setError('Pick a package.');
    const r = await sellPackage({ customerId: customer.id, packageId: chosen.id, method, reference: method === 'cash' || method === 'cash_nu' ? null : reference, note, sendOnWhatsApp: sendWa && salon.waConnected });
    if (!r.ok) return setError(r.error);
    setSold({ pkg: r.data!.package, sent: r.data!.sentOnWhatsApp });
    router.refresh();
  });

  if (sold) {
    return (
      <Sheet open={open} onClose={onClose} title="Package receipt" width={480}
        footer={<><Button icon="printer" onClick={() => window.print()}>Print</Button><Button variant="primary" onClick={onClose}>Done</Button></>}>
        <PackageReceipt pkg={sold.pkg} salonName={salon.name} customerName={customer.name} tz={tz} sent={sold.sent} />
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} width={540}
      title={<div><h2>Sell a package</h2><div className="small muted">to {customer.name}</div></div>}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={pending} disabled={!chosen} onClick={submit}>{chosen ? `Receive ${money(chosen.price)}` : 'Receive payment'}</Button></>}>
      <form className="stack-lg" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="field">
          <span className="label">Package</span>
          <div className="pkg-options" role="radiogroup" aria-label="Package">
            {menu.map((m) => {
              const value = m.items.reduce((s, i) => s + i.price * i.sessions, 0);
              const save = packageSavingPct(m.price, value);
              return (
                <button key={m.id} type="button" role="radio" aria-checked={pick === m.id} className={cx('pkg-option', pick === m.id && 'is-on')} onClick={() => setPick(m.id)}>
                  <span className="between" style={{ width: '100%' }}>
                    <span className="strong">{m.name}</span>
                    <span className="num strong">{money(m.price)}</span>
                  </span>
                  <span className="small muted">{m.items.map((i) => `${i.name} ×${i.sessions}`).join(' · ')}</span>
                  <span className="tiny muted">Valid {validityText(m.validity_days)}{save > 0 ? <> · <span className="success-text strong">save {save}%</span> on {money(value)}</> : ''}</span>
                </button>
              );
            })}
          </div>
        </div>

        {chosen && (
          <div className="pkg-summary">
            <div className="between small"><span className="muted">Use by</span><span className="strong num">{dayText(packageExpiry(today, chosen.validity_days))}</span></div>
            {chosen.items.map((i, k) => (
              <div key={i.service_id} className="between small"><span className="muted">{i.name} — each session on the bill</span><span className="num">{money(values[k])}</span></div>
            ))}
          </div>
        )}

        <div className="field">
          <span className="label">Paid by</span>
          <div className="row-wrap" role="group" aria-label="Paid by">
            {methods.map((m) => (
              <button key={m} type="button" className="chip chip-sm" aria-pressed={method === m} onClick={() => setMethod(m)}>
                <Icon name={METHOD_ICON[m]} size={14} />{METHOD_LABEL[m]}
              </button>
            ))}
          </div>
          {method !== 'cash' && method !== 'cash_nu' && (
            <input className="input" placeholder={REF_PLACEHOLDER[method]} value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} aria-label="Payment reference" />
          )}
          <span className="hint">Coins can’t buy a package — take cash, UPI or card.</span>
        </div>
        <TextField label="Note (optional)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Wedding on 12 Dec" />
        <Switch checked={sendWa && salon.waConnected} disabled={!salon.waConnected} onChange={setSendWa}
          label={<span className="small">Send {first} the receipt on WhatsApp{!salon.waConnected && <span className="muted"> · connect WhatsApp in Settings</span>}</span>} />
        <p className="tiny muted">This gives a <strong>package receipt, not a tax invoice</strong>. Each visit’s bill shows the service at its session value, paid from the package{salon.gstMode === 'regular' ? ', with GST on that bill' : ''}. Confirm the GST treatment with your CA.</p>
        {error && <Notice tone="error">{error}</Notice>}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

/** The printable package receipt (not a tax invoice). */
export function PackageReceipt({ pkg, salonName, customerName, tz, sent }: { pkg: ClientPackage; salonName: string; customerName: string; tz: string; sent?: boolean }) {
  return (
    <div className="stack-lg coin-receipt">
      <div className="coin-receipt-head">
        <span className="coin-receipt-icon"><Icon name="check" size={22} /></span>
        <div>
          <div className="strong">{pkg.name} sold to {customerName}</div>
          <div className="small muted">{sent ? `Receipt sent to ${customerName.split(' ')[0]} on WhatsApp` : 'Saved on their profile'}</div>
        </div>
      </div>
      <dl className="coin-receipt-lines">
        <div><dt>Package receipt</dt><dd className="num strong">{pkg.receipt_no}</dd></div>
        <div><dt>Salon</dt><dd>{salonName}</dd></div>
        <div><dt>Client</dt><dd>{customerName}</dd></div>
        <div><dt>Date</dt><dd className="num">{fmtDateYear(pkg.purchased_at, tz)}, {fmtTime(pkg.purchased_at, tz)}</dd></div>
        <div><dt>Package</dt><dd>{pkg.name}</dd></div>
        {pkg.items.map((i) => <div key={i.id}><dt>{i.name}</dt><dd className="num">{sessionsText(i.sessions_total)}</dd></div>)}
        <div><dt>Use by</dt><dd className="num">{dayText(pkg.expires_on)}</dd></div>
        <div><dt>Paid by</dt><dd>{METHOD_LABEL[pkg.method]}{pkg.reference ? <span className="muted"> · {pkg.reference}</span> : null}</dd></div>
        <div className="coin-receipt-total"><dt>Amount received</dt><dd className="num">{money(pkg.amount_paid)}</dd></div>
      </dl>
      <p className="tiny muted">Not a tax invoice. Prepaid sessions for use at {salonName} only, by the date above. Each visit gets a bill for the service at its session value, paid from this package; GST, if any, is on that bill.</p>
    </div>
  );
}

function CancelPackageDialog({ pkg, onClose, methods }: { pkg: ClientPackage | null; onClose: () => void; methods?: PayMethod[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState('');
  const [method, setMethod] = useState<PayMethod>('cash');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (pkg) { setReason(''); setRefund(''); setMethod('cash'); setError(null); } }, [pkg]);
  if (!pkg) return null;
  const amt = parseAmount(refund);
  const save = () => start(async () => {
    setError(null);
    if (!reason.trim()) return setError('Give a reason — it stays with the package.');
    if (amt > pkg.amount_paid) return setError(`Hand back up to ${money(pkg.amount_paid)}.`);
    const r = await cancelPackage(pkg.id, reason, amt > 0 ? { amount: amt, method } : null);
    if (!r.ok) return setError(r.error);
    toast(r.message ?? 'Package cancelled'); onClose(); router.refresh();
  });
  return (
    <Dialog open={!!pkg} onClose={onClose} title={`Cancel ${pkg.name}?`}
      footer={<><Button variant="ghost" onClick={onClose}>Keep package</Button><Button variant="danger" loading={pending} onClick={save}>Cancel package</Button></>}>
      <p className="small ink2">{sessionsText(packageLeft(pkg))} left won’t be usable. Sessions already used stay on their bills.</p>
      <TextArea label="Reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Sold to the wrong client" />
      <div className="field">
        <label htmlFor="pkg-refund">Money handed back <span className="muted">(optional)</span></label>
        <div className="prefix-input"><span>₹</span>
          <input id="pkg-refund" className="input num" inputMode="decimal" placeholder="0" value={refund} onChange={(e) => setRefund(e.target.value)} />
        </div>
        {amt > 0 && (
          <div className="row-wrap" role="group" aria-label="Handed back by">
            {moneyMethods(methods).map((m) => <button key={m} type="button" className="chip chip-sm" aria-pressed={method === m} onClick={() => setMethod(m)}>{METHOD_LABEL[m]}</button>)}
          </div>
        )}
        <span className="hint">Shows as handed back on today’s day close. Paid {money(pkg.amount_paid)} by {METHOD_LABEL[pkg.method]}.</span>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Membership panel
// ---------------------------------------------------------------------------
export function MembershipPanel(p: ClientBenefitsProps) {
  const [selling, setSelling] = useState(false);
  const cards = p.memberships;
  const live = cards.filter((m) => membershipState(m, p.today) === 'active').sort((a, b) => b.ends_on.localeCompare(a.ends_on))[0] ?? null;
  const next = cards.filter((m) => membershipState(m, p.today) === 'upcoming').sort((a, b) => a.starts_on.localeCompare(b.starts_on))[0] ?? null;
  const past = cards.filter((m) => m !== live && m !== next);
  const first = p.customer.name.split(' ')[0];
  const dl = live ? daysLeft(live.ends_on, p.today) : 0;
  const offer = p.plans[0];

  return (
    <>
      <Panel flush className="mem-panel"
        title={<h2 className="row" style={{ gap: 8 }}><Icon name="idcard" size={18} className="mem-title-icon" />Membership</h2>}
        actions={p.canSell && p.plans.length > 0 && (live || cards.length > 0)
          ? <Button size="sm" variant="ghost" icon="plus" onClick={() => setSelling(true)}>{live ? 'Renew' : 'Sell card'}</Button> : undefined}>
        {live ? (
          <div className="mem-card">
            <div className="between">
              <div className="mem-card-name">{live.name}</div>
              <Badge tone="success">Member</Badge>
            </div>
            <div className="mem-card-perks">{perksText(live)}</div>
            <div className="between small mem-card-foot">
              <span className="num">Valid till {dayText(live.ends_on)}{dl <= 30 ? <span className="strong"> · {dl === 0 ? 'last day' : `${dl} day${dl === 1 ? '' : 's'} left`}</span> : ''}</span>
              {live.invoice_id && <Link href={`/app/invoices/${live.invoice_id}`} className="mem-card-link">Card bill</Link>}
            </div>
          </div>
        ) : (
          <div className="panel-body stack-sm">
            <p className="small muted">
              {offer ? <>{first} isn’t a member. <span className="strong ink2">{offer.name}</span>: {money(offer.fee)} for {validityText(offer.validity_days)} — {perksText(offer)}, applied on every bill.</>
                : p.canManage ? <>Offer a membership card (e.g. ₹299 a year for 10% off services) under <Link href="/app/packages">Packages & memberships</Link>.</>
                : 'Not a member.'}
            </p>
            {p.canSell && offer && <div><Button size="sm" variant="primary" icon="idcard" onClick={() => setSelling(true)}>Sell membership card</Button></div>}
          </div>
        )}
        {next && <div className="panel-foot small"><Icon name="check" size={14} className="success-text" style={{ display: 'inline', verticalAlign: '-2px' }} /> Renewed: {next.name} from {dayText(next.starts_on)} to {dayText(next.ends_on)}</div>}
        {past.length > 0 && (
          <ul className="list mem-history">
            {past.slice(0, 4).map((m) => (
              <li key={m.id} className="between tiny">
                <span className="muted truncate">{m.name} · {dayText(m.starts_on)} – {dayText(m.ends_on)}</span>
                <span className={membershipState(m, p.today) === 'cancelled' ? 'danger-text' : 'muted'}>{membershipState(m, p.today) === 'cancelled' ? 'Cancelled' : 'Ended'}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {p.canSell && <SellMembershipSheet open={selling} onClose={() => setSelling(false)} {...p} />}
    </>
  );
}

function SellMembershipSheet({ open, onClose, customer, salon, plans, memberships, today }: ClientBenefitsProps & { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const methods = deskMethods(salon.methods, { clientHasCoins: customer.coinBalance > 0 }).filter((m) => m !== 'other');
  const [pick, setPick] = useState('');
  const [method, setMethod] = useState<PayMethod>('upi');
  const [reference, setReference] = useState('');
  const [sendWa, setSendWa] = useState(salon.waConnected);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ invoiceId: string; invoiceNo: string; m: ClientMembership } | null>(null);

  useEffect(() => {
    if (!open) return;
    setPick(plans[0]?.id ?? ''); setMethod(methods.includes('upi') ? 'upi' : methods[0] ?? 'cash'); setReference(''); setError(null); setDone(null);
    setSendWa(salon.waConnected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const plan = plans.find((x) => x.id === pick) ?? null;
  const dates = plan ? cardDates(memberships, today, plan.validity_days) : null;
  const coinsShort = method === 'wallet' && plan && customer.coinBalance < plan.fee;

  const submit = () => start(async () => {
    setError(null);
    if (!plan) return setError('Pick a membership card.');
    if (coinsShort) return setError(`${customer.name.split(' ')[0]} has only ${coinsText(customer.coinBalance)}.`);
    const r = await sellMembership({ customerId: customer.id, planId: plan.id, payments: [{ method, amount: plan.fee, reference: method === 'cash' || method === 'cash_nu' || method === 'wallet' ? null : reference }], sendOnWhatsApp: sendWa && salon.waConnected });
    if (!r.ok) return setError(r.error);
    setDone({ invoiceId: r.data!.invoiceId, invoiceNo: r.data!.invoiceNo, m: r.data!.membership });
    router.refresh();
  });

  if (done) {
    return (
      <Sheet open={open} onClose={onClose} title="Membership card sold" width={460}
        footer={<><Link className="btn btn-secondary" href={`/app/invoices/${done.invoiceId}`}><Icon name="receipt" />View bill {done.invoiceNo}</Link><Button variant="primary" onClick={onClose}>Done</Button></>}>
        <div className="stack-lg">
          <div className="coin-receipt-head">
            <span className="coin-receipt-icon"><Icon name="check" size={22} /></span>
            <div>
              <div className="strong">{customer.name} is a {done.m.name} member</div>
              <div className="small muted num">{dayText(done.m.starts_on)} to {dayText(done.m.ends_on)} · {perksText(done.m)}</div>
            </div>
          </div>
          <p className="small ink2">The member discount is applied on every bill automatically. The card fee is on bill {done.invoiceNo}.</p>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} width={520}
      title={<div><h2>{dates?.renewal ? 'Renew membership' : 'Sell a membership card'}</h2><div className="small muted">to {customer.name}</div></div>}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={pending} disabled={!plan || !!coinsShort} onClick={submit}>{plan ? `Receive ${money(plan.fee)} and start card` : 'Start card'}</Button></>}>
      <form className="stack-lg" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="field">
          <span className="label">Card</span>
          <div className="pkg-options" role="radiogroup" aria-label="Membership card">
            {plans.map((x) => (
              <button key={x.id} type="button" role="radio" aria-checked={pick === x.id} className={cx('pkg-option', pick === x.id && 'is-on')} onClick={() => setPick(x.id)}>
                <span className="between" style={{ width: '100%' }}><span className="strong">{x.name}</span><span className="num strong">{money(x.fee)}</span></span>
                <span className="small muted">{perksText(x)} · {validityText(x.validity_days)}</span>
              </button>
            ))}
          </div>
        </div>
        {plan && dates && (
          <div className="pkg-summary">
            <div className="between small"><span className="muted">{dates.renewal ? 'Starts when the current card ends' : 'Starts'}</span><span className="strong num">{dayText(dates.starts)}</span></div>
            <div className="between small"><span className="muted">Valid till</span><span className="strong num">{dayText(dates.ends)}</span></div>
          </div>
        )}
        <div className="field">
          <span className="label">Paid by</span>
          <div className="row-wrap" role="group" aria-label="Paid by">
            {methods.map((m) => (
              <button key={m} type="button" className="chip chip-sm" aria-pressed={method === m} onClick={() => setMethod(m)}>
                <Icon name={METHOD_ICON[m]} size={14} />{METHOD_LABEL[m]}
              </button>
            ))}
          </div>
          {method !== 'cash' && method !== 'cash_nu' && method !== 'wallet' && (
            <input className="input" placeholder={REF_PLACEHOLDER[method]} value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} aria-label="Payment reference" />
          )}
          {method === 'wallet' && <span className={coinsShort ? 'error-text' : 'hint num'}>{coinsShort ? `Only ${coinsText(customer.coinBalance)} available` : `${coinsText(customer.coinBalance)} available`}</span>}
        </div>
        <Switch checked={sendWa && salon.waConnected} disabled={!salon.waConnected} onChange={setSendWa}
          label={<span className="small">Send the bill on WhatsApp{!salon.waConnected && <span className="muted"> · connect WhatsApp in Settings</span>}</span>} />
        <p className="tiny muted">The card fee is billed like a service (“Membership card”, SAC 999729){salon.gstMode === 'regular' ? ', with GST' : ''}. Confirm the GST treatment with your CA.</p>
        {error && <Notice tone="error">{error}</Notice>}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
