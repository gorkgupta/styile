'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Avatar, Badge, Button, Dialog, Empty, Notice, Sheet, TextArea, useToast } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { cancelMyBooking, getMySlots, rescheduleMyBooking } from '@/actions/portal';
import type { Slot } from '@/lib/availability';
import { money } from '@/lib/billing';
import { formatPhone } from '@/lib/phone';
import { bookAgainHref } from '@/lib/stylists';
import { dateParts, dayKeyOf, fmtDateLong, fmtDateShort, fmtDateTime, fmtTime, localDate } from '@/lib/time';
import type { ApptStatus, Hours, InvoiceStatus } from '@/lib/types';
import { rich, useT } from '@/lib/i18n/react';
import { relDay } from '@/lib/i18n/core';
import { coinsT, countdownT, dayTextT, perksT } from '@/lib/i18n/format';
import { LanguageSwitch } from '@/components/ui/lang-switch';
import { createClient } from '@/lib/supabase/client';
import { DateStrip, SlotGrid } from '@/components/public/date-strip';
import { CoinHistoryList, type CoinRow } from '@/components/app/coin-history';
import { fmtCoins } from '@/lib/coins';
import { PackageCard } from '@/components/app/client-packages';
import { daysLeft } from '@/lib/packages';
import type { AdvancePayment, ClientMembership, ClientPackage, SalonEvent } from '@/lib/types';
import { eventMoney } from '@/lib/events';

export interface PortalSalon {
  id: string; name: string; slug: string; city: string | null; phone: string | null;
  timezone: string; hours: Hours | null; bookingWindowDays: number; bookingEnabled: boolean;
}
export interface PortalVisit {
  id: string; salonId: string; start_at: string; end_at: string; status: ApptStatus;
  /** Public fields only. bookable = still offered online, so "Book again with …" can link to them. */
  stylist: { id: string; name: string; color: string; photoUrl: string | null; bookable: boolean } | null;
  services: { name: string; price: number }[];
  /** Menu ids of the services (for "Book again"); services removed from the menu are left out. */
  serviceIds: string[];
  invoiceId: string | null;
}
export interface PortalBill { id: string; salonId: string; invoice_no: string; created_at: string; total: number; status: InvoiceStatus }

export interface PortalProps {
  me: { name: string; phone: string };
  nowIso: string;
  /** Link prefix of this salon's site: "" on its own subdomain, "/s/<slug>" otherwise. */
  base: string;
  /** The salon whose site this is. Clients only ever see their bookings with this salon here. */
  salon: PortalSalon;
  /** Whether this number has any client record at the salon yet. */
  known: boolean;
  upcoming: PortalVisit[];
  past: PortalVisit[];
  bills: PortalBill[];
  /** The client's coins at this salon (spendable only here). */
  coins?: { balance: number; history: CoinRow[] };
  /** Packages with sessions left, and the membership card (current, or a renewal that starts later). */
  packages?: ClientPackage[];
  membership?: ClientMembership | null;
  /** The salon's local date. */
  today?: string;
  /** Upcoming bridal / group events, with the advances paid. */
  events?: { event: SalonEvent; advances: AdvancePayment[] }[];
}

/** Simple top bar shared by the client portal pages. */
export function PortalHeader({ phone, children, base = '', salonName }: { phone?: string; children?: ReactNode; base?: string; salonName?: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <header className="pt-head">
      <div className="pt-wrap between">
        <Link href={`${base}/me`} className="mk-logo" style={{ fontSize: 17 }}><span className="brand-mark" style={{ width: 28, height: 28, fontSize: 15 }}>{(salonName ?? 'S').trim()[0]?.toUpperCase()}</span>{salonName ?? t('bk.myBookings')}</Link>
        <div className="row pt-head-tools">
          {children}
          <LanguageSwitch compact className="pt-lang" />
          {phone && <span className="small muted hide-mobile">{formatPhone(phone)}</span>}
          {phone && (
            <Button size="sm" variant="ghost" icon="logout" loading={busy} aria-label={t('pt.signOut')} title={t('pt.signOut')} onClick={async () => {
              setBusy(true);
              await createClient().auth.signOut();
              router.replace(`${base}/me/login`);
              router.refresh();
            }}><span className="hide-mobile">{t('pt.signOut')}</span></Button>
          )}
        </div>
      </div>
    </header>
  );
}

export function PortalHome(p: PortalProps) {
  const t = useT();
  const salonById = new Map<string, PortalSalon>([[p.salon.id, p.salon]]);
  const bookHref = p.base || '/';
  const [cancelling, setCancelling] = useState<PortalVisit | null>(null);
  const [moving, setMoving] = useState<PortalVisit | null>(null);
  const first = p.me.name.split(' ')[0];

  return (
    <div className="pt">
      <PortalHeader phone={p.me.phone} base={p.base} salonName={p.salon.name} />
      <main className="pt-wrap pt-main">
        <div className="stack-sm">
          <h1>{first ? t('pt.hi', { name: first }) : t('pt.yourBookings')}</h1>
          <p className="muted">{t('pt.intro', { salon: p.salon.name })}</p>
        </div>

        {p.known && p.coins && (p.coins.balance > 0 || p.coins.history.length > 0) && (
          <section className="pt-coins" aria-label={t('pt.coinsAria')}>
            <span className="pt-coins-icon" aria-hidden><Icon name="coins" size={24} /></span>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="pt-coins-title">{rich(t('pt.coinsHave', { salon: p.salon.name }), { coins: <span className="num">{coinsT(t, p.coins.balance)}</span> })}</div>
              <div className="small pt-coins-sub">
                {p.coins.balance > 0
                  ? rich(t('pt.coinsWorth'), { money: <span className="num">{money(p.coins.balance)}</span> })
                  : t('pt.coinsTopUp')}
              </div>
            </div>
          </section>
        )}

        {p.known && !!p.events?.length && (
          <section className="stack" aria-label={t('pt.events')}>
            <h2>{t('pt.events')}</h2>
            {p.events.map(({ event: e, advances }) => {
              const m = eventMoney(e, advances);
              const d = localDate(new Date(e.event_at), p.salon.timezone);
              return (
                <article key={e.id} className="pt-card pt-event">
                  <div className="pt-when">
                    <div className="pt-day">{p.today ? countdownT(t, d, p.today) : fmtDateShort(d, t.locale)}</div>
                    <div className="pt-time num">{fmtTime(e.event_at, p.salon.timezone)}</div>
                  </div>
                  <div className="grow stack-sm" style={{ gap: 4, minWidth: 0 }}>
                    <div className="strong">{e.title} <Badge tone="plum">{t(`event.${e.event_type}`)}</Badge></div>
                    <div className="small muted">{fmtDateLong(d, t.locale)} · {t('pt.readyBy', { time: fmtTime(e.event_at, p.salon.timezone) })} · {e.location === 'home' ? t('pt.homeVisit') : t('pt.atSalon', { salon: p.salon.name })}</div>
                    <div className="small">
                      {m.received ? rich(t('pt.advancePaid'), { money: <span className="num strong">{money(m.received - m.refunded)}</span> }) : t('pt.noAdvance')}
                      {m.quoted ? <> · {rich(t('pt.balanceOnDay'), { money: <span className="num strong">{money(m.balanceDue)}</span> })}</> : ''}
                    </div>
                    {advances.length > 0 && (
                      <div className="row-wrap">
                        {advances.map((a) => <Link key={a.id} href={`${p.base}/me/receipts/${a.id}`} className="pt-again small"><Icon name="receipt" size={14} />{t('common.receiptNo', { no: a.receipt_no })}</Link>)}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        )}

        {p.known && p.membership && (
          <section className="pt-member" aria-label={t('pt.membership')}>
            <span className="pt-member-icon" aria-hidden><Icon name="idcard" size={22} /></span>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="strong">{t('pt.member', { name: p.membership.name })}</div>
              <div className="small muted">
                {t('pt.onEveryBill', { perks: perksT(t, p.membership) })} ·{' '}
                {p.today && p.membership.starts_on > p.today ? t('pt.starts', { day: dayTextT(t, p.membership.starts_on, p.today) }) : t('pt.validTill', { day: dayTextT(t, p.membership.ends_on, p.today) })}
                {p.today && p.membership.starts_on <= p.today && daysLeft(p.membership.ends_on, p.today) <= 30 ? ` · ${t('pt.renew')}` : ''}
              </div>
            </div>
          </section>
        )}

        {p.known && !!p.packages?.length && (
          <section className="stack" aria-label={t('pt.packages')}>
            <h2>{t('pt.packages')}</h2>
            <div className="panel pt-pk">
              <ul className="list">
                {p.packages.map((x) => <li key={x.id}><PackageCard pkg={x} today={p.today ?? x.expires_on} tz={p.salon.timezone} compact /></li>)}
              </ul>
            </div>
            <p className="tiny muted">{t('pt.packagesNote', { salon: p.salon.name })}</p>
          </section>
        )}

        {!p.known ? (
          <div className="panel">
            <Empty icon="calendar" title={t('pt.noneYet', { salon: p.salon.name })}
              action={p.salon.bookingEnabled ? <Link className="btn btn-primary" href={bookHref}>{t('pt.book')}</Link> : undefined}>
              {t('pt.noneYetBody', { phone: formatPhone(p.me.phone) })}
            </Empty>
          </div>
        ) : (
          <>
            <section className="stack">
              <h2>{t('pt.upcoming')}</h2>
              {p.upcoming.length ? p.upcoming.map((v) => {
                const salon = salonById.get(v.salonId);
                if (!salon) return null;
                const tz = salon.timezone;
                const date = localDate(new Date(v.start_at), tz);
                const today = localDate(new Date(p.nowIso), tz);
                return (
                  <article key={v.id} className="pt-card">
                    <div className="pt-when">
                      <div className="pt-day">{relDay(t, date, today)}</div>
                      <div className="pt-time num">{fmtTime(v.start_at, tz)}</div>
                    </div>
                    <div className="grow stack-sm" style={{ gap: 4 }}>
                      <div className="strong">{v.services.map((s) => s.name).join(', ')}</div>
                      <div className="small muted">
                        {fmtDateLong(date, t.locale)} · {fmtTime(v.start_at, tz)} – {fmtTime(v.end_at, tz)}
                      </div>
                      <div className="small row" style={{ gap: 6 }}>
                        {v.stylist ? <><Avatar name={v.stylist.name} color={v.stylist.color} photo={v.stylist.photoUrl} size="sm" /><span className="ink2">{t('bk.withStylist', { name: v.stylist.name })}</span></> : <span className="ink2">{salon.name}</span>}
                        {v.status === 'confirmed' && <Badge tone="peacock">{t('status.confirmed')}</Badge>}
                      </div>
                      <div className="row-wrap pt-actions">
                        <Button size="sm" icon="clock" onClick={() => setMoving(v)}>{t('pt.changeTime')}</Button>
                        <Button size="sm" variant="ghost" onClick={() => setCancelling(v)}>{t('common.cancel')}</Button>
                        {salon.phone && <a className="btn btn-ghost btn-sm" href={`https://wa.me/${salon.phone}`} target="_blank" rel="noreferrer"><Icon name="whatsapp" size={16} />{t('pt.messageSalon')}</a>}
                      </div>
                    </div>
                  </article>
                );
              }) : (
                <div className="pt-empty">
                  <p className="muted">{t('pt.noUpcoming')}</p>
                  {p.salon.bookingEnabled && <Link className="btn btn-primary btn-sm" href={bookHref}>{t('pt.book')}</Link>}
                </div>
              )}
            </section>

            <section className="stack">
              <h2>{t('pt.past')}</h2>
              {p.past.length ? (
                <ul className="list panel">
                  {p.past.map((v) => {
                    const salon = salonById.get(v.salonId);
                    if (!salon) return null;
                    const date = localDate(new Date(v.start_at), salon.timezone);
                    const chip = dateParts(date, t.locale);
                    const muted = v.status === 'cancelled' || v.status === 'no_show';
                    // "Book again with Priya": same stylist and services, straight to their free times.
                    const again = !muted && salon.bookingEnabled && v.stylist?.bookable && v.serviceIds.length
                      ? bookAgainHref(p.base, v.stylist.id, v.serviceIds) : null;
                    return (
                      <li key={v.id} className="row pt-past" style={{ gap: 14 }}>
                        <div className="pt-date-chip num"><span>{chip.day}</span><span>{chip.mon}</span></div>
                        <div className="grow" style={{ minWidth: 0 }}>
                          <div className={muted ? 'truncate muted' : 'truncate strong'} style={muted ? { textDecoration: 'line-through' } : undefined}>{v.services.map((s) => s.name).join(', ')}</div>
                          <div className="small muted pt-stylist">
                            {v.stylist && <Avatar name={v.stylist.name} color={v.stylist.color} photo={v.stylist.photoUrl} size="sm" />}
                            <span className="truncate">{v.stylist ? v.stylist.name : salon.name}</span>
                          </div>
                          {again && v.stylist && (
                            <Link className="pt-again small" href={again}><Icon name="calendar" size={14} />{t('pt.bookAgainWith', { name: v.stylist.name.split(' ')[0] })}</Link>
                          )}
                        </div>
                        {muted ? <Badge tone="danger">{t(`status.${v.status}`)}</Badge>
                          : v.invoiceId ? <Link className="btn btn-ghost btn-sm" href={`${p.base}/me/bills/${v.invoiceId}`}>{t('common.bill')}</Link>
                          : salon.bookingEnabled && !again ? <Link className="btn btn-ghost btn-sm" href={bookHref}>{t('pt.bookAgain')}</Link> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="muted small">{t('pt.pastEmpty')}</p>}
            </section>

            <section className="stack">
              <h2>{t('pt.bills')}</h2>
              {p.bills.length ? (
                <ul className="list panel">
                  {p.bills.map((b) => {
                    const salon = salonById.get(b.salonId);
                    return (
                      <li key={b.id} style={{ padding: 0 }}>
                        <Link href={`${p.base}/me/bills/${b.id}`} className="row pt-bill-row">
                          <span className="pt-bill-icon"><Icon name="receipt" size={18} /></span>
                          <div className="grow" style={{ minWidth: 0 }}>
                            <div className="strong truncate">{salon ? fmtDateShort(localDate(new Date(b.created_at), salon.timezone), t.locale) : ''}</div>
                            <div className="small muted">{t('common.billNo', { no: b.invoice_no })}</div>
                          </div>
                          <div className="right">
                            <div className="num strong">{money(b.total)}</div>
                            <div className="tiny muted">{t(`invoice.${b.status}`)}</div>
                          </div>
                          <Icon name="chevronRight" size={16} className="muted" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="muted small">{t('pt.billsEmpty')}</p>}
            </section>

            {p.coins && p.coins.history.length > 0 && (
              <section className="stack">
                <div className="between"><h2>{t('pt.coinHistory')}</h2><span className="small muted num">{t('pt.balance', { n: fmtCoins(p.coins.balance) })}</span></div>
                <div className="panel">
                  <CoinHistoryList rows={p.coins.history.slice(0, 5)} tz={p.salon.timezone} billHref={(id) => `${p.base}/me/bills/${id}`} showReference={false} />
                </div>
                <p className="tiny muted">{t('pt.coinsOnlyHere', { salon: p.salon.name })}</p>
              </section>
            )}

            <section className="pt-salon">
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="strong truncate">{p.salon.name}</div>
                <div className="small muted truncate">{[p.salon.city, p.salon.phone ? formatPhone(p.salon.phone) : null].filter(Boolean).join(' · ')}</div>
              </div>
              {p.salon.bookingEnabled && <Link className="btn btn-secondary btn-sm" href={bookHref}>{t('pt.bookAgain')}</Link>}
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
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  useEffect(() => { if (visit) { setReason(''); setError(null); } }, [visit]);
  return (
    <Dialog open={!!visit} onClose={onClose} title={t('pt.cancelTitle')}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t('pt.keepBooking')}</Button>
        <Button variant="danger" loading={busy} onClick={async () => {
          if (!visit) return;
          setBusy(true); setError(null);
          const r = await cancelMyBooking(visit.id, reason);
          setBusy(false);
          if (!r.ok) { setError(t.err(r.error)); return; }
          toast(t('pt.cancelled'));
          onClose();
          router.refresh();
        }}>{t('pt.cancelBooking')}</Button>
      </>}>
      <p className="muted">{t('pt.cancelBody')}</p>
      <TextArea label={t('pt.reason')} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} rows={2} placeholder={t('pt.reasonPh')} />
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
  const t = useT();
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
      if (r.ok) { setSlots(r.data ?? []); setError(null); } else { setSlots([]); setError(t.err(r.error)); }
    });
  }, [visit, date, t]);

  if (!visit || !salon) return null;
  const closed = salon.hours ? !salon.hours[dayKeyOf(date)]?.length : false;
  return (
    <Sheet open={!!visit} onClose={onClose} title={t('pt.changeTime')} width={520}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t('pt.keepTime')}</Button>
        <Button variant="primary" disabled={!slot} loading={busy} onClick={async () => {
          if (!slot) return;
          setBusy(true); setError(null);
          const r = await rescheduleMyBooking(visit.id, slot.start);
          setBusy(false);
          if (!r.ok) {
            setError(t.err(r.error));
            if (/taken|not available/i.test(r.error)) { const d = date; setDate(''); setTimeout(() => setDate(d), 0); }
            return;
          }
          toast(t('pt.moved', { when: fmtDateTime(slot.start, salon.timezone, t.locale) }));
          onClose();
          router.refresh();
        }}>{t('pt.move')}</Button>
      </>}>
      <div className="stack">
        <div className="pt-current small">
          <span className="muted">{t('pt.nowBooked')}</span> <span className="strong">{fmtDateTime(visit.start_at, salon.timezone, t.locale)}</span>
          <span className="muted"> · {visit.services.map((s) => s.name).join(', ')}</span>
        </div>
        <DateStrip today={today} windowDays={salon.bookingWindowDays} hours={salon.hours} value={date} onChange={setDate} />
        <h3>{date ? fmtDateLong(date, t.locale) : ''}</h3>
        {error && <Notice tone="error">{error}</Notice>}
        {slots === null ? (
          <div className="bk-slots-loading"><span className="spinner" aria-hidden /> {t('bk.findingTimes')}</div>
        ) : slots.length ? (
          <SlotGrid slots={slots} value={slot?.start ?? null} onChange={setSlot} />
        ) : !error ? (
          <p className="muted small">{closed ? t('pt.closedDay') : t('pt.noTimes')}</p>
        ) : null}
        <p className="tiny muted">{t('pt.keepStylist', { name: visit.stylist?.name ?? t('pt.sameStylist') })}</p>
      </div>
    </Sheet>
  );
}
