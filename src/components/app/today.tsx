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
import { rich, useT } from '@/lib/i18n/react';
import type { Translator } from '@/lib/i18n/core';

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

function greeting(t: Translator, nowIso: string, tz: string, name: string) {
  const h = Number(new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: 'numeric', hour12: false }).format(new Date(nowIso)));
  return t(h < 12 ? 'today.morning' : h < 17 ? 'today.afternoon' : 'today.evening', { name });
}

export function TodayView(p: TodayProps) {
  useLiveRefresh(p.salon.id, ['appointments']);
  const t = useT();
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
    { done: p.teamSize > 1, label: t('today.setupStylists'), href: '/app/staff' },
    // Unregistered salons are done (they chose it at sign-up); registered ones need their GSTIN on bills.
    { done: p.salon.gstMode === 'unregistered' || !!p.salon.gstin, label: t('today.setupGst'), href: '/app/settings#billing' },
    { done: p.salon.waConnected, label: t('today.setupWa'), href: '/app/settings#whatsapp' },
  ];
  const showSetup = p.isOwner && (p.welcome || setupSteps.some((s) => !s.done));

  return (
    <>
      <Topbar
        title={greeting(t, p.nowIso, tz, p.userName)}
        subtitle={fmtDateLong(p.today, t.locale)}
        actions={<>
          {p.newEvent && <Button icon="heart" className="hide-mobile" onClick={() => setEventOpen(true)}>{t('today.newEvent')}</Button>}
          <Button icon="walkin" onClick={() => setNewOpen('walkin')} aria-label={t('common.walkIn')}><span className="hide-mobile">{t('common.walkIn')}</span></Button>
          <Button variant="primary" icon="plus" onClick={() => setNewOpen('appointment')} aria-label={t('appt.new')}><span className="hide-mobile">{t('appt.new')}</span></Button>
        </>}
      />
      <div className="page">
        {p.denied && <Notice tone="warn">{t('today.denied')}</Notice>}
        {p.unclosedDay && (
          <Notice tone="warn">
            {rich(t('today.unclosed', { date: fmtDateShort(p.unclosedDay, t.locale) }), { link: <Link href={`/app/close?date=${p.unclosedDay}`} className="strong">{t('today.unclosedLink')}</Link> })}
          </Notice>
        )}

        <div className="stats">
          {p.revenueToday !== null && <Stat label={t('today.billed')} value={money(p.revenueToday)} sub={t('today.checkedOut', { count: done.length })} />}
          <Stat label={t('today.appointments')} value={booked.length} sub={t('today.toCome', { count: upcoming.length })} />
          <Stat label={t('today.waitingNow')} value={waiting.length} sub={waiting.length ? t('today.longestWait', { m: Math.max(...waiting.map((w) => Math.round((now - new Date(w.start_at).getTime()) / 60000))) }) : t('today.noQueue')} />
          <Stat label={t('today.onWhatsApp')} value={whatsapp.length} sub={p.needsAttention ? t('today.chatsNeedReply', { count: p.needsAttention }) : t('today.botHandling')} />
        </div>

        {showSetup && (
          <Panel title={t('today.setup')} actions={<Badge tone="peacock">{t('today.setupDone', { done: setupSteps.filter((s) => s.done).length, total: setupSteps.length + 1 })}</Badge>}>
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
                <span className="strong">{t('today.shareLink')}</span>
                <code className="small hide-mobile" style={{ background: 'var(--paper)', padding: '2px 8px', borderRadius: 6 }}>{bookingUrl.replace(/^https?:\/\//, '')}</code>
                <Button size="sm" icon="copy" onClick={() => { navigator.clipboard?.writeText(bookingUrl); toast(t('today.linkCopied')); }}>{t('common.copy')}</Button>
              </div>
            </div>
          </Panel>
        )}

        <div className="split">
          <Panel title={t('today.upNext')} flush actions={<Link href="/app/calendar" className="btn btn-ghost btn-sm">{t('today.openCalendar')}</Link>}>
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
                          <div className="small muted truncate">{a.services.map((s) => s.name).join(', ')} · {stylist?.name ?? t('today.unassigned')}</div>
                        </div>
                        {late ? <Badge tone="danger">{t('today.late')}</Badge> : <StatusBadge status={a.status} />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Empty icon="calendar" title={t('today.nothingElse')} action={<Button icon="plus" onClick={() => setNewOpen('appointment')}>{t('pt.book')}</Button>}>
                {t('today.nothingElseBody')}
              </Empty>
            )}
          </Panel>

          <div className="stack">
            <Panel title={t('today.inChair')} flush>
              {inChair.length ? (
                <ul className="list">
                  {inChair.map((a) => (
                    <li key={a.id} className="row">
                      <Avatar name={a.customer.name} size="sm" color={p.menu.staff.find((s) => s.id === a.staff_id)?.color} />
                      <div className="grow">
                        <div className="strong truncate">{a.customer.name}</div>
                        <div className="small muted">{t('today.until', { time: fmtTime(a.end_at, tz) })}</div>
                      </div>
                      {p.canBill && <Link className="btn btn-primary btn-sm" href={`/app/pos?appointment=${a.id}`}>{t('appt.checkOut')}</Link>}
                    </li>
                  ))}
                </ul>
              ) : <p className="panel-body muted small">{t('today.noOneInChair')}</p>}
            </Panel>
            <Panel title={t('queue.title')} flush actions={<Link href="/app/queue" className="btn btn-ghost btn-sm">{t('today.manageQueue')}</Link>}>
              {waiting.length ? (
                <ul className="list">
                  {waiting.slice(0, 5).map((w) => (
                    <li key={w.id} className="row">
                      <span className="token" style={{ width: 38, height: 38, fontSize: 15 }}>{w.token_no}</span>
                      <div className="grow">
                        <div className="strong truncate">{w.customer.name}</div>
                        <div className="small muted">{t('today.waitingMin', { m: Math.max(0, Math.round((now - new Date(w.start_at).getTime()) / 60000)) })}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <p className="panel-body muted small">{t('today.nobodyWaiting')}</p>}
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
