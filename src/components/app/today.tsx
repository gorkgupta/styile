'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Avatar, Badge, Button, Empty, Notice, Panel, Stat, StatusBadge, useToast } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { Topbar } from './shell';
import { AppointmentSheet, NewAppointmentSheet, type MenuProps } from './appointment-sheets';
import { NewEventSheet } from './events';
import { useLiveRefresh } from './live';
import { money } from '@/lib/billing';
import { rootDomain, salonUrl } from '@/lib/tenant';
import { fmtDateLong, fmtDateShort, fmtTime } from '@/lib/time';
import type { AppointmentFull, PayMethod } from '@/lib/types';

export interface TodayProps {
  salon: { id: string; name: string; slug: string; waConnected: boolean; gstin: string | null; gstMode?: 'unregistered' | 'composition' | 'regular' };
  userName: string;
  today: string;
  nowIso: string;
  appointments: AppointmentFull[];
  revenueToday: number | null;
  needsAttention: number;
  teamSize: number;
  menu: MenuProps;
  canBill: boolean;
  isOwner: boolean;
  welcome?: boolean;
  denied?: boolean;
  /** Yesterday had payments but wasn't closed (shown to roles that can close the day). */
  unclosedDay?: string | null;
  /** Front desk and above can book bridal / group events from here. */
  newEvent?: { methods?: PayMethod[]; waConnected: boolean } | null;
}

function greeting(nowIso: string, tz: string) {
  const h = Number(new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: 'numeric', hour12: false }).format(new Date(nowIso)));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function TodayView(p: TodayProps) {
  useLiveRefresh(p.salon.id, ['appointments']);
  const [newOpen, setNewOpen] = useState<'appointment' | 'walkin' | null>(null);
  const [eventOpen, setEventOpen] = useState(false);
  const [selected, setSelected] = useState<AppointmentFull | null>(null);
  const toast = useToast();
  const now = new Date(p.nowIso).getTime();
  const tz = p.menu.tz;

  const { upcoming, inChair, waiting, done, booked, whatsapp } = useMemo(() => {
    const active = p.appointments.filter((a) => !['cancelled', 'no_show'].includes(a.status));
    return {
      upcoming: active.filter((a) => ['booked', 'confirmed', 'checked_in'].includes(a.status)).sort((a, b) => a.start_at.localeCompare(b.start_at)),
      inChair: active.filter((a) => a.status === 'in_service'),
      waiting: active.filter((a) => a.status === 'waiting'),
      done: active.filter((a) => a.status === 'completed'),
      booked: active.filter((a) => a.status !== 'waiting'),
      whatsapp: active.filter((a) => a.source === 'whatsapp'),
    };
  }, [p.appointments]);

  const bookingUrl = rootDomain() ? salonUrl(p.salon.slug) : typeof window !== 'undefined' ? `${window.location.origin}/s/${p.salon.slug}` : `/s/${p.salon.slug}`;
  const setupSteps = [
    { done: p.teamSize > 1, label: 'Add your stylists', href: '/app/staff' },
    // Unregistered salons are done (they chose it at sign-up); registered ones need their GSTIN on bills.
    { done: p.salon.gstMode === 'unregistered' || !!p.salon.gstin, label: 'Set your GST status for bills', href: '/app/settings#billing' },
    { done: p.salon.waConnected, label: 'Connect your WhatsApp number', href: '/app/settings#whatsapp' },
  ];
  const showSetup = p.isOwner && (p.welcome || setupSteps.some((s) => !s.done));

  return (
    <>
      <Topbar
        title={`${greeting(p.nowIso, tz)}, ${p.userName}`}
        subtitle={fmtDateLong(p.today)}
        actions={<>
          {p.newEvent && <Button icon="heart" className="hide-mobile" onClick={() => setEventOpen(true)}>New event</Button>}
          <Button icon="walkin" onClick={() => setNewOpen('walkin')}><span className="hide-mobile">Walk-in</span></Button>
          <Button variant="primary" icon="plus" onClick={() => setNewOpen('appointment')}><span className="hide-mobile">New appointment</span></Button>
        </>}
      />
      <div className="page">
        {p.denied && <Notice tone="warn">Your role doesn&apos;t have access to that page. Ask the salon owner if you need it.</Notice>}
        {p.unclosedDay && (
          <Notice tone="warn">
            Yesterday ({fmtDateShort(p.unclosedDay)}) wasn&apos;t closed. <Link href={`/app/close?date=${p.unclosedDay}`} className="strong">Count the cash and close it</Link> so today starts from the right opening cash.
          </Notice>
        )}

        <div className="stats">
          {p.revenueToday !== null && <Stat label="Billed today" value={money(p.revenueToday)} sub={`${done.length} client${done.length === 1 ? '' : 's'} checked out`} />}
          <Stat label="Appointments" value={booked.length} sub={`${upcoming.length} still to come`} />
          <Stat label="Waiting now" value={waiting.length} sub={waiting.length ? `Longest wait ${Math.max(...waiting.map((w) => Math.round((now - new Date(w.start_at).getTime()) / 60000)))} min` : 'No queue'} />
          <Stat label="Booked on WhatsApp" value={whatsapp.length} sub={p.needsAttention ? `${p.needsAttention} chat${p.needsAttention > 1 ? 's need' : ' needs'} a reply` : 'Assistant handling chats'} />
        </div>

        {showSetup && (
          <Panel title="Finish setting up" actions={<Badge tone="peacock">{setupSteps.filter((s) => s.done).length} of {setupSteps.length + 1} done</Badge>}>
            <div className="stack">
              {setupSteps.map((s) => (
                <Link key={s.label} href={s.href} className="row" style={{ color: 'inherit' }}>
                  <span className="avatar avatar-sm" style={{ background: s.done ? 'var(--success)' : 'var(--line-strong)' }}>{s.done ? <Icon name="check" size={14} /> : ''}</span>
                  <span className={s.done ? 'muted' : 'strong'} style={s.done ? { textDecoration: 'line-through' } : undefined}>{s.label}</span>
                  {!s.done && <Icon name="chevronRight" size={16} className="muted" />}
                </Link>
              ))}
              <div className="row">
                <span className="avatar avatar-sm" style={{ background: 'var(--line-strong)' }} />
                <span className="strong">Share your booking link</span>
                <code className="small hide-mobile" style={{ background: 'var(--paper)', padding: '2px 8px', borderRadius: 6 }}>{bookingUrl.replace(/^https?:\/\//, '')}</code>
                <Button size="sm" icon="copy" onClick={() => { navigator.clipboard?.writeText(bookingUrl); toast('Booking link copied'); }}>Copy</Button>
              </div>
            </div>
          </Panel>
        )}

        <div className="split">
          <Panel title="Up next" flush actions={<Link href="/app/calendar" className="btn btn-ghost btn-sm">Open calendar</Link>}>
            {upcoming.length ? (
              <ul className="list">
                {upcoming.slice(0, 8).map((a) => {
                  const stylist = p.menu.staff.find((s) => s.id === a.staff_id);
                  const late = a.status !== 'checked_in' && new Date(a.start_at).getTime() < now;
                  return (
                    <li key={a.id} style={{ padding: 0 }}>
                      <button type="button" onClick={() => setSelected(a)} className="row"
                        style={{ width: '100%', padding: '12px 18px', background: 'none', border: 0, cursor: 'pointer', textAlign: 'left', gap: 14 }}>
                        <div className="num strong nowrap" style={{ width: 76, flex: 'none' }}>{fmtTime(a.start_at, tz)}</div>
                        <span className="dot" style={{ background: stylist?.color ?? '#999' }} />
                        <div className="grow">
                          <div className="strong truncate">{a.customer.name}</div>
                          <div className="small muted truncate">{a.services.map((s) => s.name).join(', ')} · {stylist?.name ?? 'Unassigned'}</div>
                        </div>
                        {late ? <Badge tone="danger">Late</Badge> : <StatusBadge status={a.status} />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Empty icon="calendar" title="Nothing else booked today" action={<Button icon="plus" onClick={() => setNewOpen('appointment')}>Book an appointment</Button>}>
                New bookings from WhatsApp and your booking page appear here automatically.
              </Empty>
            )}
          </Panel>

          <div className="stack">
            <Panel title="In the chair" flush>
              {inChair.length ? (
                <ul className="list">
                  {inChair.map((a) => (
                    <li key={a.id} className="row">
                      <Avatar name={a.customer.name} size="sm" color={p.menu.staff.find((s) => s.id === a.staff_id)?.color} />
                      <div className="grow">
                        <div className="strong truncate">{a.customer.name}</div>
                        <div className="small muted">until {fmtTime(a.end_at, tz)}</div>
                      </div>
                      {p.canBill && <Link className="btn btn-primary btn-sm" href={`/app/pos?appointment=${a.id}`}>Check out</Link>}
                    </li>
                  ))}
                </ul>
              ) : <p className="panel-body muted small">No one in a chair right now.</p>}
            </Panel>
            <Panel title="Walk-in queue" flush actions={<Link href="/app/queue" className="btn btn-ghost btn-sm">Manage</Link>}>
              {waiting.length ? (
                <ul className="list">
                  {waiting.slice(0, 5).map((w) => (
                    <li key={w.id} className="row">
                      <span className="token" style={{ width: 38, height: 38, fontSize: 15 }}>{w.token_no}</span>
                      <div className="grow">
                        <div className="strong truncate">{w.customer.name}</div>
                        <div className="small muted">waiting {Math.max(0, Math.round((now - new Date(w.start_at).getTime()) / 60000))} min</div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <p className="panel-body muted small">Nobody waiting. Add walk-ins as they arrive.</p>}
            </Panel>
          </div>
        </div>
      </div>
      <NewAppointmentSheet open={!!newOpen} mode={newOpen ?? 'appointment'} onClose={() => setNewOpen(null)} menu={p.menu} date={p.today} />
      {p.newEvent && <NewEventSheet open={eventOpen} onClose={() => setEventOpen(false)} menu={p.menu} today={p.today} methods={p.newEvent.methods} waConnected={p.newEvent.waConnected} />}
      <AppointmentSheet appt={selected} onClose={() => setSelected(null)} menu={p.menu} canBill={p.canBill} />
    </>
  );
}
