'use client';
import { useActionState, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Notice, SelectField, SubmitButton, TextField } from '@/components/ui/ui';
import { Icon, type IconName } from '@/components/ui/icons';
import { PhoneInput } from '@/components/ui/phone-input';
import { createSalon, signIn, signUp } from '@/actions/auth';
import type { ActionResult } from '@/lib/types';
import { TRIAL_DAYS } from '@/lib/plans';
import { isReservedSlug, rootDomain } from '@/lib/tenant';
import { DEFAULT_STATE, INDIAN_STATES, type GstMode } from '@/lib/gst';

const GST_OPTIONS: { mode: GstMode; title: string; body: string }[] = [
  { mode: 'unregistered', title: 'Not registered', body: 'No GSTIN. Bills show no GST — most parlours under ₹20 lakh a year.' },
  { mode: 'composition', title: 'Composition scheme', body: 'You pay 6% yourself. Bills say “Bill of Supply”, no GST to clients.' },
  { mode: 'regular', title: 'Regular GST', body: 'Tax invoices with 5% GST on services, CGST + SGST.' },
];

/** Calm split layout for staff sign-in screens: form on the left, a short reassurance panel on the right (hidden on phones). */
export function AuthLayout({ children, aside }: { children: ReactNode; aside: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-main">
        <Link href="/" className="mk-logo auth-logo" aria-label="Styile home"><span className="brand-mark">S</span>Styile</Link>
        <div className="auth-form">{children}</div>
        <p className="tiny muted auth-foot">Need help? WhatsApp us at +91 80 4710 2200.</p>
      </div>
      <aside className="auth-aside">{aside}</aside>
    </div>
  );
}

function AsidePoints({ title, points }: { title: string; points: { icon: IconName; text: ReactNode }[] }) {
  return (
    <div className="auth-aside-inner">
      <h2>{title}</h2>
      <ul>
        {points.map((p, i) => (
          <li key={i}><span className="auth-aside-icon"><Icon name={p.icon} size={18} /></span><span>{p.text}</span></li>
        ))}
      </ul>
    </div>
  );
}

function FormError({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  if (!state.ok) return <Notice tone="error">{state.error}</Notice>;
  return state.message ? <Notice tone="success">{state.message}</Notice> : null;
}

export function LoginForm({ next, notice, salonName }: { next?: string; notice?: string; salonName?: string }) {
  const [state, action] = useActionState(signIn, null);
  return (
    <AuthLayout aside={
      <AsidePoints title="Your salon, ready for the day" points={[
        { icon: 'calendar', text: 'Bookings from WhatsApp, your booking page and the front desk in one calendar.' },
        { icon: 'walkin', text: 'Walk-ins get a token and wait in a live queue.' },
        { icon: 'receipt', text: 'GST bills sent to clients on WhatsApp.' },
      ]} />
    }>
      <div className="stack-sm">
        <h1>Log in to your salon</h1>
        <p className="muted">{salonName ? <>Staff login for <span className="strong ink2">{salonName}</span>. Clients, <Link href="/me/login">see your bookings here</Link>.</> : 'For salon owners and staff.'}</p>
      </div>
      {notice && <Notice>{notice}</Notice>}
      <form action={action} className="stack">
        <input type="hidden" name="next" value={next ?? ''} />
        <TextField label="Email" name="email" type="email" autoComplete="email" required autoFocus />
        <TextField label={<span className="between">Password<Link href="/reset" className="small" style={{ fontWeight: 500 }}>Forgot password?</Link></span>}
          name="password" type="password" autoComplete="current-password" required />
        <FormError state={state} />
        <SubmitButton size="lg" block pendingText="Logging in…">Log in</SubmitButton>
      </form>
      <p className="small muted">New to Styile? <Link href="/signup">Start a free trial</Link></p>
    </AuthLayout>
  );
}

export function SignupForm() {
  const [state, action] = useActionState(signUp, null);
  const sent = state?.ok && !!state.message;
  return (
    <AuthLayout aside={
      <AsidePoints title={`${TRIAL_DAYS} days free, everything switched on`} points={[
        { icon: 'sparkle', text: 'Start with a sample service menu and change it as you go.' },
        { icon: 'whatsapp', text: 'We help you connect your salon’s WhatsApp number.' },
        { icon: 'shield', text: 'No card needed. Your salon’s data stays yours, and only your team sees it.' },
      ]} />
    }>
      <div className="stack-sm">
        <h1>Start your free trial</h1>
        <p className="muted">Create your login first. You’ll add your salon’s details on the next screen.</p>
      </div>
      {sent ? (
        <div className="stack">
          <Notice tone="success">{state.message}</Notice>
          <p className="small muted">Didn’t get it? Check spam, or <Link href="/signup">try again</Link> with a different email.</p>
        </div>
      ) : (
        <form action={action} className="stack">
          <TextField label="Your name" name="name" autoComplete="name" required autoFocus />
          <TextField label="Email" name="email" type="email" autoComplete="email" required />
          <TextField label="Password" name="password" type="password" autoComplete="new-password" minLength={8} required hint="At least 8 characters." />
          <FormError state={state} />
          <SubmitButton size="lg" block pendingText="Creating account…">Create account</SubmitButton>
          <p className="tiny muted">By continuing you agree to the Styile terms of service and privacy policy.</p>
        </form>
      )}
      <p className="small muted">Already using Styile? <Link href="/login">Log in</Link></p>
    </AuthLayout>
  );
}

export function slugify(name: string): string {
  return name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
}

export function OnboardingForm({ ownerName, appHost }: { ownerName: string; appHost: string }) {
  const [state, action] = useActionState(createSalon, null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [host, setHost] = useState(appHost);
  useEffect(() => { if (!appHost && typeof window !== 'undefined') setHost(window.location.host); }, [appHost]);
  const [gstMode, setGstMode] = useState<GstMode>('unregistered');
  const shownSlug = slugEdited ? slug : slugify(name);
  const root = rootDomain();

  return (
    <AuthLayout aside={
      <AsidePoints title="What happens next" points={[
        { icon: 'scissors', text: 'Your dashboard opens with your salon’s calendar. Add or edit services any time.' },
        { icon: 'users', text: 'Add your stylists so clients can choose who they book with.' },
        { icon: 'link', text: 'Your salon gets its own address for Instagram and Google, and clients see their bookings there.' },
      ]} />
    }>
      <div className="stack-sm">
        <h1>Tell us about your salon</h1>
        <p className="muted">You can change all of this later in Settings.</p>
      </div>
      <form action={action} className="stack">
        <TextField label="Salon name" name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Glow Studio" required autoFocus />
        <div className="field">
          <label htmlFor="ob-slug">Your salon’s address</label>
          {root ? (
            <div className="prefix-input suffix-input">
              <input id="ob-slug" className="input" name="slug" value={shownSlug} required pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]"
                onChange={(e) => { setSlugEdited(true); setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); }} placeholder="glowstudio" />
              <span>.{root}</span>
            </div>
          ) : (
            <div className="prefix-input">
              <span><span className="hide-mobile">{host || 'styile.com'}</span>/s/</span>
              <input id="ob-slug" className="input" name="slug" value={shownSlug} required pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]"
                onChange={(e) => { setSlugEdited(true); setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); }} placeholder="glowstudio" />
            </div>
          )}
          <span className="hint">
            {shownSlug && isReservedSlug(shownSlug) ? <span style={{ color: 'var(--danger)' }}>“{shownSlug}” is reserved. Try another.</span>
              : <>Clients book and see their bookings at <span className="strong ink2">{root ? `${shownSlug || 'yoursalon'}.${root}` : `${host || 'styile.com'}/s/${shownSlug || 'yoursalon'}`}</span>. Letters, numbers and dashes.</>}
          </span>
        </div>
        <div className="grid-2">
          <PhoneInput id="ob-phone" name="phone" label="Salon mobile number" />
          <TextField label="City" name="city" placeholder="Jaigaon" autoComplete="address-level2" />
        </div>
        <SelectField label="State" name="state" defaultValue={DEFAULT_STATE}>
          {INDIAN_STATES.map((s) => <option key={s.code} value={s.name}>{s.name}</option>)}
        </SelectField>
        <fieldset className="choice-cards is-stacked">
          <legend className="label">Are you GST registered?</legend>
          {GST_OPTIONS.map((o) => (
            <label key={o.mode} className={`choice-card${gstMode === o.mode ? ' is-on' : ''}`}>
              <input type="radio" name="gst_mode" value={o.mode} checked={gstMode === o.mode} onChange={() => setGstMode(o.mode)} />
              <span className="choice-body"><span className="strong">{o.title}</span><span className="small ink2">{o.body}</span></span>
            </label>
          ))}
        </fieldset>
        {gstMode !== 'unregistered' && (
          <TextField label="GSTIN" name="gstin" required maxLength={15} placeholder="19ABCDE1234F1Z5" className="mono-upper" autoComplete="off"
            hint="15 characters, from your GST certificate. Printed on every bill." />
        )}
        <p className="tiny muted">Not sure? Choose “Not registered” and check with your CA — you can change it in Settings.</p>
        <TextField label="Your name" name="owner_name" defaultValue={ownerName} hint="Shown on the calendar as the first stylist. You can rename it later." />
        <label className="check onb-seed">
          <input type="checkbox" name="seed" value="on" defaultChecked />
          <span>
            <span className="strong">Start with a sample service menu</span>
            <span className="small muted" style={{ display: 'block' }}>Haircut, colour, facial, manicure and more with typical prices. Edit or delete them any time.</span>
          </span>
        </label>
        {/* An unchecked box sends nothing, so this sends seed=off. FormData.get() returns the first value, so a checked box (above) wins. */}
        <input type="hidden" name="seed" value="off" />
        <FormError state={state} />
        <SubmitButton size="lg" block pendingText="Setting up your salon…">Create salon</SubmitButton>
      </form>
    </AuthLayout>
  );
}
