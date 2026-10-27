'use client';
import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Button, Dialog, Notice, Sheet, StatusBadge, Switch, TextArea, TextField, useToast } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { ClientPicker, ServicePicker, StaffSelect } from './pickers';
import { addWalkIn, createAppointment, findSlots, moveAppointment, setAppointmentStatus, type ClientLite } from '@/actions/appointments';
import { groupSlots, type Slot } from '@/lib/availability';
import { money } from '@/lib/billing';
import { formatPhone } from '@/lib/phone';
import { fmtDateLong, fmtHhmm, fmtTime, localDate, localTime, minutesToHhmm, zonedToUtc } from '@/lib/time';
import type { AppointmentFull, ApptStatus, Service, ServiceCategory, Staff } from '@/lib/types';
import { SOURCE_LABEL } from '@/lib/types';

export interface MenuProps { services: Service[]; categories: ServiceCategory[]; staff: Staff[]; tz: string; intervalMin: number }

function timeOptions(intervalMin: number) {
  const out: string[] = [];
  for (let m = 7 * 60; m <= 22 * 60; m += intervalMin) out.push(minutesToHhmm(m));
  return out;
}

/** Book an appointment (or add a walk-in to the queue) from the front desk. */
export function NewAppointmentSheet({ open, onClose, menu, date: initialDate, time: initialTime, staffId: initialStaff, mode = 'appointment' }: {
  open: boolean; onClose: () => void; menu: MenuProps; date: string; time?: string; staffId?: string; mode?: 'appointment' | 'walkin';
}) {
  const [client, setClient] = useState<ClientLite | null>(null);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [staffId, setStaffId] = useState(initialStaff ?? '');
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime ?? '');
  const [notes, setNotes] = useState('');
  const [notify, setNotify] = useState(true);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [finding, startFinding] = useTransition();
  const toast = useToast();
  const router = useRouter();

  useEffect(() => {
    if (open) {
      setClient(null); setServiceIds([]); setStaffId(initialStaff ?? ''); setDate(initialDate); setTime(initialTime ?? '');
      setNotes(''); setNotify(true); setSlots(null); setError(null);
    }
  }, [open, initialDate, initialTime, initialStaff]);

  useEffect(() => { setSlots(null); }, [serviceIds, staffId, date]);

  const isWalkIn = mode === 'walkin';
  const submit = () => start(async () => {
    setError(null);
    if (!client) return setError('Choose a client.');
    if (!serviceIds.length) return setError('Pick at least one service.');
    if (isWalkIn) {
      const r = await addWalkIn({ customerId: client.id, serviceIds, staffId: staffId || null, notes });
      if (!r.ok) return setError(r.error);
      toast(r.message ?? 'Added to queue');
    } else {
      if (!staffId) return setError('Choose a stylist.');
      if (!time) return setError('Pick a time.');
      const r = await createAppointment({ customerId: client.id, serviceIds, staffId, start: zonedToUtc(date, time, menu.tz).toISOString(), notes, notify });
      if (!r.ok) return setError(r.error);
      toast('Appointment booked');
    }
    router.refresh();
    onClose();
  });

  const lookForSlots = () => startFinding(async () => {
    setError(null);
    const r = await findSlots({ serviceIds, date, staffId: staffId || null });
    if (!r.ok) return setError(r.error);
    setSlots(r.data ?? []);
  });

  return (
    <Sheet open={open} onClose={onClose} title={isWalkIn ? 'Add walk-in' : 'New appointment'} width={520}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={pending} onClick={submit}>{isWalkIn ? 'Add to queue' : 'Book appointment'}</Button></>}>
      <div className="stack-lg">
        <section className="stack-sm"><span className="label">Client</span><ClientPicker value={client} onChange={setClient} /></section>
        <section className="stack-sm"><span className="label">Services</span><ServicePicker services={menu.services} categories={menu.categories} value={serviceIds} onChange={setServiceIds} /></section>
        <StaffSelect staff={menu.staff} value={staffId} onChange={setStaffId} allowAny={isWalkIn} label={isWalkIn ? 'Preferred stylist' : 'Stylist'} />
        {!isWalkIn && (
          <section className="stack-sm">
            <div className="grid-2">
              <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              <div className="field">
                <label htmlFor="appt-time">Time</label>
                <select id="appt-time" className="select" value={time} onChange={(e) => setTime(e.target.value)}>
                  <option value="">Choose…</option>
                  {timeOptions(menu.intervalMin).map((t) => <option key={t} value={t}>{fmtHhmm(t)}</option>)}
                </select>
              </div>
            </div>
            <Button size="sm" icon="search" loading={finding} disabled={!serviceIds.length} onClick={lookForSlots}>Show free times</Button>
            {slots && (slots.length ? (
              <div className="stack-sm">
                {groupSlots(slots).map((g) => (
                  <div key={g.label} className="stack-sm">
                    <div className="tiny muted">{g.label}</div>
                    <div className="row-wrap">
                      {g.slots.map((s) => (
                        <button key={s.time} type="button" className="chip num" aria-pressed={time === s.time && (!staffId || s.staffIds.includes(staffId))}
                          onClick={() => { setTime(s.time); if (!staffId || !s.staffIds.includes(staffId)) setStaffId(s.staffIds[0]); }}>
                          {fmtHhmm(s.time)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="small muted">No free time for these services on {fmtDateLong(date)}.</p>)}
          </section>
        )}
        <TextArea label="Notes" placeholder="Allergies, colour formula, preferences" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        {!isWalkIn && <Switch label="Send WhatsApp confirmation to the client" checked={notify} onChange={setNotify} />}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Sheet>
  );
}

const NEXT_ACTIONS: Partial<Record<ApptStatus, { status: ApptStatus; label: string; variant: 'primary' | 'secondary' }[]>> = {
  booked: [{ status: 'checked_in', label: 'Client arrived', variant: 'primary' }, { status: 'confirmed', label: 'Mark confirmed', variant: 'secondary' }],
  confirmed: [{ status: 'checked_in', label: 'Client arrived', variant: 'primary' }],
  checked_in: [{ status: 'in_service', label: 'Start service', variant: 'primary' }],
};

/** Details of one appointment with the actions the front desk needs. */
export function AppointmentSheet({ appt, onClose, menu, canBill }: { appt: AppointmentFull | null; onClose: () => void; menu: MenuProps; canBill: boolean }) {
  const [pending, start] = useTransition();
  const [moving, setMoving] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [moveDate, setMoveDate] = useState('');
  const [moveTime, setMoveTime] = useState('');
  const [moveStaff, setMoveStaff] = useState('');
  const toast = useToast();
  const router = useRouter();

  useEffect(() => {
    if (appt) {
      setMoving(false);
      setMoveDate(localDate(new Date(appt.start_at), menu.tz));
      setMoveTime(localTime(new Date(appt.start_at), menu.tz));
      setMoveStaff(appt.staff_id ?? '');
    }
  }, [appt, menu.tz]);

  const stylist = useMemo(() => menu.staff.find((s) => s.id === appt?.staff_id), [appt, menu.staff]);
  if (!appt) return null;
  const total = appt.services.reduce((s, x) => s + Number(x.price), 0);
  const act = (status: ApptStatus, reason?: string) => start(async () => {
    const r = await setAppointmentStatus(appt.id, status, reason);
    if (!r.ok) return toast(r.error, 'error');
    router.refresh();
    onClose();
  });
  const finished = ['completed', 'cancelled', 'no_show'].includes(appt.status);
  const waLink = `https://wa.me/${appt.customer.phone}`;

  return (
    <>
      <Sheet open={!!appt} onClose={onClose} title={<div className="row"><h2>{appt.customer.name}</h2><StatusBadge status={appt.status} /></div>}
        footer={!finished && (
          <>
            {appt.status === 'in_service' && canBill && (
              <Link className="btn btn-primary" href={`/app/pos?appointment=${appt.id}`}><Icon name="receipt" />Check out</Link>
            )}
            {(NEXT_ACTIONS[appt.status] ?? []).map((a) => (
              <Button key={a.status} variant={a.variant} loading={pending} onClick={() => act(a.status)}>{a.label}</Button>
            ))}
            {['checked_in'].includes(appt.status) && canBill && (
              <Link className="btn btn-secondary" href={`/app/pos?appointment=${appt.id}`}>Check out</Link>
            )}
          </>
        )}>
        <div className="stack-lg">
          <div className="stack-sm">
            <div className="row"><Icon name="clock" size={17} className="muted" /><span className="num">{fmtDateLong(localDate(new Date(appt.start_at), menu.tz))} · {fmtTime(appt.start_at, menu.tz)} – {fmtTime(appt.end_at, menu.tz)}</span></div>
            <div className="row"><span className="dot" style={{ background: stylist?.color ?? '#999', marginLeft: 4, marginRight: 4 }} /><span>{stylist?.name ?? 'Any stylist'}</span></div>
            <div className="row"><Icon name="phone" size={17} className="muted" /><a href={`tel:+${appt.customer.phone}`}>{formatPhone(appt.customer.phone)}</a>
              <a className="btn btn-ghost btn-sm" href={waLink} target="_blank" rel="noreferrer"><Icon name="whatsapp" size={16} />WhatsApp</a></div>
            <div className="row-wrap">
              <Badge tone="outline">{SOURCE_LABEL[appt.source]}</Badge>
              {appt.token_no && <Badge tone="marigold">Token {appt.token_no}</Badge>}
              <Badge>{appt.customer.visit_count ? `${appt.customer.visit_count} past visits` : 'First visit'}</Badge>
            </div>
          </div>

          <div className="panel">
            <ul className="list">
              {appt.services.map((s, i) => (
                <li key={i} className="between"><span>{s.name} <span className="muted small">· {s.duration_min} min</span></span><span className="num">{money(s.price)}</span></li>
              ))}
              <li className="between strong"><span>Estimated total</span><span className="num">{money(total)}</span></li>
            </ul>
          </div>

          {(appt.notes || appt.customer.notes) && (
            <div className="stack-sm">
              {appt.notes && <Notice>{appt.notes}</Notice>}
              {appt.customer.notes && <div className="small ink2"><span className="strong">Client notes: </span>{appt.customer.notes}</div>}
            </div>
          )}
          {appt.status === 'cancelled' && appt.cancelled_reason && <Notice tone="warn">Cancelled: {appt.cancelled_reason}</Notice>}

          {!finished && (
            moving ? (
              <div className="panel stack" style={{ padding: 14 }}>
                <h3>Move appointment</h3>
                <div className="grid-2">
                  <TextField label="Date" type="date" value={moveDate} onChange={(e) => setMoveDate(e.target.value)} />
                  <div className="field"><label htmlFor="mv-time">Time</label>
                    <select id="mv-time" className="select" value={moveTime} onChange={(e) => setMoveTime(e.target.value)}>
                      {timeOptions(menu.intervalMin).map((t) => <option key={t} value={t}>{fmtHhmm(t)}</option>)}
                    </select></div>
                </div>
                <StaffSelect staff={menu.staff} value={moveStaff} onChange={setMoveStaff} />
                <div className="row">
                  <Button variant="primary" loading={pending} onClick={() => start(async () => {
                    const r = await moveAppointment(appt.id, { start: zonedToUtc(moveDate, moveTime, menu.tz).toISOString(), staffId: moveStaff });
                    if (!r.ok) return toast(r.error, 'error');
                    toast('Appointment moved'); router.refresh(); onClose();
                  })}>Save new time</Button>
                  <Button variant="ghost" onClick={() => setMoving(false)}>Keep current time</Button>
                </div>
              </div>
            ) : (
              <div className="row-wrap">
                <Button size="sm" icon="calendar" onClick={() => setMoving(true)}>Move</Button>
                {['booked', 'confirmed'].includes(appt.status) && <Button size="sm" onClick={() => act('no_show')}>No-show</Button>}
                <Button size="sm" variant="danger" onClick={() => setConfirmCancel(true)}>Cancel appointment</Button>
              </div>
            )
          )}
          {appt.invoice_id && <Link href={`/app/invoices/${appt.invoice_id}`} className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}><Icon name="receipt" size={16} />View bill</Link>}
          {appt.status === 'no_show' && <Button size="sm" onClick={() => act('booked')}>Undo no-show</Button>}
        </div>
      </Sheet>
      <Dialog open={confirmCancel} onClose={() => setConfirmCancel(false)} title="Cancel this appointment?"
        footer={<><Button variant="ghost" onClick={() => setConfirmCancel(false)}>Keep it</Button>
          <Button variant="danger" loading={pending} onClick={() => { setConfirmCancel(false); act('cancelled', 'Cancelled by salon'); }}>Cancel appointment</Button></>}>
        <p className="ink2">{appt.customer.name}&apos;s slot will be freed for other bookings.</p>
      </Dialog>
    </>
  );
}
