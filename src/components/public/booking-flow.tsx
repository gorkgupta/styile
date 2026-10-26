'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Button, Notice, TextField, cx } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { bookOnline, getPublicSlots, type BookOnlineResult } from '@/actions/public';
import { qualifiedStaff, type Slot } from '@/lib/availability';
import { money } from '@/lib/billing';
import { formatPhone, initials } from '@/lib/phone';
import { dayKeyOf, fmtDateLong, fmtDateShort, fmtHhmm } from '@/lib/time';
import type { Hours } from '@/lib/types';
import { usePhoneOtp } from './phone-otp';
import { bookableDays, DateStrip, SlotGrid } from './date-strip';

export interface PublicService { id: string; category_id: string | null; name: string; description: string | null; duration_min: number; price: number; gender: 'unisex' | 'female' | 'male' }
export interface PublicStaff { id: string; name: string; title: string | null; color: string }

export interface BookingPageProps {
  salon: { name: string; slug: string; address: string | null; city: string | null; phone: string | null; timezone: string; brandColor: string; bookingWindowDays: number };
  hours: Hours;
  categories: { id: string; name: string }[];
  services: PublicService[];
  staff: PublicStaff[];
  /** staff id -> service ids they are limited to (missing/empty = can do everything) */
  skills: Record<string, string[]>;
  today: string;
  /** Present when the visitor is already signed in with a verified phone. */
  me: { phone: string; name: string } | null;
}

type Step = 1 | 2 | 3 | 4 | 5;
const STEP_TITLES: Record<Exclude<Step, 5>, string> = { 1: 'Choose services', 2: 'Choose a stylist', 3: 'Pick a time', 4: 'Your details' };

export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

function hoursLabel(hours: Hours, date: string): string {
  const w = hours[dayKeyOf(date)];
  if (!w || !w.length) return 'Closed today';
  return `Open today ${w.map(([a, b]) => `${fmtHhmm(a)} – ${fmtHhmm(b)}`).join(', ')}`;
}

/** Readable text colour on the salon's brand colour. */
function onColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62 ? '#1f1a2b' : '#fff';
}

function icsStamp(iso: string) { return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
function icsEscape(s: string) { return s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n'); }

function downloadIcs(opts: { id: string; start: string; end: string; title: string; location: string; description: string }) {
  const body = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Styile//Booking//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${opts.id}@styile`, `DTSTAMP:${icsStamp(new Date().toISOString())}`, `DTSTART:${icsStamp(opts.start)}`, `DTEND:${icsStamp(opts.end)}`,
    `SUMMARY:${icsEscape(opts.title)}`, `LOCATION:${icsEscape(opts.location)}`, `DESCRIPTION:${icsEscape(opts.description)}`,
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(opts.title)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([body], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'salon-appointment.ics';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function BookingFlow(p: BookingPageProps) {
  const [step, setStep] = useState<Step>(1);
  const [picked, setPicked] = useState<string[]>([]);
  const [cat, setCat] = useState<string>(() => p.categories.find((c) => p.services.some((s) => s.category_id === c.id))?.id ?? 'other');
  const [staffId, setStaffId] = useState<string | null>(null);
  const [date, setDate] = useState<string>(p.today);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [timeNotice, setTimeNotice] = useState<string | null>(null);
  const [name, setName] = useState(p.me?.name ?? '');
  const [notes, setNotes] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const [result, setResult] = useState<BookOnlineResult | null>(null);
  const otp = usePhoneOtp();
  const [verified, setVerified] = useState(false); // OTP accepted this session; a retry must not re-verify a used code
  const req = useRef(0);
  const topRef = useRef<HTMLDivElement>(null);

  const chosen = useMemo(() => picked.map((id) => p.services.find((s) => s.id === id)).filter((s): s is PublicService => !!s), [picked, p.services]);
  const total = chosen.reduce((s, x) => s + Number(x.price), 0);
  const minutes = chosen.reduce((s, x) => s + x.duration_min, 0);

  const skillMap = useMemo(() => new Map<string, Set<string>>(Object.entries(p.skills).map(([k, v]) => [k, new Set(v)])), [p.skills]);
  const eligible = useMemo(
    () => qualifiedStaff(p.staff.map((s) => ({ ...s, bookable: true, active: true })), skillMap, picked),
    [p.staff, skillMap, picked],
  );
  const stylist = p.staff.find((s) => s.id === staffId) ?? null;

  const days = useMemo(() => bookableDays(p.today, p.salon.bookingWindowDays, p.hours), [p.today, p.salon.bookingWindowDays, p.hours]);

  const tabs = useMemo(() => {
    const list = p.categories.filter((c) => p.services.some((s) => s.category_id === c.id));
    if (p.services.some((s) => !s.category_id || !p.categories.some((c) => c.id === s.category_id))) list.push({ id: 'other', name: 'Other' });
    return list;
  }, [p.categories, p.services]);
  const visible = p.services.filter((s) => (cat === 'other' ? !s.category_id || !p.categories.some((c) => c.id === s.category_id) : s.category_id === cat));
  const countIn = (catId: string) => picked.filter((id) => {
    const s = p.services.find((x) => x.id === id);
    return catId === 'other' ? !s?.category_id : s?.category_id === catId;
  }).length;

  // A stylist who can't do the new combination of services is no longer a valid choice.
  useEffect(() => { if (staffId && !eligible.some((s) => s.id === staffId)) setStaffId(null); }, [eligible, staffId]);

  // Load times whenever the time step is showing and its inputs change.
  useEffect(() => {
    if (step !== 3 || !picked.length) return;
    const id = ++req.current;
    setSlots(null); setSlotsError(null);
    getPublicSlots(p.salon.slug, picked, date, staffId).then((r) => {
      if (id !== req.current) return;
      if (r.ok) setSlots(r.data ?? []);
      else { setSlots([]); setSlotsError(r.error); }
    });
  }, [step, date, staffId, picked, p.salon.slug]);

  // The chosen slot only stays valid for the same date, stylist and services.
  useEffect(() => { setSlot(null); }, [date, staffId, picked]);

  function go(next: Step) {
    setStep(next);
    setBookError(null);
    if (next === 3) {
      const firstOpen = days.find((d) => d.date >= date && d.open) ?? days.find((d) => d.open);
      if (firstOpen && !days.find((d) => d.date === date)?.open) setDate(firstOpen.date);
    }
    requestAnimationFrame(() => topRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }

  function toggle(id: string) {
    setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  }

  async function confirm() {
    if (!slot) { go(3); return; }
    if (name.trim().length < 2) { setNameError('Enter your name so the salon knows who is coming.'); return; }
    setNameError(null);
    if (!p.me && !verified) {
      if (otp.stage === 'phone') { await otp.send(); return; }
      const ok = await otp.verify();
      if (!ok) return;
      setVerified(true);
    }
    setBooking(true); setBookError(null);
    const r = await bookOnline({ slug: p.salon.slug, serviceIds: picked, staffId, start: slot.start, name: name.trim(), notes: notes.trim() || undefined });
    setBooking(false);
    if (r.ok && r.data) { setResult(r.data); go(5); return; }
    const error = r.ok ? 'Something went wrong. Please try again.' : r.error;
    if (/taken|not available/i.test(error)) {
      setTimeNotice('Sorry, someone just booked that time. Please pick another one.');
      setSlot(null);
      go(3); // returning to the time step reloads free times
      return;
    }
    setBookError(error);
  }

  const whenLabel = slot ? `${fmtDateShort(date)}, ${fmtHhmm(slot.time)}` : null;
  const addr = [p.salon.address, p.salon.city].filter(Boolean).join(', ');

  // ---------- Sticky action bar ----------
  let barSummary: ReactNode = null;
  let barAction: ReactNode = null;
  if (step === 1) {
    barSummary = picked.length
      ? <><span className="strong num">{money(total)}</span><span className="muted"> · {picked.length} service{picked.length > 1 ? 's' : ''} · {fmtDuration(minutes)}</span></>
      : <span className="muted">Pick one or more services</span>;
    barAction = <Button variant="primary" size="lg" disabled={!picked.length} onClick={() => go(2)}>Continue</Button>;
  } else if (step === 2) {
    barSummary = <><span className="strong">{stylist ? stylist.name : 'Any stylist'}</span><span className="muted"> · {money(total)}</span></>;
    barAction = <Button variant="primary" size="lg" onClick={() => go(3)}>Continue</Button>;
  } else if (step === 3) {
    barSummary = slot ? <span className="strong">{whenLabel}</span> : <span className="muted">Pick a time</span>;
    barAction = <Button variant="primary" size="lg" disabled={!slot} onClick={() => go(4)}>Continue</Button>;
  } else if (step === 4) {
    barSummary = <><span className="strong">{whenLabel}</span><span className="muted"> · {money(total)}</span></>;
    const signedIn = !!p.me || verified;
    const label = signedIn || otp.stage === 'code' ? 'Confirm booking' : 'Send code on WhatsApp';
    barAction = (
      <Button variant="primary" size="lg" loading={otp.busy || booking} onClick={confirm} icon={!signedIn && otp.stage === 'phone' ? 'whatsapp' : undefined}
        disabled={!signedIn && (otp.stage === 'phone' ? !otp.valid : otp.code.length !== 6)}>{label}</Button>
    );
  }

  return (
    <div className="bk" style={{ ['--brand' as string]: p.salon.brandColor, ['--on-brand' as string]: onColor(p.salon.brandColor) }}>
      <header className="bk-head">
        <div className="bk-wrap">
          <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
            <span className="bk-mark" aria-hidden>{initials(p.salon.name)}</span>
            <div className="grow">
              <h1>{p.salon.name}</h1>
              {addr && <p className="bk-head-line">{addr}</p>}
              <p className="bk-head-line"><Icon name="clock" size={14} />{hoursLabel(p.hours, p.today)}</p>
            </div>
            {p.salon.phone && (
              <a className="bk-call" href={`tel:+${p.salon.phone}`} aria-label={`Call ${p.salon.name}`}><Icon name="phone" size={18} /></a>
            )}
          </div>
        </div>
      </header>

      <main className="bk-wrap bk-main" ref={topRef}>
        {step < 5 && (
          <div className="bk-stepper">
            {step > 1 ? (
              <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Back" onClick={() => go((step - 1) as Step)}><Icon name="chevronLeft" /></button>
            ) : <span style={{ width: 4 }} />}
            <div className="grow">
              <div className="tiny muted">Step {step} of 4</div>
              <h2>{STEP_TITLES[step as Exclude<Step, 5>]}</h2>
            </div>
            <div className="bk-dots" aria-hidden>{[1, 2, 3, 4].map((i) => <span key={i} className={cx(i <= step && 'on')} />)}</div>
          </div>
        )}

        {step === 1 && (
          <section className="stack">
            {tabs.length > 1 && (
              <div className="bk-tabs" role="tablist" aria-label="Service categories">
                {tabs.map((c) => (
                  <button key={c.id} type="button" role="tab" aria-selected={cat === c.id} className="chip" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>
                    {c.name}{countIn(c.id) > 0 && <span className="bk-count">{countIn(c.id)}</span>}
                  </button>
                ))}
              </div>
            )}
            <ul className="bk-services">
              {visible.map((s) => {
                const on = picked.includes(s.id);
                return (
                  <li key={s.id}>
                    <button type="button" className={cx('bk-service', on && 'is-on')} aria-pressed={on} onClick={() => toggle(s.id)}>
                      <div className="grow">
                        <div className="strong">{s.name}</div>
                        <div className="small muted">
                          {fmtDuration(s.duration_min)}{s.gender !== 'unisex' && <> · {s.gender === 'female' ? 'Women' : 'Men'}</>}
                        </div>
                        {s.description && <div className="small ink2" style={{ marginTop: 2 }}>{s.description}</div>}
                      </div>
                      <span className="num strong">{money(s.price)}</span>
                      <span className="bk-check" aria-hidden>{on ? <Icon name="check" size={16} strokeWidth={2.4} /> : <Icon name="plus" size={16} />}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {!p.services.length && <Notice>This salon hasn’t put any services online yet. Please call them to book.</Notice>}
          </section>
        )}

        {step === 2 && (
          <section className="stack">
            <ul className="bk-staff">
              <li>
                <button type="button" className={cx('bk-option', staffId === null && 'is-on')} aria-pressed={staffId === null} onClick={() => setStaffId(null)}>
                  <span className="bk-any" aria-hidden><Icon name="users" size={18} /></span>
                  <div className="grow"><div className="strong">Any available stylist</div><div className="small muted">Shows the most times</div></div>
                  <span className="bk-radio" aria-hidden />
                </button>
              </li>
              {eligible.map((s) => (
                <li key={s.id}>
                  <button type="button" className={cx('bk-option', staffId === s.id && 'is-on')} aria-pressed={staffId === s.id} onClick={() => setStaffId(s.id)}>
                    <span className="avatar" style={{ background: s.color }} aria-hidden>{initials(s.name)}</span>
                    <div className="grow"><div className="strong">{s.name}</div>{s.title && <div className="small muted">{s.title}</div>}</div>
                    <span className="bk-radio" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
            {eligible.length < p.staff.length && <p className="small muted">Only stylists who do all of your chosen services are shown.</p>}
          </section>
        )}

        {step === 3 && (
          <section className="stack">
            {timeNotice && <Notice tone="warn">{timeNotice}</Notice>}
            <DateStrip today={p.today} windowDays={p.salon.bookingWindowDays} hours={p.hours} value={date} onChange={(d) => { setDate(d); setTimeNotice(null); }} />
            <div className="between">
              <h3>{fmtDateLong(date)}</h3>
              {stylist && <span className="small muted row" style={{ gap: 6 }}><span className="dot" style={{ background: stylist.color }} />{stylist.name}</span>}
            </div>
            {slots === null ? (
              <div className="bk-slots-loading" aria-live="polite"><span className="spinner" aria-hidden /> Finding free times…</div>
            ) : slotsError ? (
              <Notice tone="error">{slotsError}</Notice>
            ) : slots.length === 0 ? (
              <div className="bk-empty">
                <p className="strong">No free times on this day</p>
                <p className="small muted">{stylist ? `${stylist.name} is fully booked. Try another day or any stylist.` : 'Try another day.'}</p>
                <div className="row-wrap" style={{ justifyContent: 'center' }}>
                  {(() => {
                    const next = days.find((d) => d.date > date && d.open);
                    return next ? <Button size="sm" onClick={() => setDate(next.date)}>Try {fmtDateShort(next.date)}</Button> : null;
                  })()}
                  {stylist && <Button size="sm" variant="ghost" onClick={() => setStaffId(null)}>Any stylist</Button>}
                </div>
              </div>
            ) : (
              <SlotGrid slots={slots} value={slot?.start ?? null} onChange={(x) => { setSlot(x); setTimeNotice(null); }} />
            )}
          </section>
        )}

        {step === 4 && slot && (
          <section className="stack-lg">
            <Summary services={chosen} total={total} when={whenLabel!} stylist={stylist?.name ?? 'the first free stylist'} minutes={minutes} />
            <div className="stack">
              <TextField label="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" error={nameError} placeholder="As the salon should call you" />
              {p.me || verified ? (
                <div className="bk-verified"><Icon name="check" size={16} />Booking with {formatPhone(p.me?.phone ?? otp.digits)}</div>
              ) : otp.stage === 'phone' ? (
                <div className="field">
                  <label htmlFor="bk-phone">Mobile number</label>
                  <div className="prefix-input">
                    <span>+91</span>
                    <input id="bk-phone" className="input" inputMode="numeric" autoComplete="tel-national" placeholder="98765 43210" maxLength={14}
                      value={otp.phoneInput} onChange={(e) => otp.setPhoneInput(e.target.value)} aria-invalid={!!otp.error || undefined}
                      onKeyDown={(e) => { if (e.key === 'Enter') confirm(); }} />
                  </div>
                  {otp.error ? <span className="error-text" role="alert">{otp.error}</span> : <span className="hint">We’ll send a 6-digit code on WhatsApp to confirm it’s you.</span>}
                </div>
              ) : (
                <div className="field">
                  <label htmlFor="bk-code">Code sent to {formatPhone(otp.digits)}</label>
                  <input id="bk-code" className="input bk-code num" inputMode="numeric" autoComplete="one-time-code" placeholder="••••••" maxLength={6}
                    value={otp.code} onChange={(e) => otp.setCode(e.target.value)} autoFocus aria-invalid={!!otp.error || undefined}
                    onKeyDown={(e) => { if (e.key === 'Enter') confirm(); }} />
                  {otp.error ? <span className="error-text" role="alert">{otp.error}</span> : <span className="hint">Check WhatsApp for a message from Styile.</span>}
                  <div className="row-wrap" style={{ gap: 4 }}>
                    <Button size="sm" variant="ghost" onClick={otp.changeNumber}>Change number</Button>
                    <Button size="sm" variant="ghost" disabled={otp.resendIn > 0} onClick={() => otp.send()}>
                      {otp.resendIn > 0 ? `Resend in ${otp.resendIn}s` : 'Resend code'}
                    </Button>
                  </div>
                </div>
              )}
              <TextField label="Anything the salon should know? (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="E.g. first time colouring" />
              {bookError && <Notice tone="error">{bookError}</Notice>}
              <p className="tiny muted">You pay at the salon after your visit. You can change or cancel this booking from WhatsApp or your bookings page.</p>
            </div>
          </section>
        )}

        {step === 5 && result && (
          <section className="bk-done">
            <div className="bk-done-icon"><Icon name="check" size={28} strokeWidth={2.4} /></div>
            <h2>You’re booked</h2>
            <p className="muted">We’ve sent the details to you on WhatsApp.</p>
            <Summary services={chosen} total={total} when={result.when} stylist={result.stylist} minutes={minutes} payAtSalon />
            <div className="stack-sm" style={{ width: '100%' }}>
              <Button block size="lg" icon="calendar" onClick={() => downloadIcs({
                id: result.appointmentId, start: result.start, end: result.end,
                title: `${chosen.map((s) => s.name).join(', ')} at ${p.salon.name}`,
                location: [p.salon.name, addr].filter(Boolean).join(', '),
                description: `With ${result.stylist}. Pay at the salon. To change or cancel, reply on WhatsApp or visit your bookings.`,
              })}>Add to calendar</Button>
              <Link href="/me" className="btn btn-ghost btn-block">See all my bookings</Link>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setPicked([]); setSlot(null); setResult(null); setStaffId(null); go(1); }}>Book something else</Button>
          </section>
        )}
      </main>

      {step < 5 && (
        <div className="bk-bar">
          <div className="bk-wrap bk-bar-inner">
            <div className="grow bk-bar-summary small">{barSummary}</div>
            {barAction}
          </div>
        </div>
      )}
      <footer className="bk-wrap bk-foot tiny muted">
        Online booking by <Link href="/">Styile</Link> · <Link href="/me">My bookings</Link>
      </footer>
    </div>
  );
}

function Summary({ services, total, when, stylist, minutes, payAtSalon }: { services: PublicService[]; total: number; when: string; stylist: string; minutes: number; payAtSalon?: boolean }) {
  return (
    <div className="bk-summary">
      <div className="bk-summary-when">
        <Icon name="calendar" size={18} />
        <div><div className="strong">{when}</div><div className="small muted">with {stylist} · {fmtDuration(minutes)}</div></div>
      </div>
      <ul>
        {services.map((s) => <li key={s.id} className="between"><span>{s.name}</span><span className="num">{money(s.price)}</span></li>)}
      </ul>
      <div className="between bk-summary-total">
        <span className="strong">Total</span>
        <span className="strong num">{money(total)}{payAtSalon && <span className="small muted" style={{ fontWeight: 500 }}> · pay at salon</span>}</span>
      </div>
    </div>
  );
}

