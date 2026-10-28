'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { mainUrl } from '@/lib/tenant';
import { Avatar, Button, Notice, TextField, cx } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { bookOnline, getPublicSlots, getStylistNextFree, type BookOnlineResult } from '@/actions/public';
import { qualifiedStaff, type Slot } from '@/lib/availability';
import { experienceLabel, fmtNextFree, type NextFree, type NextFreeResult, type PublicStylist } from '@/lib/stylists';
import { money } from '@/lib/billing';
import { formatPhone, initials } from '@/lib/phone';
import { dayKeyOf, fmtDateLong, fmtDateShort, fmtHhmm } from '@/lib/time';
import type { Hours } from '@/lib/types';
import { usePhoneOtp } from './phone-otp';
import { PhoneInput } from '@/components/ui/phone-input';
import { bookableDays, DateStrip, SlotGrid } from './date-strip';

export interface PublicService { id: string; category_id: string | null; name: string; description: string | null; duration_min: number; price: number; gender: 'unisex' | 'female' | 'male' }
export type PublicStaff = PublicStylist;

export interface BookingPageProps {
  salon: { name: string; slug: string; address: string | null; city: string | null; phone: string | null; timezone: string; brandColor: string; bookingWindowDays: number };
  hours: Hours;
  categories: { id: string; name: string }[];
  services: PublicService[];
  /** Stylists clients can choose (public profile fields only). */
  staff: PublicStylist[];
  /** staff id -> service ids they are limited to (missing/empty = can do everything) */
  skills: Record<string, string[]>;
  /** Signed-in returning client's usual stylist: offered first and pre-selected. */
  usualStylistId?: string | null;
  /** From a "book again" link (?stylist=&services=), already validated on the server. */
  initial?: { serviceIds: string[]; staffId: string | null; step?: 1 | 2 | 3 };
  today: string;
  /** Present when the visitor is already signed in with a verified phone. */
  me: { phone: string; name: string } | null;
  /** Link prefix of this salon's site: "" on its own subdomain, "/s/<slug>" otherwise. */
  base: string;
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
  const [step, setStep] = useState<Step>(p.initial?.step ?? 1);
  const [picked, setPicked] = useState<string[]>(p.initial?.serviceIds ?? []);
  const [cat, setCat] = useState<string>(() => {
    const first = p.services.find((s) => s.id === p.initial?.serviceIds[0])?.category_id;
    if (first && p.categories.some((c) => c.id === first)) return first;
    return p.categories.find((c) => p.services.some((s) => s.category_id === c.id))?.id ?? 'other';
  });
  // What the client chose (or a link / their usual stylist pre-chose). It only applies while that stylist does
  // every chosen service: otherwise the booking falls back to anyone available.
  const [staffChoice, setStaffChoice] = useState<string | null>(p.initial?.staffId ?? p.usualStylistId ?? null);
  const [nextFree, setNextFree] = useState<NextFreeResult | 'loading' | 'error'>('loading');
  const [date, setDate] = useState<string>(p.today);
  const dateTouched = useRef(false);
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
  const nfReq = useRef(0);
  const topRef = useRef<HTMLDivElement>(null);

  const chosen = useMemo(() => picked.map((id) => p.services.find((s) => s.id === id)).filter((s): s is PublicService => !!s), [picked, p.services]);
  const total = chosen.reduce((s, x) => s + Number(x.price), 0);
  const minutes = chosen.reduce((s, x) => s + x.duration_min, 0);

  const skillMap = useMemo(() => new Map<string, Set<string>>(Object.entries(p.skills).map(([k, v]) => [k, new Set(v)])), [p.skills]);
  const eligible = useMemo(
    () => qualifiedStaff(p.staff.map((s) => ({ ...s, bookable: true, active: true })), skillMap, picked),
    [p.staff, skillMap, picked],
  );
  const staffId = staffChoice && eligible.some((s) => s.id === staffChoice) ? staffChoice : null;
  const linkStylist = p.initial?.staffId ? p.staff.find((s) => s.id === p.initial?.staffId) ?? null : null;
  const doesService = (staff: string, service: string) => !p.skills[staff]?.length || p.skills[staff].includes(service);
  const stylist = p.staff.find((s) => s.id === staffId) ?? null;
  const usual = p.usualStylistId ? p.staff.find((s) => s.id === p.usualStylistId) ?? null : null;
  // Usual stylist first, then the salon's own order.
  const offered = useMemo(() => [...eligible].sort((a, b) => Number(b.id === p.usualStylistId) - Number(a.id === p.usualStylistId)), [eligible, p.usualStylistId]);
  const nextFor = (id: string | null): NextFree | null | undefined =>
    typeof nextFree === 'string' ? undefined : id ? nextFree.byStaff[id] ?? null : nextFree.any;

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

  // "Next free" times for the stylist step (kept for the time step, to open on the first day with times).
  const pickedKey = picked.join(',');
  const wantNextFree = step >= 2 && step <= 4 && picked.length > 0;
  useEffect(() => {
    if (!wantNextFree) return;
    const id = ++nfReq.current;
    setNextFree('loading');
    getStylistNextFree(p.salon.slug, pickedKey.split(',')).then((r) => {
      if (id !== nfReq.current) return;
      setNextFree(r.ok && r.data ? r.data : 'error');
    });
  }, [wantNextFree, pickedKey, p.salon.slug]);

  // Open the time step on the first day the chosen stylist (or anyone) is free, unless the client picked a date.
  const firstFree = step === 3 ? nextFor(staffId) : undefined;
  useEffect(() => {
    if (firstFree && !dateTouched.current && firstFree.date > date) setDate(firstFree.date);
  }, [firstFree, date]);

  // Load times whenever the time step is showing and its inputs change.
  useEffect(() => {
    if (step !== 3 || !picked.length) return;
    const id = ++req.current;
    setSlots(null); setSlotsError(null);
    getPublicSlots(p.salon.slug, pickedKey.split(','), date, staffId).then((r) => {
      if (id !== req.current) return;
      if (r.ok) setSlots(r.data ?? []);
      else { setSlots([]); setSlotsError(r.error); }
    });
  }, [step, date, staffId, pickedKey, p.salon.slug]);

  // The chosen slot only stays valid for the same date, stylist and services.
  useEffect(() => { setSlot(null); }, [date, staffId, pickedKey]);

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
    barSummary = <><span className="strong">{stylist ? stylist.name : 'Anyone available'}</span><span className="muted"> · {money(total)}</span></>;
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
            {linkStylist && staffChoice === linkStylist.id && (
              <div className="bk-with">
                <Avatar name={linkStylist.name} color={linkStylist.color} photo={linkStylist.photoUrl} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="strong truncate">Booking with {linkStylist.name}</div>
                  <div className="small muted truncate">{linkStylist.title ?? 'Pick the services you’d like'}</div>
                </div>
                <button type="button" className="link-btn small" onClick={() => setStaffChoice(null)}>Change</button>
              </div>
            )}
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
                        {linkStylist && staffChoice === linkStylist.id && !doesService(linkStylist.id, s.id) && (
                          <div className="tiny muted" style={{ marginTop: 2 }}>Not with {linkStylist.name.split(' ')[0]}</div>
                        )}
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
            <ul className="bk-stylists" aria-label="Stylists">
              <li>
                <div className={cx('bk-stylist', staffId === null && 'is-on')}>
                  <button type="button" className="bk-stylist-pick" aria-pressed={staffId === null} onClick={() => setStaffChoice(null)}>
                    <span className="bk-photo-wrap" aria-hidden>
                      <span className="bk-any-icon"><Icon name="sparkle" size={24} /></span>
                      <span className="bk-pick-check"><Icon name="check" size={13} strokeWidth={3} /></span>
                    </span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="bk-stylist-name">Anyone available</div>
                      <div className="small muted">Earliest time with any stylist</div>
                      <NextFreeLine value={nextFor(null)} today={p.today} />
                    </div>
                  </button>
                </div>
              </li>
              {offered.map((s) => (
                <li key={s.id}>
                  <StylistCard s={s} on={staffId === s.id} usual={usual?.id === s.id} next={nextFor(s.id)} today={p.today} onPick={() => setStaffChoice(s.id)} />
                </li>
              ))}
            </ul>
            {eligible.length < p.staff.length && (
              <p className="small muted">
                Showing stylists who do {chosen.length === 1 ? chosen[0].name.toLowerCase() : 'all your chosen services'}.
              </p>
            )}
          </section>
        )}

        {step === 3 && (
          <section className="stack">
            {timeNotice && <Notice tone="warn">{timeNotice}</Notice>}
            <DateStrip today={p.today} windowDays={p.salon.bookingWindowDays} hours={p.hours} value={date} onChange={(d) => { dateTouched.current = true; setDate(d); setTimeNotice(null); }} />
            <div className="between">
              <h3>{fmtDateLong(date)}</h3>
              {stylist && <span className="bk-with-chip small"><Avatar name={stylist.name} color={stylist.color} photo={stylist.photoUrl} size="sm" />{stylist.name}</span>}
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
                    return next ? <Button size="sm" onClick={() => { dateTouched.current = true; setDate(next.date); }}>Try {fmtDateShort(next.date)}</Button> : null;
                  })()}
                  {stylist && <Button size="sm" variant="ghost" onClick={() => setStaffChoice(null)}>Anyone available</Button>}
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
                <PhoneInput id="bk-phone" label="Mobile number" value={otp.phoneInput} onChange={otp.setPhoneInput} error={otp.error}
                  hint="We’ll send a 6-digit code on WhatsApp to confirm it’s you." onKeyDown={(e) => { if (e.key === 'Enter') confirm(); }} />
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
              <Link href={`${p.base}/me`} className="btn btn-ghost btn-block">See all my bookings</Link>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setPicked([]); setSlot(null); setResult(null); setStaffChoice(p.usualStylistId ?? null); go(1); }}>Book something else</Button>
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
        Online booking by <a href={mainUrl('/') || '/'}>Styile</a> · <Link href={`${p.base}/me`}>My bookings</Link>
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

/** "Next free: Today 4:30 PM" under a stylist; a shimmer while it loads, nothing if it couldn't be checked. */
function NextFreeLine({ value, today }: { value: NextFree | null | undefined; today: string }) {
  if (value === undefined) return <span className="bk-next is-loading" aria-hidden />;
  if (value === null) return <div className="bk-next is-none">No free time in the next 7 days</div>;
  return <div className="bk-next"><Icon name="clock" size={14} />Next free: {fmtNextFree(value, today)}</div>;
}

function StylistCard({ s, on, usual, next, today, onPick }: {
  s: PublicStylist; on: boolean; usual: boolean; next: NextFree | null | undefined; today: string; onPick: () => void;
}) {
  const [open, setOpen] = useState(false);
  const first = s.name.split(' ')[0];
  const meta = [s.title, experienceLabel(s.yearsExperience)].filter(Boolean).join(' · ');
  const longBio = !!s.bio && s.bio.length > 90;
  return (
    <div className={cx('bk-stylist', on && 'is-on')}>
      <button type="button" className="bk-stylist-pick" aria-pressed={on} onClick={onPick}>
        <span className="bk-photo-wrap">
          <Avatar name={s.name} color={s.color} photo={s.photoUrl} className="bk-stylist-photo" />
          <span className="bk-pick-check" aria-hidden><Icon name="check" size={13} strokeWidth={3} /></span>
        </span>
        <div className="grow" style={{ minWidth: 0 }}>
          {usual && <span className="bk-usual"><Icon name="star" size={12} strokeWidth={2.2} />Your usual stylist</span>}
          <div className="bk-stylist-name">{s.name}</div>
          {meta && <div className="small muted">{meta}</div>}
          <NextFreeLine value={next} today={today} />
        </div>
      </button>
      {(s.specialties.length > 0 || s.bio) && (
        <div className="bk-stylist-more">
          {s.specialties.length > 0 && (
            <ul className="bk-tags" aria-label={`${first}’s specialties`}>{s.specialties.map((t) => <li key={t}>{t}</li>)}</ul>
          )}
          {s.bio && <p className={cx('bk-bio', (open || !longBio) && 'is-open')}>{s.bio}</p>}
          {longBio && (
            <button type="button" className="link-btn small bk-bio-toggle" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
              {open ? 'Show less' : `More about ${first}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
