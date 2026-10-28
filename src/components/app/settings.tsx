'use client';
import { rootDomain, salonUrl } from '@/lib/tenant';
import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Notice, Panel, Segmented, SelectField, Switch, TextArea, TextField, useToast } from '@/components/ui/ui';
import { Icon, type IconName } from '@/components/ui/icons';
import { Topbar } from './shell';
import { HoursEditor } from './hours-editor';
import { LOCALES, LOCALE_NAMES } from '@/lib/i18n/locales';
import { updateAssistant, updateBilling, updateBusinessHours, updateCoinSettings, updateOnlineBooking, updatePayments, updateSalonProfile } from '@/actions/settings';
import { UpiQr } from '@/components/ui/upi-qr';
import { BHUTAN_UPI_LIMITS, isValidVpa } from '@/lib/upi';
import { formatPhone } from '@/lib/phone';
import { PhoneInput } from '@/components/ui/phone-input';
import { PLAN_LABEL, PLAN_STATUS_LABEL, planById } from '@/lib/plans';
import { money } from '@/lib/billing';
import { checkCoinPacks, DEFAULT_COIN_PACKS, fmtCoins, MAX_COIN_PACKS } from '@/lib/coins';
import { cleanGstin, COMPOSITION_RATE, DEFAULT_STATE, GSTIN_RE, INDIAN_STATES, serviceGstRate, stateByCode, stateByName } from '@/lib/gst';
import { localDate } from '@/lib/time';
import { ALL_PAY_METHODS, DEFAULT_PAY_METHODS, METHOD_LABEL, type ActionResult, type GstMode, type Hours, type PayMethod, type ReceiptSize, type Salon } from '@/lib/types';

export interface SettingsProps {
  salon: Salon;
  hours: Hours;
  /** Where support requests go, e.g. "support@styile.com". */
  supportEmail: string;
}

const NOTES_MAX = 1500;

const SECTIONS: { id: string; label: string; icon: IconName }[] = [
  { id: 'profile', label: 'Salon profile', icon: 'store' },
  { id: 'billing', label: 'Billing & GST', icon: 'receipt' },
  { id: 'payments', label: 'Payments & receipts', icon: 'upi' },
  { id: 'coins', label: 'Coins', icon: 'coins' },
  { id: 'hours', label: 'Opening hours', icon: 'clock' },
  { id: 'booking', label: 'Online booking', icon: 'link' },
  { id: 'whatsapp', label: 'WhatsApp', icon: 'whatsapp' },
  { id: 'subscription', label: 'Subscription', icon: 'star' },
];

/** Runs an action with toast + refresh; returns the error for inline display. */
function useSave() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const router = useRouter();
  const run = (fn: () => Promise<ActionResult>) => start(async () => {
    setError(null);
    const r = await fn();
    if (!r.ok) { setError(r.error); return; }
    toast(r.message ?? 'Saved');
    router.refresh();
  });
  return { pending, error, run };
}

function Section({ id, title, description, children, footer }: { id: string; title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <section id={id} className="settings-section" aria-labelledby={`${id}-title`}>
      <Panel title={<div><h2 id={`${id}-title`}>{title}</h2>{description && <p className="small muted" style={{ marginTop: 2 }}>{description}</p>}</div>} footer={footer}>
        {children}
      </Panel>
    </section>
  );
}

function SaveBar({ pending, error, onSave, label = 'Save changes' }: { pending: boolean; error: string | null; onSave: () => void; label?: string }) {
  return (
    <div className="save-bar">
      {error ? <Notice tone="error">{error}</Notice> : <span />}
      <Button variant="primary" loading={pending} onClick={onSave}>{label}</Button>
    </div>
  );
}

export function SettingsScreen({ salon, hours, supportEmail }: SettingsProps) {
  const [active, setActive] = useState('profile');

  // Highlight the section in view in the side nav.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => !!e);
    const obs = new IntersectionObserver((entries) => {
      const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) setActive(top.target.id);
    }, { rootMargin: '-80px 0px -60% 0px' });
    els.forEach((e) => obs.observe(e));
    return () => obs.disconnect();
  }, []);
  // On phones the nav is a horizontal strip: keep the current chip visible.
  useEffect(() => {
    const link = document.querySelector<HTMLElement>(`.settings-nav a[href="#${active}"]`);
    const nav = link?.parentElement;
    if (link && nav && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: link.offsetLeft - 16, behavior: 'smooth' });
  }, [active]);

  return (
    <>
      <Topbar title="Settings" subtitle={salon.name} />
      <div className="page">
        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Settings sections">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} aria-current={active === s.id ? 'true' : undefined}
                onClick={(e) => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setActive(s.id); }}>
                <Icon name={s.icon} size={17} />{s.label}
              </a>
            ))}
          </nav>
          <div className="stack-lg settings-main">
            <ProfileSection salon={salon} />
            <BillingSection salon={salon} />
            <PaymentsSection salon={salon} />
            <CoinsSection salon={salon} />
            <HoursSection hours={hours} />
            <BookingSection salon={salon} />
            <WhatsAppSection salon={salon} supportEmail={supportEmail} />
            <SubscriptionSection salon={salon} supportEmail={supportEmail} />
          </div>
        </div>
      </div>
    </>
  );
}

function ProfileSection({ salon }: { salon: Salon }) {
  const [f, setF] = useState({
    name: salon.name, legalName: salon.legal_name ?? '', phone: salon.phone ? formatPhone(salon.phone) : '',
    email: salon.email ?? '', address: salon.address ?? '', city: salon.city ?? '', pincode: salon.pincode ?? '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const { pending, error, run } = useSave();
  return (
    <Section id="profile" title="Salon profile" description="Printed on bills and shown on your booking page."
      footer={<SaveBar pending={pending} error={error} onSave={() => run(() => updateSalonProfile(f))} />}>
      <div className="stack">
        <div className="grid-2">
          <TextField label="Salon name" value={f.name} onChange={set('name')} maxLength={80} />
          <TextField label="Legal / business name" hint="As registered for GST, if different" value={f.legalName} onChange={set('legalName')} maxLength={120} />
        </div>
        <div className="grid-2">
          <PhoneInput label="Phone" value={f.phone} onChange={(v) => setF((x) => ({ ...x, phone: v }))} />
          <TextField label="Email" type="email" value={f.email} onChange={set('email')} />
        </div>
        <TextField label="Address" value={f.address} onChange={set('address')} placeholder="Shop no., building, street, area" maxLength={240} />
        <div className="grid-3">
          <TextField label="City" value={f.city} onChange={set('city')} />
          <TextField label="PIN code" inputMode="numeric" maxLength={6} value={f.pincode} onChange={set('pincode')} />
          <div className="field">
            <span className="label">State</span>
            <span className="small ink2 settings-static">{salon.state || DEFAULT_STATE} <a href="#billing" className="small">Change under Billing &amp; GST</a></span>
          </div>
        </div>
      </div>
    </Section>
  );
}

const GST_CHOICES: { mode: GstMode; title: string; body: string; prints: string }[] = [
  { mode: 'unregistered', title: 'Not registered', prints: 'Bill',
    body: 'Sales under ₹20 lakh a year and no GSTIN. Your bills show no GST — you must not charge any.' },
  { mode: 'composition', title: 'Composition scheme', prints: 'Bill of Supply',
    body: `You pay ${COMPOSITION_RATE}% of your sales to the government yourself. Clients pay no GST on your bills.` },
  { mode: 'regular', title: 'Regular GST', prints: 'Tax Invoice',
    body: 'You charge clients GST: 5% on services, and 5% or 18% on products. Bills show CGST and SGST.' },
];

function BillingSection({ salon }: { salon: Salon }) {
  const [mode, setMode] = useState<GstMode>(salon.gst_mode ?? (salon.gstin ? 'regular' : 'unregistered'));
  const [gstin, setGstin] = useState(salon.gstin ?? '');
  const [state, setState] = useState(stateByName(salon.state)?.name ?? (salon.state || DEFAULT_STATE));
  const [inclusive, setInclusive] = useState(salon.prices_include_tax);
  const [prefix, setPrefix] = useState(salon.invoice_prefix);
  const { pending, error, run } = useSave();
  const registered = mode !== 'unregistered';
  const rate = serviceGstRate(localDate(new Date(), salon.timezone));
  const example = 1000;
  const g = cleanGstin(gstin);
  const gstinState = g.length >= 2 ? stateByCode(g.slice(0, 2)) : null;
  const chosen = stateByName(state);
  const gstinNote = !registered ? null
    : !g ? 'Printed on every bill. Your GST certificate has it.'
    : !GSTIN_RE.test(g) ? 'A GSTIN has 15 letters and numbers, like 19ABCDE1234F1Z5.'
    : gstinState && chosen && gstinState.code !== chosen.code ? `This GSTIN is from ${gstinState.name} (${gstinState.code}), but your state is ${chosen.name}.`
    : `Registered in ${gstinState?.name ?? chosen?.name ?? 'your state'}.`;
  const exampleText = inclusive
    ? `A ${money(example)} haircut is billed at ${money(example)} (${money(Math.round((example * 10000) / (100 + rate)) / 100)} + ${rate}% GST).`
    : `A ${money(example)} haircut is billed at ${money(example + (example * rate) / 100)} including ${rate}% GST.`;
  const save = () => run(() => updateBilling({ gstMode: mode, gstin: registered ? g : null, state, pricesIncludeTax: inclusive, invoicePrefix: prefix }));

  return (
    <Section id="billing" title="Billing & GST" description="Which bill you give clients, and how tax appears on it."
      footer={<SaveBar pending={pending} error={error} onSave={save} />}>
      <div className="stack">
        <fieldset className="choice-cards">
          <legend className="label">GST status</legend>
          {GST_CHOICES.map((c) => (
            <label key={c.mode} className={`choice-card${mode === c.mode ? ' is-on' : ''}`}>
              <input type="radio" name="gst-mode" value={c.mode} checked={mode === c.mode} onChange={() => setMode(c.mode)} />
              <span className="choice-body">
                <span className="strong">{c.title}</span>
                <span className="small ink2">{c.body}</span>
                <span className="choice-tag">Bills say “{c.prints}”</span>
              </span>
            </label>
          ))}
        </fieldset>
        {mode === 'composition' && (
          <p className="small ink2">
            Bills of supply carry the line “Composition taxable person, not eligible to collect tax on supplies”. Reports show an estimate of the {COMPOSITION_RATE}% you owe.
            {' '}On a {money(example)} haircut that’s about {money((example * COMPOSITION_RATE) / 100)} from your pocket; on regular GST the client pays {money((example * rate) / 100)} instead.
          </p>
        )}
        <div className="grid-2">
          {registered ? (
            <TextField label="GSTIN" value={gstin} placeholder="19ABCDE1234F1Z5" maxLength={15} className="mono-upper"
              onChange={(e) => setGstin(e.target.value.toUpperCase().replace(/\s/g, ''))}
              hint={<span className={gstinNote?.startsWith('This GSTIN') || (g && !GSTIN_RE.test(g)) ? 'warn-text' : undefined}>{gstinNote}</span>} />
          ) : null}
          <SelectField label="State" value={state} onChange={(e) => setState(e.target.value)}
            hint={mode === 'regular' ? 'Printed as the place of supply. Clients from Bhutan or other states served here are still billed CGST + SGST.' : 'Printed in your address.'}>
            {!chosen && state && <option value={state}>{state}</option>}
            {INDIAN_STATES.map((s) => <option key={s.code} value={s.name}>{s.name} ({s.code})</option>)}
          </SelectField>
          {!registered && (
            <TextField label="Bill number prefix" value={prefix} maxLength={6} className="mono-upper"
              onChange={(e) => setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              hint={<>Next bill: <span className="num strong ink2">{(prefix || 'INV')}-{String(salon.next_invoice_no).padStart(5, '0')}</span></>} />
          )}
        </div>
        {registered && (
          <div className="grid-2">
            <TextField label="Bill number prefix" value={prefix} maxLength={6} className="mono-upper"
              onChange={(e) => setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              hint={<>Next bill: <span className="num strong ink2">{(prefix || 'INV')}-{String(salon.next_invoice_no).padStart(5, '0')}</span> · numbers run in order, never repeat</>} />
            <div className="hide-mobile" />
          </div>
        )}
        {mode === 'regular' && (
          <div className="setting-row">
            <div className="grow">
              <div className="strong">Menu prices include GST</div>
              <div className="small muted">{exampleText}</div>
            </div>
            <Switch checked={inclusive} onChange={setInclusive} label={<span className="sr-only">Menu prices include GST</span>} />
          </div>
        )}
        <Notice>
          <span><strong>Confirm with your CA.</strong> Styile follows the GST rules as we understand them: salon services at 5% since 22 September 2025,
            retail products at their own rate (5% or 18%), registration from ₹20 lakh a year. We aren’t tax advisers — check your GST status, product rates and bill format with your CA.</span>
        </Notice>
      </div>
    </Section>
  );
}

const METHOD_HINT: Partial<Record<PayMethod, string>> = {
  cash: 'Rupee notes', upi: 'Indian UPI apps: PhonePe, Google Pay, Paytm, BHIM', card: 'Debit or credit card machine',
  cash_nu: 'Bhutanese Ngultrum notes, taken at par with the rupee',
  upi_bhutan: `Bhutanese bank apps scanning your QR · up to ${money(BHUTAN_UPI_LIMITS.perPayment)} a payment, ${money(BHUTAN_UPI_LIMITS.perDay)} a day`,
  wallet: 'Clients’ prepaid coins at your salon', other: 'Cheque, bank transfer, anything else',
};
const PAPERS: { value: ReceiptSize; label: string; hint: string }[] = [
  { value: '80', label: '80 mm', hint: 'Most counter receipt printers' },
  { value: '58', label: '58 mm', hint: 'Small and Bluetooth printers' },
  { value: 'a4', label: 'A4', hint: 'Full-page invoice on a normal printer' },
];

function PaymentsSection({ salon }: { salon: Salon }) {
  const [methods, setMethods] = useState<PayMethod[]>(salon.payment_methods?.length ? salon.payment_methods : DEFAULT_PAY_METHODS);
  const [vpa, setVpa] = useState(salon.upi_vpa ?? '');
  const [payee, setPayee] = useState(salon.upi_payee_name ?? salon.name);
  const [paper, setPaper] = useState<ReceiptSize>(salon.receipt_size ?? '80');
  const [policy, setPolicy] = useState(salon.advance_policy ?? '');
  const { pending, error, run } = useSave();
  const toggle = (m: PayMethod) => setMethods((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));
  const vpaClean = vpa.trim();
  const vpaOk = isValidVpa(vpaClean);
  const save = () => run(() => updatePayments({ methods, upiVpa: vpaClean || null, upiPayeeName: payee, receiptSize: paper, advancePolicy: policy }));

  return (
    <Section id="payments" title="Payments & receipts" description="How clients pay you, and what the bill printer prints."
      footer={<SaveBar pending={pending} error={error} onSave={save} />}>
      <div className="stack-lg">
        <fieldset className="check-group">
          <legend className="tiny muted strong">Payment types at the desk</legend>
          <div className="check-grid pay-type-grid">
            {ALL_PAY_METHODS.map((m) => (
              <label key={m} className="check pay-type">
                <input type="checkbox" checked={methods.includes(m)} onChange={() => toggle(m)} />
                <span><span className="strong">{METHOD_LABEL[m]}</span><span className="tiny muted pay-type-hint">{METHOD_HINT[m]}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="small ink2">
          <strong>Near the Bhutan border?</strong> Turn on Cash (Nu) and UPI (Bhutan) so they show up separately in your reports.
          Bills stay in rupees — don’t add a surcharge for Nu or Bhutanese UPI.{methods.includes('wallet') ? '' : ' Clients who already have coins can still pay with them.'}
        </p>

        <div className="pay-upi-setup">
          <div className="stack">
            <TextField label="Your UPI ID" value={vpa} placeholder="yoursalon@okicici" autoComplete="off" spellCheck={false}
              onChange={(e) => setVpa(e.target.value.replace(/\s/g, ''))}
              error={vpaClean && !vpaOk ? 'Looks like name@bank, for example glowstudio@okicici.' : undefined}
              hint="From your UPI or bank app. Bills with money due show a QR that pays this ID." />
            <TextField label="Name clients see when paying" value={payee} maxLength={50} onChange={(e) => setPayee(e.target.value)} />
            <p className="tiny muted">Money goes straight from the client’s app to your account — Styile never handles it. Mark the bill paid when you see the payment.</p>
          </div>
          {vpaOk && (
            <div className="pay-upi-preview">
              <UpiQr vpa={vpaClean} name={payee.trim() || salon.name} amount={1} note="Test from Styile" size={132} caption="none" />
              <span className="tiny muted">Test: scan with your phone. It should show your name and ₹1 — you don’t need to pay.</span>
            </div>
          )}
        </div>

        <div className="field pay-paper">
          <span className="label">Receipt printer</span>
          <Segmented label="Receipt size" value={paper} onChange={setPaper} options={PAPERS.map((x) => ({ value: x.value, label: x.label }))} />
          <span className="hint">{PAPERS.find((x) => x.value === paper)?.hint}. Used for “Print receipt” after saving a bill; you can pick another size on any bill.</span>
        </div>

        <TextArea label="Advance and cancellation policy (optional)" rows={2} maxLength={500} value={policy} onChange={(e) => setPolicy(e.target.value)}
          placeholder="e.g. Advances for bridal bookings are refundable up to 7 days before the event."
          hint="Printed on advance receipts for bridal and event bookings. Styile never keeps an advance automatically — refunds are recorded by the owner or a manager." />
      </div>
    </Section>
  );
}

interface PackDraft { key: number; pay: string; coins: string }
let packKey = 0;
const toDraft = (p: { pay: number; coins: number }): PackDraft => ({ key: ++packKey, pay: String(p.pay), coins: String(p.coins) });
const whole = (v: string) => (v.trim() === '' ? NaN : Number(v.replace(/[,\s₹]/g, '')));

function CoinsSection({ salon }: { salon: Salon }) {
  const [enabled, setEnabled] = useState(salon.coins_enabled ?? true);
  const [packs, setPacks] = useState<PackDraft[]>(() => (salon.coin_packs ?? DEFAULT_COIN_PACKS).map(toDraft));
  const { pending, error, run } = useSave();
  const set = (key: number, patch: Partial<PackDraft>) => setPacks((cur) => cur.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const add = () => setPacks((cur) => {
    const last = cur[cur.length - 1];
    const pay = last && Number.isFinite(whole(last.pay)) ? whole(last.pay) * 2 : 1000;
    return [...cur, { key: ++packKey, pay: String(pay), coins: String(Math.round(pay * 1.1)) }];
  });
  const save = () => run(async () => {
    const parsed = packs.map((p) => ({ pay: whole(p.pay), coins: whole(p.coins) }));
    const checked = checkCoinPacks(parsed);
    if (!checked.ok) return { ok: false, error: checked.error };
    return updateCoinSettings({ enabled, packs: checked.packs });
  });

  return (
    <Section id="coins" title="Coins" description="Clients prepay at your desk and pay for visits from their balance. 1 coin = ₹1."
      footer={<SaveBar pending={pending} error={error} onSave={save} />}>
      <div className="stack">
        <div className="setting-row">
          <div className="grow">
            <div className="strong">Sell coins at the desk</div>
            <div className="small muted">
              {enabled
                ? `Front desk sells coins for cash, UPI or card from a client’s profile. Coins can only be used at ${salon.name}, and they don’t expire.`
                : 'Off — no new coins can be sold. Clients can still use the coins they already have.'}
            </div>
          </div>
          <Switch checked={enabled} onChange={setEnabled} label={<span className="sr-only">Sell coins at the desk</span>} />
        </div>

        <div className="field">
          <span className="label">Coin packs</span>
          <span className="hint">Offer a bonus on bigger top-ups. Front desk can sell these packs, or any amount without a bonus; only owners and managers can give a custom bonus.</span>
          <div className="coin-pack-rows">
            {packs.map((p, i) => {
              const pay = whole(p.pay), coins = whole(p.coins);
              const ok = Number.isInteger(pay) && pay > 0 && Number.isInteger(coins);
              const bad = ok && (coins < pay || coins > pay * 2);
              const bonus = ok && !bad ? coins - pay : 0;
              return (
                <div key={p.key} className="coin-pack-row">
                  <div className="prefix-input coin-pack-pay-in">
                    <span><span className="hide-mobile">Pay&nbsp;</span>₹</span>
                    <input className="input num" inputMode="numeric" value={p.pay} aria-label={`Pack ${i + 1}: client pays (₹)`}
                      onChange={(e) => set(p.key, { pay: e.target.value.replace(/[^\d]/g, '') })} />
                  </div>
                  <Icon name="arrowRight" size={16} className="muted coin-pack-arrow" />
                  <div className="prefix-input coin-pack-coins">
                    <input className="input num" inputMode="numeric" value={p.coins} aria-label={`Pack ${i + 1}: coins added`} aria-invalid={bad || undefined}
                      onChange={(e) => set(p.key, { coins: e.target.value.replace(/[^\d]/g, '') })} />
                    <span>coins</span>
                  </div>
                  <span className={`small nowrap coin-pack-note ${bad ? 'danger-text' : bonus > 0 ? 'success-text' : 'muted'}`}>
                    {!ok ? '' : coins < pay ? `At least ${fmtCoins(pay)}` : coins > pay * 2 ? 'Bonus over 100%' : bonus > 0 ? `+${fmtCoins(bonus)} bonus · ${Math.round((bonus / pay) * 100)}%` : 'No bonus'}
                  </span>
                  <Button size="sm" variant="ghost" icon="trash" className="coin-pack-del" aria-label={`Remove pack ${i + 1}`} onClick={() => setPacks((cur) => cur.filter((x) => x.key !== p.key))} />
                </div>
              );
            })}
            {!packs.length && <p className="small muted">No packs — the desk sells any amount, 1 coin per rupee.</p>}
          </div>
          {packs.length < MAX_COIN_PACKS && <div><Button size="sm" icon="plus" onClick={add}>Add pack</Button></div>}
        </div>

        <Notice>
          Selling coins gives the client a <strong>coins receipt, not a tax invoice</strong> — it’s an advance. GST is charged on the bill when the coins are used to pay. Confirm the GST treatment with your CA.
        </Notice>
      </div>
    </Section>
  );
}

function HoursSection({ hours: initial }: { hours: Hours }) {
  const [hours, setHours] = useState<Hours>(initial);
  const { pending, error, run } = useSave();
  return (
    <Section id="hours" title="Opening hours" description="Online and WhatsApp bookings are only offered inside these hours. Stylists can have their own hours under Team."
      footer={<SaveBar pending={pending} error={error} onSave={() => run(() => updateBusinessHours(hours))} label="Save hours" />}>
      <HoursEditor value={hours} onChange={setHours} idPrefix="salon-hours" />
    </Section>
  );
}

function BookingSection({ salon }: { salon: Salon }) {
  const [enabled, setEnabled] = useState(salon.booking_enabled);
  const [slotInterval, setSlotInterval] = useState(String(salon.slot_interval_min));
  const [lead, setLead] = useState(String(salon.booking_lead_min));
  const [windowDays, setWindowDays] = useState(String(salon.booking_window_days));
  const [clientLang, setClientLang] = useState<string>(salon.default_locale ?? 'en');
  const [origin, setOrigin] = useState('');
  const { pending, error, run } = useSave();
  const toast = useToast();
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const url = rootDomain() ? salonUrl(salon.slug) : `${origin}/s/${salon.slug}`;
  const leads = [0, 15, 30, 60, 120, 180, 240, 720, 1440, 2880];
  const leadLabel = (m: number) => (m === 0 ? 'No notice' : m < 60 ? `${m} minutes` : m < 1440 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m / 1440} day${m === 1440 ? '' : 's'}`);
  const leadOptions = leads.includes(Number(lead)) ? leads : [...leads, Number(lead)].sort((a, b) => a - b);
  const windows = [7, 14, 30, 60, 90, 180];
  const windowOptions = windows.includes(Number(windowDays)) ? windows : [...windows, Number(windowDays)].sort((a, b) => a - b);

  return (
    <Section id="booking" title="Online booking" description="Clients pick a service, stylist and time on your booking page — no app or login needed."
      footer={<SaveBar pending={pending} error={error}
        onSave={() => run(() => updateOnlineBooking({ bookingEnabled: enabled, slotIntervalMin: Number(slotInterval), bookingLeadMin: Number(lead), bookingWindowDays: Number(windowDays), defaultLocale: clientLang }))} />}>
      <div className="stack">
        <div className="link-box">
          <Icon name="link" size={18} className="muted" />
          <code className="grow truncate">{url.replace(/^https?:\/\//, '')}</code>
          <Button size="sm" icon="copy" onClick={() => { navigator.clipboard?.writeText(url); toast('Booking link copied'); }}>Copy</Button>
          <a className="btn btn-sm btn-secondary" href={rootDomain() ? salonUrl(salon.slug) : `/s/${salon.slug}`} target="_blank" rel="noreferrer"><Icon name="external" size={16} />Open</a>
        </div>
        <p className="small muted">This is your salon’s own address. Add it to your Instagram bio and Google Business profile; clients also see their bookings and bills here. Ask the Styile team if you want a different address.</p>
        <div className="setting-row">
          <div className="grow">
            <div className="strong">Accept online bookings</div>
            <div className="small muted">When off, the booking page shows your phone number instead. The WhatsApp assistant still answers questions.</div>
          </div>
          <Switch checked={enabled} onChange={setEnabled} label={<span className="sr-only">Accept online bookings</span>} />
        </div>
        <div className="grid-3">
          <SelectField label="Time slots every" value={slotInterval} onChange={(e) => setSlotInterval(e.target.value)}>
            {[5, 10, 15, 20, 30, 60].map((x) => <option key={x} value={x}>{x} minutes</option>)}
          </SelectField>
          <SelectField label="Minimum notice" value={lead} onChange={(e) => setLead(e.target.value)} hint="How soon a client can book">
            {leadOptions.map((m) => <option key={m} value={m}>{leadLabel(m)}</option>)}
          </SelectField>
          <SelectField label="Book up to" value={windowDays} onChange={(e) => setWindowDays(e.target.value)} hint="How far ahead">
            {windowOptions.map((d) => <option key={d} value={d}>{d} days ahead</option>)}
          </SelectField>
        </div>
        <SelectField label="Language for clients" value={clientLang} onChange={(e) => setClientLang(e.target.value)}
          hint="Your booking page, clients’ bookings page, bills and receipts open in this language. Clients can switch it from the page. WhatsApp messages stay in English for now.">
          {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}{l !== 'en' ? ` (${({ hi: 'Hindi', ne: 'Nepali', bn: 'Bengali' } as Record<string, string>)[l]})` : ''}</option>)}
        </SelectField>
      </div>
    </Section>
  );
}

function WhatsAppSection({ salon, supportEmail }: { salon: Salon; supportEmail: string }) {
  const [enabled, setEnabled] = useState(salon.wa_bot_enabled);
  const [notes, setNotes] = useState(salon.wa_bot_instructions ?? '');
  const { pending, error, run } = useSave();
  const connected = !!salon.wa_phone_number_id;

  if (!connected) {
    return (
      <Section id="whatsapp" title="WhatsApp" description="Let clients book, reschedule and ask questions on WhatsApp — answered 24×7 by your assistant.">
        <div className="stack">
          <div className="row"><Badge>Not connected</Badge></div>
          <p className="ink2">The Styile team connects your salon’s number to the WhatsApp Business Platform for you. It usually takes 2–3 working days, mostly waiting for Meta to verify your business.</p>
          <div className="checklist">
            <h3>What you’ll need</h3>
            <ul>
              <li><Icon name="phone" size={17} /><span><strong>A phone number for the salon</strong> that isn’t currently on the WhatsApp or WhatsApp Business app. It can be a landline or a new SIM — it only needs to receive one call or SMS for verification.</span></li>
              <li><Icon name="shield" size={17} /><span><strong>Business documents</strong> for Meta’s verification: GST certificate, shop & establishment licence or Udyam registration, in the salon’s name.</span></li>
              <li><Icon name="store" size={17} /><span><strong>Your salon’s display name</strong> and a square logo — this is what clients see in WhatsApp.</span></li>
            </ul>
          </div>
          <div className="row-wrap">
            <a className="btn btn-primary" href={`mailto:${supportEmail}?subject=${encodeURIComponent(`Connect WhatsApp for ${salon.name}`)}`}><Icon name="whatsapp" size={18} />Ask us to connect WhatsApp</a>
          </div>
        </div>
      </Section>
    );
  }

  return (
    <Section id="whatsapp" title="WhatsApp" description="Your booking assistant replies to clients on your salon’s WhatsApp number."
      footer={<SaveBar pending={pending} error={error} onSave={() => run(() => updateAssistant({ botEnabled: enabled, instructions: notes }))} />}>
      <div className="stack">
        <div className="wa-connected">
          <span className="wa-icon"><Icon name="whatsapp" size={22} /></span>
          <div className="grow">
            <div className="row"><span className="strong num">{salon.wa_display_number || 'Connected number'}</span><Badge tone="success"><Icon name="check" size={13} />Connected</Badge></div>
            <div className="small muted">Booking confirmations, reminders and bills are sent from this number.</div>
          </div>
        </div>
        <div className="setting-row">
          <div className="grow">
            <div className="strong">Booking assistant</div>
            <div className="small muted">
              {enabled
                ? 'Replies instantly to new messages: shows prices and free times, books, reschedules and cancels. It hands the chat to your team when it isn’t sure.'
                : 'Off — every message waits in the WhatsApp inbox for your team. Confirmations and reminders still go out.'}
            </div>
          </div>
          <Switch checked={enabled} onChange={setEnabled} label={<span className="sr-only">Booking assistant</span>} />
        </div>
        <ul className="can-do">
          {['Answers price and timing questions from your menu', 'Books, moves and cancels appointments', 'Sends reminders the day before and 2 hours before', 'Flags chats that need a person in the inbox'].map((t) => (
            <li key={t}><Icon name="check" size={15} />{t}</li>
          ))}
        </ul>
        <TextArea label="Things the assistant should know" rows={5} maxLength={NOTES_MAX} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!enabled}
          placeholder={'e.g. Free parking behind the building.\nBridal trials need a ₹1,000 advance.\nWe don’t do hair extensions.'}
          hint={<span className="between"><span>Parking, advance payment rules, services you don’t offer, landmarks. Plain sentences are fine.</span><span className="num nowrap">{notes.length} / {NOTES_MAX}</span></span>} />
      </div>
    </Section>
  );
}

function SubscriptionSection({ salon, supportEmail }: { salon: Salon; supportEmail: string }) {
  const plan = planById(salon.plan);
  const tone = salon.plan_status === 'active' ? 'success' : salon.plan_status === 'trialing' ? 'peacock' : 'danger';
  const trialEnd = salon.trial_ends_at
    ? new Intl.DateTimeFormat('en-IN', { timeZone: salon.timezone, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(salon.trial_ends_at))
    : null;
  return (
    <Section id="subscription" title="Subscription">
      <div className="between" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="stack-sm">
          <div className="row"><span className="plan-name">{PLAN_LABEL[salon.plan]}</span><Badge tone={tone}>{PLAN_STATUS_LABEL[salon.plan_status]}</Badge></div>
          {plan && <div className="small ink2 num">{money(plan.priceMonthly)} a month + GST · {plan.summary}</div>}
          {salon.plan_status === 'trialing' && trialEnd && <div className="small ink2">Your free trial ends on <strong>{trialEnd}</strong>.</div>}
          {salon.plan_status === 'past_due' && <div className="small danger-text">Your last payment didn’t go through. Bookings keep working — please renew soon.</div>}
          {plan && <ul className="plan-features">{plan.features.slice(0, 4).map((x) => <li key={x}>{x}</li>)}</ul>}
        </div>
        <a className="btn btn-secondary" href={`mailto:${supportEmail}?subject=${encodeURIComponent(`Change plan for ${salon.name}`)}`}>Contact us to change plan</a>
      </div>
    </Section>
  );
}
