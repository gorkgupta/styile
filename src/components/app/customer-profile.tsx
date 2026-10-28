'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Avatar, Badge, Button, Dialog, Empty, Notice, Panel, Segmented, StatusBadge, useToast } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { Topbar } from './shell';
import { ClientFormSheet, isVip, TagBadges } from './customers';
import { InvoiceStatusBadge } from './billing-bits';
import { CoinsPanel, type CoinsPanelProps } from './coins';
import { MembershipPanel, PackagesPanel, type ClientBenefitsProps } from './client-packages';
import { deleteCustomer, saveCustomerNotes } from '@/actions/customers';
import { money } from '@/lib/billing';
import { formatPhone } from '@/lib/phone';
import { fmtDateYear, fmtMonthYear } from '@/lib/periods';
import { dateParts, fmtDateShort, fmtDayMonthYear, fmtTime, localDate } from '@/lib/time';
import type { ApptStatus, BookingSource, Customer, InvoiceStatus } from '@/lib/types';
import { useT } from '@/lib/i18n/react';
import { relativeAgoT } from '@/lib/i18n/format';

export interface ProfileAppointment {
  id: string; start_at: string; status: ApptStatus; source: BookingSource; staff_id: string | null;
  invoice_id: string | null; services: { name: string; price: number }[];
}
export interface ProfileInvoice { id: string; invoice_no: string; created_at: string; total: number; paid_total: number; status: InvoiceStatus }

export interface CustomerProfileProps {
  customer: Customer;
  appointments: ProfileAppointment[];
  /** null when the viewer's role can't see bills (stylists). */
  invoices: ProfileInvoice[] | null;
  staff: { id: string; name: string; color: string }[];
  today: string;
  nowIso: string;
  tz: string;
  canDelete: boolean;
  canBill: boolean;
  /** Coins panel; null when the viewer's role can't see coin history (stylists). */
  coins?: Omit<CoinsPanelProps, 'customer' | 'tz'> | null;
  /** Packages and membership cards (everyone sees them; selling depends on the role). */
  benefits?: Omit<ClientBenefitsProps, 'customer' | 'tz'> | null;
}

export function CustomerProfile({ customer: c, appointments, invoices, staff, today, nowIso, tz, canDelete, canBill, coins, benefits }: CustomerProfileProps) {
  const router = useRouter();
  const toast = useToast();
  const tr = useT();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notes, setNotes] = useState(c.notes ?? '');
  const [editingNotes, setEditingNotes] = useState(false);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');

  const now = new Date(nowIso).getTime();
  const upcoming = appointments
    .filter((a) => new Date(a.start_at).getTime() >= now - 3 * 3600000 && !['completed', 'cancelled', 'no_show'].includes(a.status))
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
  const past = appointments.filter((a) => !upcoming.includes(a)).sort((a, b) => b.start_at.localeCompare(a.start_at));
  const visits = c.visit_count;
  const spent = Number(c.total_spent);
  const liveBills = invoices?.filter((i) => i.status !== 'void') ?? [];
  const due = liveBills.reduce((s, i) => s + Math.max(Number(i.total) - Number(i.paid_total), 0), 0);
  const staffOf = (id: string | null) => staff.find((s) => s.id === id);
  const favourite = (() => {
    const counts = new Map<string, number>();
    for (const a of appointments) if (a.status === 'completed' && a.staff_id) counts.set(a.staff_id, (counts.get(a.staff_id) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return top && top[1] >= 2 ? staffOf(top[0]) : undefined;
  })();
  const coinBalance = Number(c.coin_balance ?? 0);
  const hasCoinHistory = (coins?.history.length ?? 0) > 0 || coinBalance > 0;
  const hasPackages = (benefits?.packages.length ?? 0) > 0 || (benefits?.memberships.length ?? 0) > 0;
  const hasHistory = appointments.length > 0 || (invoices?.length ?? 0) > 0 || hasCoinHistory || hasPackages;
  const shownAppts = tab === 'upcoming' ? upcoming : past;
  const bday = c.birthday ? fmtDayMonthYear(Number(c.birthday.slice(0, 4)), Number(c.birthday.slice(5, 7)), Number(c.birthday.slice(8, 10)), tr.locale, { year: false, month: 'long' }) : null;
  const ago = (iso: string) => relativeAgoT(tr, iso, today, tz);
  const bdaySoon = c.birthday ? (() => {
    const [, m, d] = c.birthday.split('-').map(Number);
    const [y, tm, td] = today.split('-').map(Number);
    let next = Date.UTC(y, m - 1, d);
    const t = Date.UTC(y, tm - 1, td);
    if (next < t) next = Date.UTC(y + 1, m - 1, d);
    return Math.round((next - t) / 86400000);
  })() : null;

  const saveNotes = () => start(async () => {
    const r = await saveCustomerNotes(c.id, notes);
    if (!r.ok) return toast(tr.err(r.error), 'error');
    toast(tr('err.notesSaved')); setEditingNotes(false); router.refresh();
  });
  const doDelete = () => start(async () => {
    setDeleteError(null);
    const r = await deleteCustomer(c.id);
    if (!r.ok) return setDeleteError(tr.err(r.error));
    toast(tr('err.clientDeleted')); router.push('/app/customers');
  });

  return (
    <>
      <Topbar back="/app/customers" title={c.name} subtitle={tr('cl.since', { month: fmtMonthYear(c.created_at, tz, tr.locale) })}
        actions={<>
          <Button icon="edit" onClick={() => setEditing(true)} aria-label={tr('cl.editShort')}><span className="hide-mobile">{tr('cl.editShort')}</span></Button>
          {canBill && <Link className="btn btn-secondary hide-mobile" href={`/app/pos?customer=${c.id}`}><Icon name="receipt" />{tr('nav.pos')}</Link>}
          <Link className="btn btn-primary" href="/app/calendar" aria-label={tr('appt.book')}><Icon name="calendar" /><span className="hide-mobile">{tr('appt.book')}</span></Link>
        </>} />
      <div className="page">
        <section className="profile-head panel">
          <Avatar name={c.name} size="lg" color={isVip(c.tags) ? 'var(--marigold-700)' : undefined} />
          <div className="grow stack-sm" style={{ gap: 4 }}>
            <div className="row-wrap">
              <h2>{c.name}</h2>
              <TagBadges tags={c.tags} />
            </div>
            <div className="row-wrap small ink2">
              <a href={`tel:+${c.phone}`} className="row num" style={{ gap: 5 }}><Icon name="phone" size={15} />{formatPhone(c.phone)}</a>
              <a href={`https://wa.me/${c.phone}`} target="_blank" rel="noreferrer" className="row" style={{ gap: 5 }}><Icon name="whatsapp" size={15} />{tr('source.whatsapp')}</a>
              {c.email && <a href={`mailto:${c.email}`} className="truncate">{c.email}</a>}
            </div>
            <div className="row-wrap tiny muted">
              {bday && <span className="row" style={{ gap: 4 }}><Icon name="gift" size={13} />{tr('cl.birthdayOn', { date: bday })}{bdaySoon !== null && bdaySoon <= 14 ? <Badge tone="marigold">{bdaySoon === 0 ? tr('cl.todayBang') : tr('time.inDays', { count: bdaySoon })}</Badge> : null}</span>}
              {favourite && <span className="row" style={{ gap: 4 }}><span className="dot" style={{ background: favourite.color }} />{tr('cl.usuallySees', { name: favourite.name })}</span>}
              {!c.marketing_opt_in && <span>{tr('cl.noOffers')}</span>}
            </div>
          </div>
        </section>

        <div className="stats">
          <div className="stat"><div className="stat-label">{tr('cl.visits')}</div><div className="stat-value">{visits}</div><div className="stat-sub">{c.last_visit_at ? tr('cl.lastVisitAgo', { ago: ago(c.last_visit_at) }) : tr('cl.noVisits')}</div></div>
          <div className="stat"><div className="stat-label">{tr('cl.totalSpent')}</div><div className="stat-value">{money(Math.round(spent))}</div>
            <div className="stat-sub">{due > 0 ? <span className="warn-text strong">{tr('pos.due', { money: money(Math.round(due)) })}</span> : tr('cl.nothingDue')}</div></div>
          <div className="stat"><div className="stat-label">{tr('cl.avgBill')}</div><div className="stat-value">{visits ? money(Math.round(spent / visits)) : '—'}</div><div className="stat-sub">{tr('cl.perVisit')}</div></div>
          <div className="stat"><div className="stat-label">{tr('cl.memberSince')}</div><div className="stat-value stat-value-sm">{fmtMonthYear(c.created_at, tz, tr.locale)}</div>
            <div className="stat-sub">{upcoming.length ? tr('cl.nUpcoming', { count: upcoming.length }) : tr('cl.nothingBooked')}</div></div>
        </div>

        <div className="split profile-grid">
          <div className="stack">
            <Panel flush title={<Segmented label={tr('today.appointments')} value={tab} onChange={setTab}
              options={[{ value: 'upcoming', label: `${tr('pt.upcoming')} · ${upcoming.length}` }, { value: 'past', label: `${tr('cl.past')} · ${past.length}` }]} />}>
              {shownAppts.length ? (
                <ul className="list">
                  {shownAppts.slice(0, 30).map((a) => {
                    const s = staffOf(a.staff_id);
                    const d = localDate(new Date(a.start_at), tz);
                    return (
                      <li key={a.id} className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
                        <div className="date-tile num" aria-hidden>
                          <span>{dateParts(d, tr.locale).mon}</span>
                          <strong>{Number(d.slice(8))}</strong>
                        </div>
                        <div className="grow">
                          <div className="strong truncate">{a.services.map((x) => x.name).join(', ') || tr('cl.appointment')}</div>
                          <div className="small muted truncate">
                            {d === today ? tr('time.today') : fmtDateShort(d, tr.locale)}{d.slice(0, 4) !== today.slice(0, 4) ? ` ${d.slice(0, 4)}` : ''} · {fmtTime(a.start_at, tz)}
                            {s ? <> · <span className="dot" style={{ background: s.color, verticalAlign: 'middle' }} /> {s.name}</> : ''}
                          </div>
                          {a.source !== 'staff' && <div className="tiny muted">{tr('cl.bookedVia', { source: tr(`source.${a.source}`) })}</div>}
                        </div>
                        <div className="stack-sm" style={{ alignItems: 'flex-end', gap: 4 }}>
                          <StatusBadge status={a.status} />
                          {a.invoice_id && invoices && <Link href={`/app/invoices/${a.invoice_id}`} className="tiny">{tr('appt.viewBill')}</Link>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : tab === 'upcoming' ? (
                <Empty icon="calendar" title={tr('cl.nothingBooked')} action={<Link className="btn btn-secondary btn-sm" href="/app/calendar"><Icon name="plus" size={16} />{tr('appt.book')}</Link>}>
                  {c.last_visit_at ? tr('cl.lastVisitWas', { ago: ago(c.last_visit_at) }) : tr('cl.bookFirst')}
                </Empty>
              ) : <p className="panel-body small muted">{tr('cl.noPast')}</p>}
            </Panel>

            {invoices && (
              <Panel flush title={tr('nav.bills')} actions={canBill ? <Link className="btn btn-ghost btn-sm" href={`/app/pos?customer=${c.id}`}><Icon name="plus" size={16} />{tr('nav.pos')}</Link> : undefined}>
                {invoices.length ? (
                  <ul className="list">
                    {invoices.map((i) => (
                      <li key={i.id} style={{ padding: 0 }}>
                        <Link href={`/app/invoices/${i.id}`} className={`list-link${i.status === 'void' ? ' is-void' : ''}`}>
                          <Icon name="receipt" size={18} className="muted" />
                          <div className="grow">
                            <div className="strong num">{i.invoice_no}</div>
                            <div className="tiny muted num">{fmtDateYear(i.created_at, tz, tr.locale)}</div>
                          </div>
                          <InvoiceStatusBadge status={i.status} />
                          <span className="num strong amount-cell" style={{ minWidth: 76, textAlign: 'right' }}>{money(i.total)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : <p className="panel-body small muted">{tr('cl.noBills')}</p>}
              </Panel>
            )}
          </div>

          <div className="stack">
            {benefits && (benefits.plans.length > 0 || benefits.memberships.length > 0) && (
              <MembershipPanel {...benefits} customer={{ id: c.id, name: c.name, coinBalance }} tz={tz} />
            )}
            {benefits && (benefits.menu.length > 0 || benefits.packages.length > 0 || benefits.canManage) && (
              <PackagesPanel {...benefits} customer={{ id: c.id, name: c.name, coinBalance }} tz={tz} />
            )}
            {coins && (coins.salon.enabled || hasCoinHistory) && (
              <CoinsPanel {...coins} customer={{ id: c.id, name: c.name, balance: coinBalance }} tz={tz} />
            )}
            <Panel title={tr('common.notes')} actions={!editingNotes && <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditingNotes(true)}>{notes ? tr('cl.editShort') : tr('pos.add')}</Button>}>
              {editingNotes ? (
                <div className="stack">
                  <textarea className="textarea" rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} autoFocus aria-label={tr('cl.notesAria')}
                    placeholder={tr('cl.notesPhLong')} />
                  <div className="row">
                    <Button variant="primary" size="sm" loading={pending} onClick={saveNotes}>{tr('cl.saveNotes')}</Button>
                    <Button variant="ghost" size="sm" onClick={() => { setNotes(c.notes ?? ''); setEditingNotes(false); }}>{tr('common.cancel')}</Button>
                  </div>
                </div>
              ) : notes ? (
                <p className="notes-text">{notes}</p>
              ) : (
                <p className="small muted">{tr('cl.notesEmpty')}</p>
              )}
            </Panel>
          </div>
        </div>
        {canDelete && (
          <div className="row no-print" style={{ justifyContent: 'flex-end' }}>
            <Button size="sm" variant="ghost" icon="trash" className="danger-text" onClick={() => { setDeleteError(null); setDeleting(true); }}>{tr('cl.delete')}</Button>
          </div>
        )}
      </div>

      <ClientFormSheet open={editing} onClose={() => setEditing(false)}
        initial={{ id: c.id, name: c.name, phone: c.phone, email: c.email, gender: c.gender, birthday: c.birthday, notes: c.notes, tags: c.tags, marketing_opt_in: c.marketing_opt_in }} />
      <Dialog open={deleting} onClose={() => setDeleting(false)} title={tr('cl.deleteTitle', { name: c.name })}
        footer={hasHistory
          ? <Button onClick={() => setDeleting(false)}>{tr('cl.ok')}</Button>
          : <><Button variant="ghost" onClick={() => setDeleting(false)}>{tr('cl.keep')}</Button><Button variant="danger" loading={pending} onClick={doDelete}>{tr('cl.delete')}</Button></>}>
        {hasHistory
          ? <Notice tone="warn">{tr('cl.cantDelete', { name: c.name, what: [
              appointments.length ? tr('cl.nAppointments', { count: appointments.length }) : '',
              invoices?.length ? tr('common.bills', { count: invoices.length }) : '',
              hasCoinHistory ? tr('cl.coinHistory') : '',
              hasPackages ? tr('cl.packagesOrCard') : '',
            ].filter(Boolean).join(', ') })}</Notice>
          : <p className="small ink2">{tr('cl.deleteBody')}</p>}
        {deleteError && <Notice tone="error">{deleteError}</Notice>}
      </Dialog>
    </>
  );
}
