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
import { fmtDateYear, fmtMonthYear, relativeAgo } from '@/lib/periods';
import { fmtDateShort, fmtTime, localDate } from '@/lib/time';
import type { ApptStatus, Customer, InvoiceStatus } from '@/lib/types';
import { SOURCE_LABEL, type BookingSource } from '@/lib/types';

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
  const bday = c.birthday ? new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(new Date(`${c.birthday}T00:00:00Z`)) : null;
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
    if (!r.ok) return toast(r.error, 'error');
    toast('Notes saved'); setEditingNotes(false); router.refresh();
  });
  const doDelete = () => start(async () => {
    setDeleteError(null);
    const r = await deleteCustomer(c.id);
    if (!r.ok) return setDeleteError(r.error);
    toast(r.message ?? 'Client deleted'); router.push('/app/customers');
  });

  return (
    <>
      <Topbar back="/app/customers" title={c.name} subtitle={`Client since ${fmtMonthYear(c.created_at, tz)}`}
        actions={<>
          <Button icon="edit" onClick={() => setEditing(true)}><span className="hide-mobile">Edit</span></Button>
          {canBill && <Link className="btn btn-secondary hide-mobile" href={`/app/pos?customer=${c.id}`}><Icon name="receipt" />New bill</Link>}
          <Link className="btn btn-primary" href="/app/calendar"><Icon name="calendar" /><span className="hide-mobile">Book appointment</span></Link>
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
              <a href={`https://wa.me/${c.phone}`} target="_blank" rel="noreferrer" className="row" style={{ gap: 5 }}><Icon name="whatsapp" size={15} />WhatsApp</a>
              {c.email && <a href={`mailto:${c.email}`} className="truncate">{c.email}</a>}
            </div>
            <div className="row-wrap tiny muted">
              {bday && <span className="row" style={{ gap: 4 }}><Icon name="gift" size={13} />Birthday {bday}{bdaySoon !== null && bdaySoon <= 14 ? <Badge tone="marigold">{bdaySoon === 0 ? 'Today!' : `in ${bdaySoon} day${bdaySoon > 1 ? 's' : ''}`}</Badge> : null}</span>}
              {favourite && <span className="row" style={{ gap: 4 }}><span className="dot" style={{ background: favourite.color }} />Usually sees {favourite.name}</span>}
              {!c.marketing_opt_in && <span>No offers on WhatsApp</span>}
            </div>
          </div>
        </section>

        <div className="stats">
          <div className="stat"><div className="stat-label">Visits</div><div className="stat-value">{visits}</div><div className="stat-sub">{c.last_visit_at ? `Last visit ${relativeAgo(c.last_visit_at, today, tz).toLowerCase()}` : "No visits yet"}</div></div>
          <div className="stat"><div className="stat-label">Total spent</div><div className="stat-value">{money(Math.round(spent))}</div>
            <div className="stat-sub">{due > 0 ? <span className="warn-text strong">{money(Math.round(due))} due</span> : 'Nothing due'}</div></div>
          <div className="stat"><div className="stat-label">Average bill</div><div className="stat-value">{visits ? money(Math.round(spent / visits)) : '—'}</div><div className="stat-sub">per visit</div></div>
          <div className="stat"><div className="stat-label">Member since</div><div className="stat-value stat-value-sm">{fmtMonthYear(c.created_at, tz)}</div>
            <div className="stat-sub">{upcoming.length ? `${upcoming.length} upcoming` : 'Nothing booked'}</div></div>
        </div>

        <div className="split profile-grid">
          <div className="stack">
            <Panel flush title={<Segmented label="Appointments" value={tab} onChange={setTab}
              options={[{ value: 'upcoming', label: `Upcoming · ${upcoming.length}` }, { value: 'past', label: `Past · ${past.length}` }]} />}>
              {shownAppts.length ? (
                <ul className="list">
                  {shownAppts.slice(0, 30).map((a) => {
                    const s = staffOf(a.staff_id);
                    const d = localDate(new Date(a.start_at), tz);
                    return (
                      <li key={a.id} className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
                        <div className="date-tile num" aria-hidden>
                          <span>{new Intl.DateTimeFormat('en-IN', { timeZone: tz, month: 'short' }).format(new Date(a.start_at))}</span>
                          <strong>{Number(d.slice(8))}</strong>
                        </div>
                        <div className="grow">
                          <div className="strong truncate">{a.services.map((x) => x.name).join(', ') || 'Appointment'}</div>
                          <div className="small muted truncate">
                            {d === today ? 'Today' : fmtDateShort(d)}{d.slice(0, 4) !== today.slice(0, 4) ? ` ${d.slice(0, 4)}` : ''} · {fmtTime(a.start_at, tz)}
                            {s ? <> · <span className="dot" style={{ background: s.color, verticalAlign: 'middle' }} /> {s.name}</> : ''}
                          </div>
                          {a.source !== 'staff' && <div className="tiny muted">Booked via {SOURCE_LABEL[a.source]}</div>}
                        </div>
                        <div className="stack-sm" style={{ alignItems: 'flex-end', gap: 4 }}>
                          <StatusBadge status={a.status} />
                          {a.invoice_id && invoices && <Link href={`/app/invoices/${a.invoice_id}`} className="tiny">View bill</Link>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : tab === 'upcoming' ? (
                <Empty icon="calendar" title="Nothing booked" action={<Link className="btn btn-secondary btn-sm" href="/app/calendar"><Icon name="plus" size={16} />Book appointment</Link>}>
                  {c.last_visit_at ? `Last visit was ${relativeAgo(c.last_visit_at, today, tz).toLowerCase()}.` : 'Book their first visit.'}
                </Empty>
              ) : <p className="panel-body small muted">No past appointments yet.</p>}
            </Panel>

            {invoices && (
              <Panel flush title="Bills" actions={canBill ? <Link className="btn btn-ghost btn-sm" href={`/app/pos?customer=${c.id}`}><Icon name="plus" size={16} />New bill</Link> : undefined}>
                {invoices.length ? (
                  <ul className="list">
                    {invoices.map((i) => (
                      <li key={i.id} style={{ padding: 0 }}>
                        <Link href={`/app/invoices/${i.id}`} className={`list-link${i.status === 'void' ? ' is-void' : ''}`}>
                          <Icon name="receipt" size={18} className="muted" />
                          <div className="grow">
                            <div className="strong num">{i.invoice_no}</div>
                            <div className="tiny muted num">{fmtDateYear(i.created_at, tz)}</div>
                          </div>
                          <InvoiceStatusBadge status={i.status} />
                          <span className="num strong amount-cell" style={{ minWidth: 76, textAlign: 'right' }}>{money(i.total)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : <p className="panel-body small muted">No bills yet.</p>}
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
            <Panel title="Notes" actions={!editingNotes && <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditingNotes(true)}>{notes ? 'Edit' : 'Add'}</Button>}>
              {editingNotes ? (
                <div className="stack">
                  <textarea className="textarea" rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} autoFocus aria-label="Client notes"
                    placeholder="Colour formula, allergies, preferences — visible to everyone at the salon" />
                  <div className="row">
                    <Button variant="primary" size="sm" loading={pending} onClick={saveNotes}>Save notes</Button>
                    <Button variant="ghost" size="sm" onClick={() => { setNotes(c.notes ?? ''); setEditingNotes(false); }}>Cancel</Button>
                  </div>
                </div>
              ) : notes ? (
                <p className="notes-text">{notes}</p>
              ) : (
                <p className="small muted">Add colour formulas, allergies or preferences so every stylist knows.</p>
              )}
            </Panel>
          </div>
        </div>
        {canDelete && (
          <div className="row no-print" style={{ justifyContent: 'flex-end' }}>
            <Button size="sm" variant="ghost" icon="trash" className="danger-text" onClick={() => { setDeleteError(null); setDeleting(true); }}>Delete client</Button>
          </div>
        )}
      </div>

      <ClientFormSheet open={editing} onClose={() => setEditing(false)}
        initial={{ id: c.id, name: c.name, phone: c.phone, email: c.email, gender: c.gender, birthday: c.birthday, notes: c.notes, tags: c.tags, marketing_opt_in: c.marketing_opt_in }} />
      <Dialog open={deleting} onClose={() => setDeleting(false)} title={`Delete ${c.name}?`}
        footer={hasHistory
          ? <Button onClick={() => setDeleting(false)}>OK</Button>
          : <><Button variant="ghost" onClick={() => setDeleting(false)}>Keep client</Button><Button variant="danger" loading={pending} onClick={doDelete}>Delete client</Button></>}>
        {hasHistory
          ? <Notice tone="warn">{c.name} has {[
              appointments.length ? `${appointments.length} appointment${appointments.length > 1 ? 's' : ''}` : '',
              invoices?.length ? `${invoices.length} bill${invoices.length > 1 ? 's' : ''}` : '',
              hasCoinHistory ? 'coin history' : '',
              hasPackages ? 'packages or a membership card' : '',
            ].filter(Boolean).join(' and ')} on record, so they can’t be deleted — that history is needed for your records and GST. Edit their details instead.</Notice>
          : <p className="small ink2">This permanently removes their contact details and notes.</p>}
        {deleteError && <Notice tone="error">{deleteError}</Notice>}
      </Dialog>
    </>
  );
}
