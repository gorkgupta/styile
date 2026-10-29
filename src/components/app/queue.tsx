'use client';
import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Avatar, Badge, Button, Dialog, Empty, Panel, useToast } from '@/components/ui/ui';
import { Topbar } from './shell';
import { NewAppointmentSheet, type MenuProps } from './appointment-sheets';
import { StaffSelect } from './pickers';
import { useLiveRefresh } from './live';
import { removeFromQueue, startWalkIn } from '@/actions/appointments';
import { fmtTime, fmtDateLong } from '@/lib/time';
import { money } from '@/lib/billing';
import type { AppointmentFull } from '@/lib/types';
import { useT } from '@/lib/i18n/react';

export interface QueueProps {
  salonId: string; today: string; nowIso: string; appointments: AppointmentFull[]; menu: MenuProps; canBill: boolean;
}

export function QueueBoard({ salonId, today, nowIso, appointments, menu, canBill }: QueueProps) {
  useLiveRefresh(salonId, ['appointments']);
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [starting, setStarting] = useState<AppointmentFull | null>(null);
  const [staffId, setStaffId] = useState('');
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const now = new Date(nowIso).getTime();
  const tz = menu.tz;

  const waiting = useMemo(() => appointments.filter((a) => a.status === 'waiting').sort((a, b) => (a.token_no ?? 0) - (b.token_no ?? 0)), [appointments]);
  const serving = appointments.filter((a) => a.status === 'in_service');
  const servedWalkIns = appointments.filter((a) => a.source === 'walk_in' && a.status === 'completed').length;

  // A stylist is free if they have nothing in service and no appointment starting in the next 20 minutes.
  const freeNow = menu.staff.filter((s) => s.active && !appointments.some((a) =>
    a.staff_id === s.id && a.status !== 'waiting' && !['cancelled', 'no_show', 'completed'].includes(a.status) &&
    new Date(a.start_at).getTime() < now + 20 * 60000 && new Date(a.end_at).getTime() > now));

  const minutes = (a: AppointmentFull) => Math.max(0, Math.round((now - new Date(a.start_at).getTime()) / 60000));

  return (
    <>
      <Topbar title={t('queue.title')} subtitle={fmtDateLong(today, t.locale)}
        actions={<Button variant="primary" icon="plus" onClick={() => setAdding(true)}>{t('queue.add')}</Button>} />
      <div className="page">
        <div className="row-wrap">
          <Badge tone="marigold">{t('queue.nWaiting', { count: waiting.length })}</Badge>
          <Badge tone="peacock">{t('queue.nInChair', { count: serving.length })}</Badge>
          <Badge>{t('queue.served', { count: servedWalkIns })}</Badge>
          <span className="small muted" style={{ marginLeft: 'auto' }}>
            {t('queue.freeNow', { names: freeNow.length ? freeNow.map((s) => s.name).join(', ') : t('queue.nobody') })}
          </span>
        </div>

        <div className="split">
          <Panel title={t('status.waiting')} flush>
            {waiting.length ? (
              <ul className="list">
                {waiting.map((w, i) => {
                  const pref = menu.staff.find((s) => s.id === w.staff_id);
                  const mins = minutes(w);
                  return (
                    <li key={w.id} className="row" style={{ gap: 14 }}>
                      <span className="token">{w.token_no}</span>
                      <div className="grow">
                        <div className="row"><span className="strong truncate">{w.customer.name}</span>{i === 0 && <Badge tone="peacock">{t('queue.next')}</Badge>}</div>
                        <div className="small muted truncate">
                          {w.services.map((s) => s.name).join(', ')}{pref ? ` · ${t('queue.prefers', { name: pref.name })}` : ''}
                        </div>
                        <div className={`small num ${mins > 30 ? 'strong' : 'muted'}`} style={mins > 30 ? { color: 'var(--danger)' } : undefined}>
                          {t('queue.waitArrived', { m: mins, time: fmtTime(w.start_at, tz) })}
                        </div>
                      </div>
                      <div className="row">
                        <Button size="sm" variant="ghost" onClick={() => start(async () => {
                          const r = await removeFromQueue(w.id);
                          if (!r.ok) toast(t.err(r.error), 'error'); else { toast(t('queue.removed', { name: w.customer.name })); router.refresh(); }
                        })}>{t('queue.left')}</Button>
                        <Button size="sm" variant="primary" onClick={() => { setStarting(w); setStaffId(w.staff_id && freeNow.some((s) => s.id === w.staff_id) ? w.staff_id : freeNow[0]?.id ?? ''); }}>{t('queue.start')}</Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Empty icon="walkin" title={t('queue.noneWaiting')} action={<Button icon="plus" onClick={() => setAdding(true)}>{t('queue.add')}</Button>}>
                {t('queue.noneWaitingBody')}
              </Empty>
            )}
          </Panel>

          <Panel title={t('today.inChair')} flush>
            {serving.length ? (
              <ul className="list">
                {serving.map((a) => {
                  const s = menu.staff.find((x) => x.id === a.staff_id);
                  return (
                    <li key={a.id} className="row">
                      <Avatar name={s?.name ?? '?'} color={s?.color} size="sm" />
                      <div className="grow">
                        <div className="strong truncate">{a.customer.name}</div>
                        <div className="small muted truncate">{s?.name} · {t('queue.doneBy', { time: fmtTime(a.end_at, tz) })} · {money(a.services.reduce((x, y) => x + Number(y.price), 0))}</div>
                      </div>
                      {canBill && <Link className="btn btn-secondary btn-sm" href={`/app/pos?appointment=${a.id}`}>{t('appt.checkOut')}</Link>}
                    </li>
                  );
                })}
              </ul>
            ) : <p className="panel-body small muted">{t('queue.nobodyServed')}</p>}
          </Panel>
        </div>
      </div>

      <NewAppointmentSheet open={adding} mode="walkin" onClose={() => setAdding(false)} menu={menu} date={today} />
      <Dialog open={!!starting} onClose={() => setStarting(null)} title={t('queue.startFor', { name: starting?.customer.name ?? '' })}
        footer={<><Button variant="ghost" onClick={() => setStarting(null)}>{t('queue.notYet')}</Button>
          <Button variant="primary" loading={pending} onClick={() => start(async () => {
            if (!starting) return;
            const r = await startWalkIn(starting.id, staffId);
            if (!r.ok) return toast(t.err(r.error), 'error');
            toast(t('err.serviceStarted')); setStarting(null); router.refresh();
          })}>{t('appt.start')}</Button></>}>
        <StaffSelect staff={menu.staff} value={staffId} onChange={setStaffId} label={t('queue.whoServes')} />
        {!freeNow.length && <p className="small muted">{t('queue.allBusy')}</p>}
      </Dialog>
    </>
  );
}
