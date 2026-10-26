'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Button, Dialog, Empty, Notice, Sheet, TextArea, useToast } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { cancelMyBooking, getMySlots, rescheduleMyBooking } from '@/actions/portal';
import type { Slot } from '@/lib/availability';
import { money } from '@/lib/billing';
import { formatPhone } from '@/lib/phone';
import { dayKeyOf, fmtDateLong, fmtDateShort, fmtTime, localDate, relativeDay } from '@/lib/time';
import type { ApptStatus, Hours, InvoiceStatus } from '@/lib/types';
import { STATUS_LABEL } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';
import { DateStrip, SlotGrid } from '@/components/public/date-strip';

export interface PortalSalon {
  id: string; name: string; slug: string; city: string | null; phone: string | null;
  timezone: string; hours: Hours | null; bookingWindowDays: number; bookingEnabled: boolean;
}
export interface PortalVisit {
  id: string; salonId: string; start_at: string; end_at: string; status: ApptStatus;
  stylist: { name: string; color: string } | null;
  services: { name: string; price: number }[];
  invoiceId: string | null;
}
export interface PortalBill { id: string; salonId: string; invoice_no: string; created_at: string; total: number; status: InvoiceStatus }

export interface PortalProps {
  me: { name: string; phone: string };
  nowIso: string;
  salons: PortalSalon[];
  upcoming: PortalVisit[];
  past: PortalVisit[];
  bills: PortalBill[];
}

/** Simple top bar shared by the client portal pages. */
export function PortalHeader({ phone, children }: { phone?: string; children?: ReactNode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <header className="pt-head">
      <div className="pt-wrap between">
        <Link href="/me" className="mk-logo" style={{ fontSize: 17 }}><span className="brand-mark" style={{ width: 28, height: 28, fontSize: 15 }}>S</span>My bookings</Link>
        <div className="row">
          {children}
          {phone && <span className="small muted hide-mobile">{formatPhone(phone)}</span>}
          {phone && (
            <Button size="sm" variant="ghost" icon="logout" loading={busy} onClick={async () => {
              setBusy(true);
              await createClient().auth.signOut();
              router.replace('/me/login');
              router.refresh();
            }}>Sign out</Button>
          )}
        </div>
      </div>
    </header>
  );
}

const INVOICE_LABEL: Record<InvoiceStatus, string> = { paid: 'Paid', partial: 'Part paid', unpaid: 'Unpaid', void: 'Cancelled' };

export function PortalHome(p: PortalProps) {
  const salonById = new Map<string, PortalSalon>(p.salons.map((s) => [s.id, s]));
  const [cancelling, setCancelling] = useState<PortalVisit | null>(null);
  const [moving, setMoving] = useState<PortalVisit | null>(null);
  const first = p.me.name.split(' ')[0];

  return (
    <div className="pt">
      <PortalHeader phone={p.me.phone} />
      <main className="pt-wrap pt-main">
        <div className="stack-sm">
          <h1>{first ? `Hi ${first}` : 'Your bookings'}</h1>
          <p className="muted">Your appointments and bills{p.salons.length === 1 ? ` at ${p.salons[0].name}` : p.salons.length ? ' across salons' : ''}.</p>
        </div>

        {!p.salons.length ? (
          <div className="panel">
            <Empty icon="calendar" title="No bookings for this number yet">
              When you book at a salon that uses Styile with {formatPhone(p.me.phone)}, your appointments and bills show up here.
            </Empty>
          </div>
        ) : (
          <>
            <section className="stack">
              <h2>Upcoming</h2>
              {p.upcoming.length ? p.upcoming.map((v) => {
                const salon = salonById.get(v.salonId);
                if (!salon) return null;
                const tz = salon.timezone;
                const date = localDate(new Date(v.start_at), tz);
                const today = localDate(new Date(p.nowIso), tz);
                return (
                  <article key={v.id} className="pt-card">
                    <div className="pt-when">
                      <div className="pt-day">{relativeDay(date, today)}</div>
                      <div className="pt-time num">{fmtTime(v.start_at, tz)}</div>
                    </div>
                    <div className="grow stack-sm" style={{ gap: 4 }}>
                      <div className="strong">{v.services.map((s) => s.name).join(', ')}</div>
                      <div className="small muted">
                        {fmtDateLong(date)} · {fmtTime(v.start_at, tz)} – {fmtTime(v.end_at, tz)}
                      </div>
                      <div className="small row" style={{ gap: 6 }}>
                        {v.stylist && <><span className="dot" style={{ background: v.stylist.color }} />{v.stylist.name} ·</>}
                        <span className="ink2">{salon.name}</span>
                        {v.status === 'confirmed' && <Badge tone="peacock">Confirmed</Badge>}
                      </div>
                      <div className="row-wrap pt-actions">
                        <Button size="sm" icon="clock" onClick={() => setMoving(v)}>Change time</Button>
                        <Button size="sm" variant="ghost" onClick={() => setCancelling(v)}>Cancel</Button>
                        {salon.phone && <a className="btn btn-ghost btn-sm" href={`https://wa.me/${salon.phone}`} target="_blank" rel="noreferrer"><Icon name="whatsapp" size={16} />Message salon</a>}
                      </div>
                    </div>
                  </article>
                );
              }) : (
                <div className="pt-empty">
                  <p className="muted">No upcoming appointments.</p>
                  {p.salons.filter((s) => s.bookingEnabled).slice(0, 1).map((s) => <Link key={s.id} className="btn btn-primary btn-sm" href={`/s/${s.slug}`}>Book at {s.name}</Link>)}
                </div>
              )}
            </section>

            <section className="stack">
              <h2>Past visits</h2>
              {p.past.length ? (
                <ul className="list panel">
                  {p.past.map((v) => {
                    const salon = salonById.get(v.salonId);
                    if (!salon) return null;
                    const date = localDate(new Date(v.start_at), salon.timezone);
                    const muted = v.status === 'cancelled' || v.status === 'no_show';
                    return (
                      <li key={v.id} className="row" style={{ gap: 14 }}>
                        <div className="pt-date-chip num"><span>{fmtDateShort(date).split(' ')[1]}</span><span>{fmtDateShort(date).split(' ')[2]}</span></div>
                        <div className="grow" style={{ minWidth: 0 }}>
                          <div className={muted ? 'truncate muted' : 'truncate strong'} style={muted ? { textDecoration: 'line-through' } : undefined}>{v.services.map((s) => s.name).join(', ')}</div>
                          <div className="small muted truncate">{salon.name}{v.stylist ? ` · ${v.stylist.name}` : ''}</div>
                        </div>
                        {muted ? <Badge tone="danger">{STATUS_LABEL[v.status]}</Badge>
                          : v.invoiceId ? <Link className="btn btn-ghost btn-sm" href={`/me/bills/${v.invoiceId}`}>Bill</Link>
                          : salon.bookingEnabled ? <Link className="btn btn-ghost btn-sm" href={`/s/${salon.slug}`}>Book again</Link> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="muted small">Your visits will appear here after your first appointment.</p>}
            </section>

            <section className="stack">
              <h2>Bills</h2>
              {p.bills.length ? (
                <ul className="list panel">
                  {p.bills.map((b) => {
                    const salon = salonById.get(b.salonId);
                    return (
                      <li key={b.id} style={{ padding: 0 }}>
                        <Link href={`/me/bills/${b.id}`} className="row pt-bill-row">
                          <span className="pt-bill-icon"><Icon name="receipt" size={18} /></span>
                          <div className="grow" style={{ minWidth: 0 }}>
                            <div className="strong truncate">{salon?.name ?? 'Salon'}</div>
                            <div className="small muted">{b.invoice_no} · {salon ? fmtDateShort(localDate(new Date(b.created_at), salon.timezone)) : ''}</div>
                          </div>
                          <div className="right">
                            <div className="num strong">{money(b.total)}</div>
                            <div className="tiny muted">{INVOICE_LABEL[b.status]}</div>
                          </div>
                          <Icon name="chevronRight" size={16} className="muted" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="muted small">Bills from your visits will appear here.</p>}
            </section>

            <section className="stack">
              <h2>Your salons</h2>
              <div className="pt-salons">
                {p.salons.map((s) => (
                  <div key={s.id} className="pt-salon">
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="strong truncate">{s.name}</div>
                      <div className="small muted truncate">{[s.city, s.phone ? formatPhone(s.phone) : null].filter(Boolean).join(' · ')}</div>
                    </div>
                    {s.bookingEnabled && <Link className="btn btn-secondary btn-sm" href={`/s/${s.slug}`}>Book again</Link>}
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </main>

      <CancelDialog visit={cancelling} onClose={() => setCancelling(null)} />
      <RescheduleSheet visit={moving} salon={moving ? salonById.get(moving.salonId) ?? null : null} nowIso={p.nowIso} onClose={() => setMoving(null)} />
    </div>
  );
}

function CancelDialog({ visit, onClose }: { visit: PortalVisit | null; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const router = useRouter();
  useEffect(() => { if (visit) { setReason(''); setError(null); } }, [visit]);
  return (
    <Dialog open={!!visit} onClose={onClose} title="Cancel this booking?"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Keep booking</Button>
        <Button variant="danger" loading={busy} onClick={async () => {
          if (!visit) return;
          setBusy(true); setError(null);
          const r = await cancelMyBooking(visit.id, reason);
          setBusy(false);
          if (!r.ok) { setError(r.error); return; }
          toast('Booking cancelled');
          onClose();
          router.refresh();
        }}>Cancel booking</Button>
      </>}>
      <p className="muted">The salon will be told straight away and the time will be freed for someone else.</p>
      <TextArea label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} rows={2} placeholder="E.g. travelling that day" />
      {error && <Notice tone="error">{error}</Notice>}
    </Dialog>
  );
}

function RescheduleSheet({ visit, salon, nowIso, onClose }: { visit: PortalVisit | null; salon: PortalSalon | null; nowIso: string; onClose: () => void }) {
  const today = salon ? localDate(new Date(nowIso), salon.timezone) : '';
  const [date, setDate] = useState(today);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const req = useRef(0);
  const toast = useToast();
  const router = useRouter();

  useEffect(() => {
    if (!visit || !salon) return;
    const current = localDate(new Date(visit.start_at), salon.timezone);
    setDate(current); setSlot(null); setError(null);
  }, [visit, salon]);

  useEffect(() => {
    if (!visit || !date) return;
    const id = ++req.current;
    setSlots(null); setSlot(null);
    getMySlots(visit.id, date).then((r) => {
      if (id !== req.current) return;
      if (r.ok) { setSlots(r.data ?? []); setError(null); } else { setSlots([]); setError(r.error); }
    });
  }, [visit, date]);

  if (!visit || !salon) return null;
  const closed = salon.hours ? !salon.hours[dayKeyOf(date)]?.length : false;
  return (
    <Sheet open={!!visit} onClose={onClose} title="Change time" width={520}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Keep current time</Button>
        <Button variant="primary" disabled={!slot} loading={busy} onClick={async () => {
          if (!slot) return;
          setBusy(true); setError(null);
          const r = await rescheduleMyBooking(visit.id, slot.start);
          setBusy(false);
          if (!r.ok) {
            setError(r.error);
            if (/taken|not available/i.test(r.error)) { const d = date; setDate(''); setTimeout(() => setDate(d), 0); }
            return;
          }
          toast(`Moved to ${r.data?.when ?? 'the new time'}`);
          onClose();
          router.refresh();
        }}>Move booking</Button>
      </>}>
      <div className="stack">
        <div className="pt-current small">
          <span className="muted">Now booked:</span> <span className="strong">{fmtDateShort(localDate(new Date(visit.start_at), salon.timezone))}, {fmtTime(visit.start_at, salon.timezone)}</span>
          <span className="muted"> · {visit.services.map((s) => s.name).join(', ')}</span>
        </div>
        <DateStrip today={today} windowDays={salon.bookingWindowDays} hours={salon.hours} value={date} onChange={setDate} />
        <h3>{date ? fmtDateLong(date) : ''}</h3>
        {error && <Notice tone="error">{error}</Notice>}
        {slots === null ? (
          <div className="bk-slots-loading"><span className="spinner" aria-hidden /> Finding free times…</div>
        ) : slots.length ? (
          <SlotGrid slots={slots} value={slot?.start ?? null} onChange={setSlot} />
        ) : !error ? (
          <p className="muted small">{closed ? 'The salon is closed on this day.' : 'No free times on this day. Try another date.'}</p>
        ) : null}
        <p className="tiny muted">We’ll keep you with {visit.stylist?.name ?? 'the same stylist'} when they’re free; otherwise another stylist who does your services.</p>
      </div>
    </Sheet>
  );
}
