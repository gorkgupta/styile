'use client';
import { rootDomain, salonUrl } from '@/lib/tenant';
import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Notice, Panel, SelectField, Switch, TextArea, TextField, useToast } from '@/components/ui/ui';
import { Icon, type IconName } from '@/components/ui/icons';
import { Topbar } from './shell';
import { HoursEditor } from './hours-editor';
import { updateAssistant, updateBilling, updateBusinessHours, updateCoinSettings, updateOnlineBooking, updateSalonProfile } from '@/actions/settings';
import { formatPhone } from '@/lib/phone';
import { PhoneInput } from '@/components/ui/phone-input';
import { PLAN_LABEL, PLAN_STATUS_LABEL, planById } from '@/lib/plans';
import { money } from '@/lib/billing';
import { checkCoinPacks, DEFAULT_COIN_PACKS, fmtCoins, MAX_COIN_PACKS } from '@/lib/coins';
import type { ActionResult, Hours, Salon } from '@/lib/types';

export interface SettingsProps {
  salon: Salon;
  hours: Hours;
  /** Where support requests go, e.g. "support@styile.com". */
  supportEmail: string;
}

const NOTES_MAX = 1500;
const STATES = ['Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand',
  'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha',
  'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];

const SECTIONS: { id: string; label: string; icon: IconName }[] = [
  { id: 'profile', label: 'Salon profile', icon: 'store' },
  { id: 'billing', label: 'Billing & GST', icon: 'receipt' },
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
    name: salon.name, legalName: salon.legal_name ?? '', gstin: salon.gstin ?? '', phone: salon.phone ? formatPhone(salon.phone) : '',
    email: salon.email ?? '', address: salon.address ?? '', city: salon.city ?? '', state: salon.state ?? '', pincode: salon.pincode ?? '',
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
          <TextField label="GSTIN" value={f.gstin} placeholder="29ABCDE1234F1Z5" maxLength={15} className="mono-upper"
            onChange={(e) => setF((x) => ({ ...x, gstin: e.target.value.toUpperCase().replace(/\s/g, '') }))}
            hint="Leave blank if you aren’t GST registered — bills will say “Bill of supply”." />
          <div className="grid-2 tight">
            <PhoneInput label="Phone" value={f.phone} onChange={(v) => setF((x) => ({ ...x, phone: v }))} />
            <TextField label="Email" type="email" value={f.email} onChange={set('email')} />
          </div>
        </div>
        <TextField label="Address" value={f.address} onChange={set('address')} placeholder="Shop no., building, street, area" maxLength={240} />
        <div className="grid-3">
          <TextField label="City" value={f.city} onChange={set('city')} />
          <SelectField label="State" value={f.state} onChange={set('state')}>
            <option value="">Choose…</option>
            {!STATES.includes(f.state) && f.state && <option value={f.state}>{f.state}</option>}
            {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </SelectField>
          <TextField label="PIN code" inputMode="numeric" maxLength={6} value={f.pincode} onChange={set('pincode')} />
        </div>
      </div>
    </Section>
  );
}

function BillingSection({ salon }: { salon: Salon }) {
  const [inclusive, setInclusive] = useState(salon.prices_include_tax);
  const [rate, setRate] = useState(String(Number(salon.default_gst_rate)));
  const [prefix, setPrefix] = useState(salon.invoice_prefix);
  const { pending, error, run } = useSave();
  const example = 1000;
  const r = Number(rate);
  const exampleText = inclusive
    ? `A ${money(example)} service is billed at ${money(example)} (${money(Math.round((example * 100) / (100 + r) * 100) / 100)} + GST).`
    : `A ${money(example)} service is billed at ${money(example + (example * r) / 100)} including ${r}% GST.`;
  return (
    <Section id="billing" title="Billing & GST" description="How prices and tax appear on your bills."
      footer={<SaveBar pending={pending} error={error} onSave={() => run(() => updateBilling({ pricesIncludeTax: inclusive, defaultGstRate: Number(rate), invoicePrefix: prefix }))} />}>
      <div className="stack">
        <div className="setting-row">
          <div className="grow">
            <div className="strong">Menu prices include GST</div>
            <div className="small muted">{exampleText}</div>
          </div>
          <Switch checked={inclusive} onChange={setInclusive} label={<span className="sr-only">Menu prices include GST</span>} />
        </div>
        <div className="grid-2">
          <SelectField label="Default GST rate" value={rate} onChange={(e) => setRate(e.target.value)} hint="Salon services are usually 18%. You can override it per service.">
            {[0, 5, 12, 18, 28].map((x) => <option key={x} value={x}>{x}%</option>)}
          </SelectField>
          <TextField label="Bill number prefix" value={prefix} maxLength={6} className="mono-upper"
            onChange={(e) => setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            hint={<>Next bill: <span className="num strong ink2">{(prefix || 'INV')}-{String(salon.next_invoice_no).padStart(5, '0')}</span></>} />
        </div>
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
        onSave={() => run(() => updateOnlineBooking({ bookingEnabled: enabled, slotIntervalMin: Number(slotInterval), bookingLeadMin: Number(lead), bookingWindowDays: Number(windowDays) }))} />}>
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
