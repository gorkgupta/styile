'use client';
// Bridal & events: the list of upcoming events, an event's page (trial → event timeline, people, advances, balance
// due, check out), booking a new event, taking an advance (advance receipt — not a tax invoice) and refunds.
import { useEffect, useMemo, useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Avatar, Badge, Button, Dialog, Empty, Notice, Panel, Segmented, Sheet, StatusBadge, Switch, TextArea, TextField, cx, useToast } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { Topbar } from './shell';
import { ClientPicker } from './pickers';
import { deskMethods, METHOD_ICON, REF_PLACEHOLDER, parseAmount } from './billing-bits';
import type { MenuProps } from './appointment-sheets';
import type { ClientLite } from '@/actions/appointments';
import { cancelEvent, createEvent, recordAdvance, refundAdvance, resendAdvanceReceipt, updateEventDetails } from '@/actions/events';
import { money } from '@/lib/billing';
import { advanceLeft, byMonth, countdown, daysTo, EVENT_TYPE_LABEL, EVENT_TYPES, eventMoney, GUEST_PRESETS } from '@/lib/events';
import { dayText } from '@/lib/packages';
import { formatPhone } from '@/lib/phone';
import { fmtDateYear } from '@/lib/periods';
import { addDays, fmtDateLong, fmtTime, localDate, localTime, zonedToUtc } from '@/lib/time';
import { useT } from '@/lib/i18n/react';
import { dayTextT } from '@/lib/i18n/format';
import { MONEY_METHODS, METHOD_LABEL, type AdvancePayment, type ApptStatus, type EventType, type GstMode, type PayMethod, type SalonEvent } from '@/lib/types';

const moneyMethods = (enabled?: PayMethod[]) => deskMethods(enabled).filter((m) => MONEY_METHODS.includes(m) && m !== 'other');
const EVENT_TONE: Record<EventType, 'plum' | 'marigold' | 'peacock' | 'neutral'> = { bridal: 'plum', engagement: 'marigold', party: 'peacock', group: 'peacock', other: 'neutral' };

/** The salon details an advance receipt needs. */
export interface ReceiptSalon { name: string; gstMode: GstMode; gstin: string | null; address: string | null; phone: string | null; policy: string | null }

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------
export interface EventListRow extends SalonEvent {
  customer: { id: string; name: string; phone: string };
  advances: Pick<AdvancePayment, 'amount' | 'applied_amount' | 'refund_amount'>[];
  /** The final bill, once checked out. */
  bill: { id: string; invoice_no: string; total: number; paid_total: number } | null;
}

export interface NewEventProps { menu: MenuProps; today: string; methods?: PayMethod[]; waConnected: boolean }

export function EventsScreen({ events, today, tz, canCreate, newEvent }: { events: EventListRow[]; today: string; tz: string; canCreate: boolean; newEvent: NewEventProps }) {
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [creating, setCreating] = useState(false);
  const day = (e: SalonEvent) => localDate(new Date(e.event_at), tz);
  const upcoming = events.filter((e) => e.status === 'booked' && day(e) >= today).sort((a, b) => a.event_at.localeCompare(b.event_at));
  const past = events.filter((e) => !upcoming.includes(e)).sort((a, b) => b.event_at.localeCompare(a.event_at));
  const shown = tab === 'upcoming' ? upcoming : past;
  const dueTotal = upcoming.reduce((s, e) => s + eventMoney(e, e.advances).balanceDue, 0);
  const heldTotal = upcoming.reduce((s, e) => s + eventMoney(e, e.advances).left, 0);
  const monthLabel = (m: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${m}-01T00:00:00Z`));

  return (
    <>
      <Topbar title="Bridal & events" subtitle={upcoming.length ? `${upcoming.length} coming up · ${money(heldTotal)} in advances · ${money(dueTotal)} still due` : 'Weddings, engagements and group bookings'}
        actions={canCreate ? <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New event</Button> : undefined} />
      <div className="page page-narrow">
        <div><Segmented label="Which events" value={tab} onChange={setTab}
          options={[{ value: 'upcoming', label: `Coming up · ${upcoming.length}` }, { value: 'past', label: `Past & cancelled · ${past.length}` }]} /></div>
        {shown.length ? byMonth(shown, (e) => day(e)).map((g) => (
          <Panel key={g.month} flush title={<h2>{monthLabel(g.month)}</h2>}>
            <ul className="list">
              {g.rows.map((e) => {
                const m = eventMoney(e, e.advances);
                const d = day(e);
                const n = daysTo(d, today);
                return (
                  <li key={e.id} style={{ padding: 0 }}>
                    <Link href={`/app/events/${e.id}`} className={cx('list-link ev-row', e.status === 'cancelled' && 'is-void')}>
                      <div className="date-tile num" aria-hidden>
                        <span>{new Intl.DateTimeFormat('en-IN', { timeZone: tz, weekday: 'short' }).format(new Date(e.event_at))}</span>
                        <strong>{Number(d.slice(8))}</strong>
                      </div>
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="strong truncate">{e.title}</div>
                        <div className="small muted truncate">
                          {e.customer.name} · {e.people} {e.people === 1 ? 'person' : 'people'} · ready by {fmtTime(e.event_at, tz)}
                          {e.location === 'home' ? ' · home visit' : ''}
                        </div>
                        <div className="row tiny muted" style={{ gap: 6, marginTop: 2 }}>
                          <Badge tone={EVENT_TONE[e.event_type]}>{EVENT_TYPE_LABEL[e.event_type]}</Badge>
                          {e.status === 'cancelled' ? <span className="danger-text">Cancelled</span>
                            : e.status === 'done' ? 'Billed' : <span className={n <= 7 ? 'warn-text strong' : undefined}>{countdown(d, today)}</span>}
                        </div>
                      </div>
                      <div className="right ev-money">
                        {e.bill ? <><div className="num strong">{money(e.bill.total)}</div><div className="tiny muted">Bill {e.bill.invoice_no}</div></>
                          : <>
                            <div className={cx('num strong', m.balanceDue > 0 && e.status === 'booked' && 'warn-text')}>{m.quoted ? money(m.balanceDue) : '—'}</div>
                            <div className="tiny muted num">{m.quoted ? 'due' : 'no quote'}{m.received ? ` · ${money(m.received - m.refunded)} paid` : ''}</div>
                          </>}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Panel>
        )) : (
          <div className="panel">
            <Empty icon="heart" title={tab === 'upcoming' ? 'No events booked yet' : 'No past events'}
              action={tab === 'upcoming' && canCreate ? <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Book a bridal or group event</Button> : undefined}>
              {tab === 'upcoming' ? 'Book the bride, her family and friends together, with a trial date, home visit and an advance to hold the day.' : 'Events you’ve billed or cancelled show here.'}
            </Empty>
          </div>
        )}
      </div>
      {canCreate && <NewEventSheet open={creating} onClose={() => setCreating(false)} {...newEvent} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// One event
// ---------------------------------------------------------------------------
export interface EventPerson {
  id: string; name: string | null; start_at: string; end_at: string; status: ApptStatus; staff: { name: string; color: string } | null;
  services: { name: string; price: number }[];
}

export interface EventDetailProps {
  event: SalonEvent;
  customer: { id: string; name: string; phone: string };
  people: EventPerson[];
  trial: EventPerson | null;
  advances: AdvancePayment[];
  bill: { id: string; invoice_no: string; total: number; paid_total: number; status: string } | null;
  salon: ReceiptSalon & { methods?: PayMethod[]; waConnected: boolean };
  today: string;
  tz: string;
  canEdit: boolean;
  canRefund: boolean;
  canBill: boolean;
}

export function EventDetail(p: EventDetailProps) {
  const { event: e, tz } = p;
  const [taking, setTaking] = useState(false);
  const [receipt, setReceipt] = useState<AdvancePayment | null>(null);
  const [refunding, setRefunding] = useState<AdvancePayment | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [editing, setEditing] = useState(false);
  const toast = useToast();
  const [sending, startSend] = useTransition();
  const m = eventMoney(e, p.advances);
  const day = localDate(new Date(e.event_at), tz);
  const n = daysTo(day, p.today);
  const open = e.status === 'booked';
  const servicesTotal = p.people.reduce((s, x) => s + x.services.reduce((a, b) => a + Number(b.price), 0), 0);

  const steps: { key: string; label: string; when: string; sub: ReactNode; state: 'done' | 'next' | 'later' }[] = [
    { key: 'booked', label: 'Booked', when: fmtDateYear(e.created_at, tz), sub: p.advances.length ? `Advance ${p.advances[0].receipt_no}` : 'No advance yet', state: 'done' },
    ...(p.trial ? [{
      key: 'trial', label: 'Trial', when: `${dayText(localDate(new Date(p.trial.start_at), tz), p.today)}, ${fmtTime(p.trial.start_at, tz)}`,
      sub: <>{p.trial.services.map((x) => x.name).join(', ')}{p.trial.staff ? ` · ${p.trial.staff.name}` : ''} · <StatusBadge status={p.trial.status} /></>,
      state: (p.trial.status === 'completed' || localDate(new Date(p.trial.start_at), tz) < p.today ? 'done' : 'next') as 'done' | 'next',
    }] : []),
    { key: 'event', label: EVENT_TYPE_LABEL[e.event_type], when: `${dayText(day, p.today)}, ready by ${fmtTime(e.event_at, tz)}`,
      sub: e.status === 'cancelled' ? 'Cancelled' : e.status === 'done' ? 'Done and billed' : countdown(day, p.today),
      state: e.status === 'done' ? 'done' : (p.trial && localDate(new Date(p.trial.start_at), tz) >= p.today && p.trial.status !== 'completed') ? 'later' : 'next' },
  ];

  return (
    <>
      <Topbar back="/app/events" title={<>{e.title} <span className="hide-mobile" style={{ marginLeft: 4 }}><Badge tone={EVENT_TONE[e.event_type]}>{EVENT_TYPE_LABEL[e.event_type]}</Badge></span></>}
        subtitle={`${p.customer.name} · ${fmtDateLong(day)}`}
        actions={<>
          {p.canEdit && open && <Button icon="edit" onClick={() => setEditing(true)}><span className="hide-mobile">Edit</span></Button>}
          {p.canBill && open && <Link className="btn btn-primary" href={`/app/pos?event=${e.id}`}><Icon name="receipt" />Check out</Link>}
          {p.bill && <Link className="btn btn-secondary" href={`/app/invoices/${p.bill.id}`}><Icon name="receipt" />Bill {p.bill.invoice_no}</Link>}
        </>} />
      <div className="page">
        {e.status === 'cancelled' && (
          <Notice tone="warn">Cancelled{e.cancel_reason ? `: ${e.cancel_reason}` : ''}. {m.left > 0 ? `${money(m.left)} of advance is still with the salon — refund it per your policy, or use it on a later bill.` : ''}</Notice>
        )}
        <div className="stats">
          <div className="stat"><div className="stat-label">{n >= 0 ? 'Days to go' : 'Event day'}</div><div className="stat-value">{n > 0 ? n : n === 0 ? 'Today' : dayText(day, p.today)}</div>
            <div className="stat-sub">{fmtDateLong(day)}</div></div>
          <div className="stat"><div className="stat-label">Quote</div><div className="stat-value">{m.quoted ? money(m.quoted) : '—'}</div>
            <div className="stat-sub">{e.location === 'home' && e.travel_charge ? `incl. ${money(e.travel_charge)} travel` : `Services on the menu ${money(servicesTotal)}`}</div></div>
          <div className="stat"><div className="stat-label">Advance paid</div><div className="stat-value">{money(m.received - m.refunded)}</div>
            <div className="stat-sub">{m.refunded ? `${money(m.refunded)} refunded` : m.applied ? `${money(m.applied)} used on the bill` : `${p.advances.length} receipt${p.advances.length === 1 ? '' : 's'}`}</div></div>
          <div className="stat"><div className="stat-label">{p.bill ? 'Bill' : 'Balance due'}</div>
            <div className={cx('stat-value', !p.bill && m.balanceDue > 0 && 'warn-text')}>{p.bill ? money(p.bill.total) : m.quoted ? money(m.balanceDue) : '—'}</div>
            <div className="stat-sub">{p.bill ? (p.bill.status === 'paid' ? 'Paid in full' : `${money(p.bill.total - p.bill.paid_total)} due`) : m.quoted ? 'on the day, after advances' : 'Add a quote to track it'}</div></div>
        </div>

        <div className="split ev-grid">
          <div className="stack">
            <Panel title="Timeline">
              <ol className="ev-timeline">
                {steps.map((s) => (
                  <li key={s.key} className={`is-${s.state}`}>
                    <span className="ev-dot" aria-hidden>{s.state === 'done' ? <Icon name="check" size={13} /> : null}</span>
                    <div>
                      <div className="strong">{s.label} <span className="muted small num">· {s.when}</span></div>
                      <div className="small muted">{s.sub}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </Panel>

            <Panel flush title={`People · ${p.people.length}`}>
              <ul className="list">
                {p.people.map((x) => (
                  <li key={x.id} className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                    <Avatar name={x.name || p.customer.name} size="sm" color={x.staff?.color} />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="strong">{x.name || p.customer.name}</div>
                      <div className="small muted">{x.services.map((s) => s.name).join(', ')}</div>
                      <div className="tiny muted num">{fmtTime(x.start_at, tz)}–{fmtTime(x.end_at, tz)}{x.staff ? <> · <span className="dot" style={{ background: x.staff.color, verticalAlign: 'middle' }} /> {x.staff.name}</> : ' · no stylist yet'}</div>
                    </div>
                    <div className="stack-sm" style={{ alignItems: 'flex-end', gap: 4 }}>
                      <span className="num small">{money(x.services.reduce((a, b) => a + Number(b.price), 0))}</span>
                      <StatusBadge status={x.status} />
                    </div>
                  </li>
                ))}
              </ul>
              <div className="panel-foot tiny muted">Each person is an appointment on the calendar, so stylists can’t be double-booked.</div>
            </Panel>

            <Panel title="Where">
              <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                <Icon name={e.location === 'home' ? 'pin' : 'store'} size={18} className="muted" />
                <div className="grow">
                  <div className="strong">{e.location === 'home' ? 'Home visit' : `At ${p.salon.name}`}</div>
                  {e.location === 'home' && <div className="small ink2">{e.address}</div>}
                  {e.location === 'home' && <div className="tiny muted num">Travel charge {money(e.travel_charge)} — added to the bill</div>}
                </div>
              </div>
              {e.notes && <p className="notes-text" style={{ marginTop: 12 }}>{e.notes}</p>}
            </Panel>
          </div>

          <div className="stack">
            <Panel flush title={<h2 className="row" style={{ gap: 8 }}><Icon name="heart" size={18} className="adv-title-icon" />Advances</h2>}
              actions={p.canEdit && open ? <Button size="sm" variant="primary" icon="plus" onClick={() => setTaking(true)}>Take advance</Button> : undefined}>
              {p.advances.length ? (
                <ul className="list">
                  {p.advances.map((a) => {
                    const left = advanceLeft(a);
                    return (
                      <li key={a.id} className="adv-row">
                        <div className="between">
                          <div style={{ minWidth: 0 }}>
                            <div className="strong num">{money(a.amount)} <span className="muted small">by {METHOD_LABEL[a.method]}</span></div>
                            <div className="tiny muted num">{a.receipt_no} · {fmtDateYear(a.received_at, tz)}{a.reference ? ` · ${a.reference}` : ''}</div>
                          </div>
                          <div className="right">
                            <div className="small num">{left > 0 ? `${money(left)} left` : a.refund_amount ? 'Refunded' : 'Used'}</div>
                            {a.applied_amount > 0 && <div className="tiny muted num">{money(a.applied_amount)} on the bill</div>}
                          </div>
                        </div>
                        {a.refund_amount ? <div className="tiny danger-text num">{money(a.refund_amount)} handed back by {METHOD_LABEL[a.refund_method!]} · {a.refund_reason}</div> : null}
                        <div className="row-wrap adv-actions">
                          <button type="button" className="link-btn tiny" onClick={() => setReceipt(a)}>Receipt</button>
                          {p.salon.waConnected && <button type="button" className="link-btn tiny" disabled={sending}
                            onClick={() => startSend(async () => { const r = await resendAdvanceReceipt(a.id); toast(r.ok ? r.message ?? 'Sent' : r.error, r.ok ? undefined : 'error'); })}>Send on WhatsApp</button>}
                          {p.canRefund && !a.refunded_at && left > 0 && <button type="button" className="link-btn tiny danger-text" onClick={() => setRefunding(a)}>Refund</button>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="panel-body small muted">No advance yet. Take one to hold the date — the client gets an advance receipt.</p>}
              <div className="panel-foot">
                <dl className="totals">
                  <dt>Quote</dt><dd className="num">{m.quoted ? money(m.quoted) : '—'}</dd>
                  <dt>Advance received</dt><dd className="num">−{money(m.received)}</dd>
                  {m.refunded > 0 && <><dt>Handed back</dt><dd className="num">+{money(m.refunded)}</dd></>}
                  <dt className="grand">Balance due</dt><dd className="grand num">{m.quoted ? money(m.balanceDue) : '—'}</dd>
                </dl>
                <p className="tiny muted" style={{ marginTop: 6 }}>Advances are applied on the final bill at check-out.{p.salon.policy ? ` Your policy: ${p.salon.policy}` : ''}</p>
              </div>
            </Panel>

            <Panel title="Client">
              <div className="row" style={{ gap: 10 }}>
                <Avatar name={p.customer.name} />
                <div className="grow">
                  <Link href={`/app/customers/${p.customer.id}`} className="strong">{p.customer.name}</Link>
                  <div className="small muted num">{formatPhone(p.customer.phone)}</div>
                </div>
                <a className="btn btn-ghost btn-sm" href={`https://wa.me/${p.customer.phone}`} target="_blank" rel="noreferrer"><Icon name="whatsapp" size={16} />WhatsApp</a>
              </div>
            </Panel>
            {p.canEdit && open && (
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <Button size="sm" variant="ghost" icon="x" className="danger-text" onClick={() => setCancelling(true)}>Cancel event</Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {p.canEdit && <TakeAdvanceSheet open={taking} onClose={() => setTaking(false)} customer={p.customer} event={e} salon={p.salon} tz={tz} due={m.balanceDue} />}
      <Sheet open={!!receipt} onClose={() => setReceipt(null)} title="Advance receipt" width={480}
        footer={<><Button icon="printer" onClick={() => window.print()}>Print</Button><Button variant="primary" onClick={() => setReceipt(null)}>Done</Button></>}>
        {receipt && <AdvanceReceipt advance={receipt} salon={p.salon} customer={p.customer} event={e} tz={tz} />}
      </Sheet>
      {p.canRefund && <RefundAdvanceDialog advance={refunding} onClose={() => setRefunding(null)} methods={p.salon.methods} policy={p.salon.policy} />}
      {p.canEdit && <CancelEventDialog open={cancelling} onClose={() => setCancelling(false)} event={e} advanceLeft={m.left} />}
      {p.canEdit && <EditEventSheet open={editing} onClose={() => setEditing(false)} event={e} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// The advance receipt (printable; also the client's copy in the portal)
// ---------------------------------------------------------------------------
export function AdvanceReceipt({ advance: a, salon, customer, event, tz, sent }: {
  advance: AdvancePayment; salon: ReceiptSalon; customer: { name: string; phone: string }; event: Pick<SalonEvent, 'title' | 'event_at' | 'event_type'> | null; tz: string; sent?: boolean;
}) {
  const t = useT();
  return (
    <div className="stack-lg coin-receipt adv-receipt">
      {sent !== undefined && (
        <div className="coin-receipt-head">
          <span className="coin-receipt-icon"><Icon name="check" size={22} /></span>
          <div>
            <div className="strong">{t('rcpt.advReceivedFrom', { money: money(a.amount), name: customer.name })}</div>
            <div className="small muted">{sent ? t('rcpt.sentOnWa', { name: customer.name.split(' ')[0] }) : t('rcpt.savedOnEvent')}</div>
          </div>
        </div>
      )}
      <div className="adv-receipt-title">
        <div className="strong">{salon.name}</div>
        {salon.address && <div className="tiny muted">{salon.address}</div>}
        {salon.gstMode !== 'unregistered' && salon.gstin && <div className="tiny muted">GSTIN {salon.gstin}</div>}
        <div className="adv-receipt-kind">{t('rcpt.advTitle')}</div>
      </div>
      <dl className="coin-receipt-lines">
        <div><dt>{t('rcpt.no')}</dt><dd className="num strong">{a.receipt_no}</dd></div>
        <div><dt>{t('common.date')}</dt><dd className="num">{fmtDateYear(a.received_at, tz, t.locale)}, {fmtTime(a.received_at, tz)}</dd></div>
        <div><dt>{t('rcpt.receivedFrom')}</dt><dd>{customer.name}<span className="muted num"> · {formatPhone(customer.phone)}</span></dd></div>
        {event && <div><dt>{t('rcpt.for')}</dt><dd>{event.title} · {dayTextT(t, localDate(new Date(event.event_at), tz))}</dd></div>}
        <div><dt>{t('bill.paidBy')}</dt><dd>{t(`method.${a.method}`)}{a.reference ? <span className="muted"> · {a.reference}</span> : null}</dd></div>
        {a.refund_amount ? <div><dt>{t('rcpt.handedBack')}</dt><dd className="num danger-text">{t('rcpt.moneyOn', { money: money(a.refund_amount), date: fmtDateYear(a.refunded_at!, tz, t.locale) })}</dd></div> : null}
        <div className="coin-receipt-total"><dt>{t('rcpt.advReceived')}</dt><dd className="num">{money(a.amount)}</dd></div>
      </dl>
      <p className="tiny muted">
        {salon.gstMode === 'regular' ? t('rcpt.advNoteGst') : t('rcpt.advNote')}
        {salon.policy ? ` ${salon.policy}` : ''}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Take an advance
// ---------------------------------------------------------------------------
function TakeAdvanceSheet({ open, onClose, customer, event, salon, tz, due }: {
  open: boolean; onClose: () => void; customer: { id: string; name: string; phone: string }; event: SalonEvent;
  salon: EventDetailProps['salon']; tz: string; due: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const methods = moneyMethods(salon.methods);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PayMethod>('upi');
  const [reference, setReference] = useState('');
  const [sendWa, setSendWa] = useState(salon.waConnected);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<AdvancePayment | null>(null);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (!open) return;
    setAmount(''); setMethod(methods.includes('upi') ? 'upi' : methods[0] ?? 'cash'); setReference(''); setError(null); setDone(null); setSendWa(salon.waConnected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const amt = parseAmount(amount);
  const submit = () => start(async () => {
    setError(null);
    if (!amt) return setError('Enter the advance received.');
    const r = await recordAdvance({ customerId: customer.id, eventId: event.id, amount: amt, method, reference: method === 'cash' || method === 'cash_nu' ? null : reference, sendOnWhatsApp: sendWa && salon.waConnected });
    if (!r.ok) return setError(r.error);
    setDone(r.data!.advance); setSent(!!r.message?.includes('sent on WhatsApp')); router.refresh();
  });
  if (done) {
    return (
      <Sheet open={open} onClose={onClose} title="Advance receipt" width={480}
        footer={<><Button icon="printer" onClick={() => window.print()}>Print</Button><Button variant="primary" onClick={onClose}>Done</Button></>}>
        <AdvanceReceipt advance={done} salon={salon} customer={customer} event={event} tz={tz} sent={sent} />
      </Sheet>
    );
  }
  return (
    <Sheet open={open} onClose={onClose} width={480} title={<div><h2>Take an advance</h2><div className="small muted">{event.title} · {customer.name}</div></div>}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={pending} disabled={!amt} onClick={submit}>{amt ? `Receive ${money(amt)}` : 'Receive advance'}</Button></>}>
      <form className="stack-lg" onSubmit={(ev) => { ev.preventDefault(); submit(); }}>
        <AdvanceFields amount={amount} setAmount={setAmount} method={method} setMethod={setMethod} reference={reference} setReference={setReference} methods={methods} due={due} />
        <Switch checked={sendWa && salon.waConnected} disabled={!salon.waConnected} onChange={setSendWa}
          label={<span className="small">Send the receipt link on WhatsApp{!salon.waConnected && <span className="muted"> · connect WhatsApp in Settings</span>}</span>} />
        <p className="tiny muted">An advance receipt, not a tax invoice. The advance is applied on the final bill{salon.gstMode === 'regular' ? ', with GST on that bill' : ''}. Confirm the GST treatment with your CA.</p>
        {error && <Notice tone="error">{error}</Notice>}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

function AdvanceFields({ amount, setAmount, method, setMethod, reference, setReference, methods, due }: {
  amount: string; setAmount: (v: string) => void; method: PayMethod; setMethod: (m: PayMethod) => void; reference: string; setReference: (v: string) => void;
  methods: PayMethod[]; due?: number;
}) {
  const quick = due && due > 0 ? [...new Set([Math.round(due * 0.25 / 100) * 100, Math.round(due * 0.5 / 100) * 100, 1000, 2000, 5000])].filter((x) => x > 0 && x <= due).sort((a, b) => a - b).slice(0, 4) : [1000, 2000, 5000];
  return (
    <>
      <div className="field">
        <label htmlFor="adv-amt">Advance received</label>
        <div className="prefix-input"><span>₹</span>
          <input id="adv-amt" className="input num" inputMode="decimal" placeholder="e.g. 2000" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="row-wrap">
          {quick.map((q) => <button key={q} type="button" className="chip chip-sm" aria-pressed={parseAmount(amount) === q} onClick={() => setAmount(String(q))}>{money(q)}</button>)}
        </div>
      </div>
      <div className="field">
        <span className="label">Paid by</span>
        <div className="row-wrap" role="group" aria-label="Paid by">
          {methods.map((m) => (
            <button key={m} type="button" className="chip chip-sm" aria-pressed={method === m} onClick={() => setMethod(m)}><Icon name={METHOD_ICON[m]} size={14} />{METHOD_LABEL[m]}</button>
          ))}
        </div>
        {method !== 'cash' && method !== 'cash_nu' && (
          <input className="input" placeholder={REF_PLACEHOLDER[method]} value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} aria-label="Payment reference" />
        )}
        {method === 'upi_bhutan' && <span className="hint">Bhutanese bank apps allow up to ₹10,000 a payment and ₹50,000 a year — a big advance may need cash (Nu) too.</span>}
      </div>
    </>
  );
}

function RefundAdvanceDialog({ advance: a, onClose, methods, policy }: { advance: AdvancePayment | null; onClose: () => void; methods?: PayMethod[]; policy: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PayMethod>('cash');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (a) { setAmount(String(advanceLeft(a))); setMethod(a.method === 'cash_nu' ? 'cash_nu' : 'cash'); setReason(''); setError(null); } }, [a]);
  if (!a) return null;
  const left = advanceLeft(a);
  const save = () => start(async () => {
    setError(null);
    const amt = parseAmount(amount);
    if (!amt || amt > left) return setError(`Refund up to ${money(left)}.`);
    const r = await refundAdvance(a.id, amt, method, reason);
    if (!r.ok) return setError(r.error);
    toast(r.message ?? 'Refund recorded'); onClose(); router.refresh();
  });
  return (
    <Dialog open={!!a} onClose={onClose} title={`Refund advance ${a.receipt_no}`}
      footer={<><Button variant="ghost" onClick={onClose}>Keep advance</Button><Button variant="danger" loading={pending} onClick={save}>Record refund</Button></>}>
      <p className="small ink2">{money(left)} of {money(a.amount)} can be handed back. Nothing is forfeited automatically — follow your salon’s policy.</p>
      {policy && <Notice>{policy}</Notice>}
      <div className="field">
        <label htmlFor="rf-amt">Amount handed back</label>
        <div className="prefix-input"><span>₹</span><input id="rf-amt" className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div className="row-wrap" role="group" aria-label="Handed back by">
          {moneyMethods(methods).map((m) => <button key={m} type="button" className="chip chip-sm" aria-pressed={method === m} onClick={() => setMethod(m)}>{METHOD_LABEL[m]}</button>)}
        </div>
      </div>
      <TextArea label="Reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wedding postponed, refunded per policy" />
      {error && <Notice tone="error">{error}</Notice>}
    </Dialog>
  );
}

function CancelEventDialog({ open, onClose, event, advanceLeft: left }: { open: boolean; onClose: () => void; event: SalonEvent; advanceLeft: number }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setReason(''); setError(null); } }, [open]);
  const save = () => start(async () => {
    setError(null);
    const r = await cancelEvent(event.id, reason);
    if (!r.ok) return setError(r.error);
    toast(r.message ?? 'Event cancelled'); onClose(); router.refresh();
  });
  return (
    <Dialog open={open} onClose={onClose} title={`Cancel ${event.title}?`}
      footer={<><Button variant="ghost" onClick={onClose}>Keep event</Button><Button variant="danger" loading={pending} onClick={save}>Cancel event</Button></>}>
      <p className="small ink2">Everyone’s appointments (and the trial, if not done) are cancelled and the stylists are free again.</p>
      {left > 0 && <Notice tone="warn">{money(left)} of advance stays with the salon. Record a refund afterwards if your policy says so.</Notice>}
      <TextArea label="Reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wedding postponed to next year" />
      {error && <Notice tone="error">{error}</Notice>}
    </Dialog>
  );
}

function EditEventSheet({ open, onClose, event: e }: { open: boolean; onClose: () => void; event: SalonEvent }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [f, setF] = useState({ title: '', address: '', travel: '', quote: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setF({ title: e.title, address: e.address ?? '', travel: String(e.travel_charge || ''), quote: e.quoted_price == null ? '' : String(e.quoted_price), notes: e.notes ?? '' });
    setError(null);
  }, [open, e]);
  const save = () => start(async () => {
    const r = await updateEventDetails(e.id, { title: f.title, address: f.address, travelCharge: parseAmount(f.travel), quotedPrice: f.quote.trim() ? parseAmount(f.quote) : null, notes: f.notes });
    if (!r.ok) return setError(r.error);
    toast(r.message ?? 'Saved'); onClose(); router.refresh();
  });
  return (
    <Sheet open={open} onClose={onClose} title="Edit event" width={480}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={pending} onClick={save}>Save event</Button></>}>
      <div className="stack-lg">
        <TextField label="Event name" value={f.title} maxLength={80} onChange={(x) => setF({ ...f, title: x.target.value })} />
        {e.location === 'home' && <TextArea label="Home visit address" rows={2} maxLength={240} value={f.address} onChange={(x) => setF({ ...f, address: x.target.value })} />}
        <div className="grid-2">
          <MoneyField id="ed-quote" label="Quote" value={f.quote} onChange={(v) => setF({ ...f, quote: v })} />
          {e.location === 'home' && <MoneyField id="ed-travel" label="Travel charge" value={f.travel} onChange={(v) => setF({ ...f, travel: v })} />}
        </div>
        <TextArea label="Notes" rows={3} maxLength={1000} value={f.notes} onChange={(x) => setF({ ...f, notes: x.target.value })} />
        <p className="tiny muted">To change who is coming or the times, move their appointments on the calendar.</p>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Sheet>
  );
}

function MoneyField({ id, label, value, onChange, placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="prefix-input"><span>₹</span><input id={id} className="input num" inputMode="decimal" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New event
// ---------------------------------------------------------------------------
interface PersonRow { key: number; name: string; serviceIds: string[]; staffId: string; time: string }
let personKey = 0;

export function NewEventSheet({ open, onClose, menu, today, methods: salonMethods, waConnected, initialClient }: NewEventProps & { open: boolean; onClose: () => void; initialClient?: ClientLite | null }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const tz = menu.tz;
  const services = menu.services.filter((s) => s.active);
  const staff = menu.staff.filter((s) => s.active);
  const methods = moneyMethods(salonMethods);
  const [client, setClient] = useState<ClientLite | null>(null);
  const [type, setType] = useState<EventType>('bridal');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [ready, setReady] = useState('09:00');
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [trialOn, setTrialOn] = useState(false);
  const [trial, setTrial] = useState({ date: '', time: '11:00', staffId: '', serviceId: '' });
  const [where, setWhere] = useState<'salon' | 'home'>('salon');
  const [address, setAddress] = useState('');
  const [travel, setTravel] = useState('');
  const [quote, setQuote] = useState('');
  const [notes, setNotes] = useState('');
  const [advOn, setAdvOn] = useState(true);
  const [advAmount, setAdvAmount] = useState('');
  const [advMethod, setAdvMethod] = useState<PayMethod>('upi');
  const [advRef, setAdvRef] = useState('');
  const [sendWa, setSendWa] = useState(waConnected);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setClient(initialClient ?? null); setType('bridal'); setTitle(''); setDate(addDays(today, 30)); setReady('09:00');
    setPeople([{ key: ++personKey, name: 'Bride', serviceIds: [], staffId: staff[0]?.id ?? '', time: '06:00' }]);
    setTrialOn(false); setTrial({ date: addDays(today, 14), time: '11:00', staffId: staff[0]?.id ?? '', serviceId: '' });
    setWhere('salon'); setAddress(''); setTravel(''); setQuote(''); setNotes('');
    setAdvOn(true); setAdvAmount(''); setAdvMethod(methods.includes('upi') ? 'upi' : methods[0] ?? 'cash'); setAdvRef(''); setSendWa(waConnected); setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const first = client?.name.split(' ')[0] ?? '';
  const autoTitle = client ? `${first}’s ${type === 'bridal' ? 'wedding' : type === 'engagement' ? 'engagement' : type === 'party' ? 'party' : 'event'}` : '';
  const svc = (id: string) => services.find((s) => s.id === id);
  const menuTotal = people.reduce((s, p) => s + p.serviceIds.reduce((a, id) => a + Number(svc(id)?.price ?? 0), 0), 0);
  const travelN = where === 'home' ? parseAmount(travel) : 0;
  const setPerson = (key: number, patch: Partial<PersonRow>) => setPeople((cur) => cur.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const bridalSuggest = useMemo(() => services.find((s) => /bridal/i.test(s.name)) ?? null, [services]);

  const submit = () => start(async () => {
    setError(null);
    if (!client) return setError('Choose the client (the bride or whoever is booking).');
    if (!date) return setError('Pick the event date.');
    const at = zonedToUtc(date, ready, tz).toISOString();
    const r = await createEvent({
      customerId: client.id, type, title: title.trim() || autoTitle, eventAt: at, location: where, address, travelCharge: travelN,
      quotedPrice: quote.trim() ? parseAmount(quote) : null, notes,
      people: people.map((p, i) => ({ name: p.name.trim() || (i === 0 ? client.name : `Guest ${i + 1}`), serviceIds: p.serviceIds, staffId: p.staffId || null, start: zonedToUtc(date, p.time, tz).toISOString() })),
      trial: trialOn ? { start: zonedToUtc(trial.date, trial.time, tz).toISOString(), staffId: trial.staffId || null, serviceIds: trial.serviceId ? [trial.serviceId] : [] } : null,
      advance: advOn && parseAmount(advAmount) > 0 ? { amount: parseAmount(advAmount), method: advMethod, reference: advRef } : null,
      sendOnWhatsApp: sendWa && waConnected,
    });
    if (!r.ok) return setError(r.error);
    toast(r.message ?? 'Event booked'); onClose(); router.push(`/app/events/${r.data!.id}`);
  });

  return (
    <Sheet open={open} onClose={onClose} width={620} title={<div><h2>New event</h2><div className="small muted">Bridal, engagement or group booking</div></div>}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={pending} onClick={submit}>{advOn && parseAmount(advAmount) > 0 ? `Book and receive ${money(parseAmount(advAmount))}` : 'Book event'}</Button></>}>
      <form className="stack-lg" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <section className="stack-sm">
          <span className="label">Client</span>
          <ClientPicker value={client} onChange={setClient} />
        </section>
        <div className="field">
          <span className="label">Kind of event</span>
          <div className="row-wrap" role="group" aria-label="Kind of event">
            {EVENT_TYPES.map((t) => <button key={t.key} type="button" className="chip chip-sm" aria-pressed={type === t.key} onClick={() => setType(t.key)}>{t.label}</button>)}
          </div>
        </div>
        <TextField label="Event name" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder={autoTitle || 'e.g. Deki’s wedding'} hint={!title && autoTitle ? `Leave empty for “${autoTitle}”` : undefined} />
        <div className="grid-2">
          <TextField label="Event date" type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} />
          <TextField label="Everyone ready by" type="time" value={ready} onChange={(e) => setReady(e.target.value)} />
        </div>

        <section className="stack-sm">
          <div className="between"><span className="label">People and services</span><span className="tiny muted num">{people.length} {people.length === 1 ? 'person' : 'people'} · menu {money(menuTotal)}</span></div>
          {people.map((p, i) => {
            const mins = p.serviceIds.reduce((a, id) => a + (svc(id)?.duration_min ?? 0), 0);
            return (
              <div key={p.key} className="ev-person">
                <div className="ev-person-head">
                  <input className="input" value={p.name} maxLength={60} placeholder={i === 0 ? 'Bride' : 'e.g. Mother'} aria-label={`Person ${i + 1} name`}
                    onChange={(e) => setPerson(p.key, { name: e.target.value })} list="ev-guest-presets" />
                  <input className="input num ev-time" type="time" value={p.time} aria-label={`Start time for ${p.name || `person ${i + 1}`}`} onChange={(e) => setPerson(p.key, { time: e.target.value })} />
                  <Button size="sm" variant="ghost" icon="trash" aria-label="Remove this person" disabled={people.length === 1} onClick={() => setPeople((cur) => cur.filter((x) => x.key !== p.key))} />
                </div>
                <div className="row-wrap">
                  {p.serviceIds.map((id) => (
                    <button key={id} type="button" className="chip chip-sm" aria-pressed onClick={() => setPerson(p.key, { serviceIds: p.serviceIds.filter((x) => x !== id) })} title="Remove">
                      {svc(id)?.name}<span className="num" style={{ opacity: .75 }}>{money(svc(id)?.price ?? 0)}</span><Icon name="x" size={12} />
                    </button>
                  ))}
                  <select className="select input-sm ev-add-svc" value="" aria-label={`Add a service for ${p.name || `person ${i + 1}`}`}
                    onChange={(e) => e.target.value && setPerson(p.key, { serviceIds: [...p.serviceIds, e.target.value] })}>
                    <option value="">{p.serviceIds.length ? '+ Add service' : 'Choose services…'}</option>
                    {menu.categories.map((c) => {
                      const list = services.filter((s) => s.category_id === c.id && !p.serviceIds.includes(s.id));
                      return list.length ? <optgroup key={c.id} label={c.name}>{list.map((s) => <option key={s.id} value={s.id}>{s.name} · {money(s.price)}</option>)}</optgroup> : null;
                    })}
                    {services.filter((s) => (!s.category_id || !menu.categories.some((c) => c.id === s.category_id)) && !p.serviceIds.includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name} · {money(s.price)}</option>)}
                  </select>
                </div>
                <div className="row-wrap ev-person-foot">
                  <select className="select input-sm" value={p.staffId} aria-label={`Stylist for ${p.name || `person ${i + 1}`}`} onChange={(e) => setPerson(p.key, { staffId: e.target.value })}>
                    <option value="">Stylist later</option>
                    {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  {mins > 0 && <span className="tiny muted num">{mins} min · {p.time}–{addMinutes(p.time, mins)}</span>}
                </div>
              </div>
            );
          })}
          <datalist id="ev-guest-presets">{GUEST_PRESETS.map((g) => <option key={g} value={g} />)}</datalist>
          {people.length < 50 && (
            <div><Button size="sm" icon="plus" onClick={() => setPeople((cur) => [...cur, { key: ++personKey, name: '', serviceIds: [], staffId: staff[Math.min(cur.length, staff.length - 1)]?.id ?? '', time: cur[cur.length - 1]?.time ?? '06:00' }])}>Add a person</Button></div>
          )}
        </section>

        <section className="stack-sm">
          <Switch checked={trialOn} onChange={setTrialOn} label={<span className="small strong">Trial before the event</span>} />
          {trialOn && (
            <div className="ev-trial">
              <div className="grid-2">
                <TextField label="Trial date" type="date" value={trial.date} min={today} onChange={(e) => setTrial({ ...trial, date: e.target.value })} />
                <TextField label="Time" type="time" value={trial.time} onChange={(e) => setTrial({ ...trial, time: e.target.value })} />
              </div>
              <div className="grid-2">
                <div className="field"><label htmlFor="tr-svc">Service</label>
                  <select id="tr-svc" className="select" value={trial.serviceId} onChange={(e) => setTrial({ ...trial, serviceId: e.target.value })}>
                    <option value="">{bridalSuggest ? 'Choose…' : 'Choose a service…'}</option>
                    {services.map((s) => <option key={s.id} value={s.id}>{s.name} · {money(s.price)}</option>)}
                  </select></div>
                <div className="field"><label htmlFor="tr-st">Stylist</label>
                  <select id="tr-st" className="select" value={trial.staffId} onChange={(e) => setTrial({ ...trial, staffId: e.target.value })}>
                    <option value="">Later</option>
                    {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select></div>
              </div>
              <span className="hint">Billed on its own at the trial.</span>
            </div>
          )}
        </section>

        <section className="stack-sm">
          <span className="label">Where</span>
          <div><Segmented label="Where" value={where} onChange={setWhere} options={[{ value: 'salon', label: 'At the salon' }, { value: 'home', label: 'Home visit' }]} /></div>
          {where === 'home' && (
            <div className="stack-sm">
              <TextArea label="Address" rows={2} maxLength={240} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="House, ward, landmark" />
              <MoneyField id="ev-travel" label="Travel charge (added to the bill)" value={travel} onChange={setTravel} placeholder="e.g. 500" />
            </div>
          )}
        </section>

        <MoneyField id="ev-quote" label="Quoted price for the package (optional)" value={quote} onChange={setQuote} placeholder={menuTotal ? String(menuTotal) : 'e.g. 9000'} />
        <TextArea label="Notes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Theme, jewellery, hair accessories, anything to remember" />

        <section className="stack-sm ev-advance">
          <Switch checked={advOn} onChange={setAdvOn} label={<span className="small strong">Advance received now</span>} />
          {advOn && (
            <>
              <AdvanceFields amount={advAmount} setAmount={setAdvAmount} method={advMethod} setMethod={setAdvMethod} reference={advRef} setReference={setAdvRef} methods={methods}
                due={(quote.trim() ? parseAmount(quote) : menuTotal) + travelN} />
              <Switch checked={sendWa && waConnected} disabled={!waConnected} onChange={setSendWa}
                label={<span className="small">WhatsApp the receipt link to {first || 'the client'}{!waConnected && <span className="muted"> · connect WhatsApp in Settings</span>}</span>} />
              <p className="tiny muted">The client gets an advance receipt, not a tax invoice. It is applied on the final bill.</p>
            </>
          )}
        </section>
        {error && <Notice tone="error">{error}</Notice>}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

function addMinutes(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const t = (h * 60 + m + mins) % (24 * 60);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** The salon-local time of an ISO instant, for forms. */
export const timeOf = (iso: string, tz: string) => localTime(new Date(iso), tz);
