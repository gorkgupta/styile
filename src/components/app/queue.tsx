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

export interface QueueProps {
  salonId: string; today: string; nowIso: string; appointments: AppointmentFull[]; menu: MenuProps; canBill: boolean;
}

export function QueueBoard({ salonId, today, nowIso, appointments, menu, canBill }: QueueProps) {
  useLiveRefresh(salonId, ['appointments']);
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
      <Topbar title="Walk-in queue" subtitle={fmtDateLong(today)}
        actions={<Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add walk-in</Button>} />
      <div className="page">
        <div className="row-wrap">
          <Badge tone="marigold">{waiting.length} waiting</Badge>
          <Badge tone="peacock">{serving.length} in a chair</Badge>
          <Badge>{servedWalkIns} walk-ins served today</Badge>
          <span className="small muted" style={{ marginLeft: 'auto' }}>
            Free now: {freeNow.length ? freeNow.map((s) => s.name).join(', ') : 'nobody'}
          </span>
        </div>

        <div className="split">
          <Panel title="Waiting" flush>
            {waiting.length ? (
              <ul className="list">
                {waiting.map((w, i) => {
                  const pref = menu.staff.find((s) => s.id === w.staff_id);
                  const mins = minutes(w);
                  return (
                    <li key={w.id} className="row" style={{ gap: 14 }}>
                      <span className="token">{w.token_no}</span>
                      <div className="grow">
                        <div className="row"><span className="strong truncate">{w.customer.name}</span>{i === 0 && <Badge tone="peacock">Next</Badge>}</div>
                        <div className="small muted truncate">
                          {w.services.map((s) => s.name).join(', ')}{pref ? ` · prefers ${pref.name}` : ''}
                        </div>
                        <div className={`small num ${mins > 30 ? 'strong' : 'muted'}`} style={mins > 30 ? { color: 'var(--danger)' } : undefined}>
                          Waiting {mins} min · arrived {fmtTime(w.start_at, tz)}
                        </div>
                      </div>
                      <div className="row">
                        <Button size="sm" variant="ghost" onClick={() => start(async () => {
                          const r = await removeFromQueue(w.id);
                          if (!r.ok) toast(r.error, 'error'); else { toast(`${w.customer.name} removed from queue`); router.refresh(); }
                        })}>Left</Button>
                        <Button size="sm" variant="primary" onClick={() => { setStarting(w); setStaffId(w.staff_id && freeNow.some((s) => s.id === w.staff_id) ? w.staff_id : freeNow[0]?.id ?? ''); }}>Start</Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Empty icon="walkin" title="No one is waiting" action={<Button icon="plus" onClick={() => setAdding(true)}>Add walk-in</Button>}>
                Give each walk-in a token so they know their place in line.
              </Empty>
            )}
          </Panel>

          <Panel title="In the chair" flush>
            {serving.length ? (
              <ul className="list">
                {serving.map((a) => {
                  const s = menu.staff.find((x) => x.id === a.staff_id);
                  return (
                    <li key={a.id} className="row">
                      <Avatar name={s?.name ?? '?'} color={s?.color} size="sm" />
                      <div className="grow">
                        <div className="strong truncate">{a.customer.name}</div>
                        <div className="small muted truncate">{s?.name} · done by {fmtTime(a.end_at, tz)} · {money(a.services.reduce((x, y) => x + Number(y.price), 0))}</div>
                      </div>
                      {canBill && <Link className="btn btn-secondary btn-sm" href={`/app/pos?appointment=${a.id}`}>Check out</Link>}
                    </li>
                  );
                })}
              </ul>
            ) : <p className="panel-body small muted">Nobody is being served right now.</p>}
          </Panel>
        </div>
      </div>

      <NewAppointmentSheet open={adding} mode="walkin" onClose={() => setAdding(false)} menu={menu} date={today} />
      <Dialog open={!!starting} onClose={() => setStarting(null)} title={`Start service for ${starting?.customer.name ?? ''}`}
        footer={<><Button variant="ghost" onClick={() => setStarting(null)}>Not yet</Button>
          <Button variant="primary" loading={pending} onClick={() => start(async () => {
            if (!starting) return;
            const r = await startWalkIn(starting.id, staffId);
            if (!r.ok) return toast(r.error, 'error');
            toast(r.message ?? 'Started'); setStarting(null); router.refresh();
          })}>Start service</Button></>}>
        <StaffSelect staff={menu.staff} value={staffId} onChange={setStaffId} label="Who will serve them?" />
        {!freeNow.length && <p className="small muted">Everyone looks busy — the stylist you pick must be free now.</p>}
      </Dialog>
    </>
  );
}
