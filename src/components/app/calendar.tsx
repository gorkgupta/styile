'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar, Button } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { Topbar } from './shell';
import { AppointmentSheet, NewAppointmentSheet, type MenuProps } from './appointment-sheets';
import { useLiveRefresh } from './live';
import { staffWindows } from '@/lib/availability';
import { addDays, fmtTime, localMinutes, minutesToHhmm, relativeDay, fmtDateLong, dayKeyOf } from '@/lib/time';
import type { AppointmentFull, Hours } from '@/lib/types';

const HOUR_PX = 72;

export interface CalendarProps {
  salonId: string;
  date: string;
  today: string;
  nowIso: string;
  branchHours: Hours;
  appointments: AppointmentFull[];
  menu: MenuProps;
  canBill: boolean;
  /** Stylists only see their own column by default. */
  myStaffId?: string | null;
}

export function CalendarBoard({ salonId, date, today, nowIso, branchHours, appointments, menu, canBill, myStaffId }: CalendarProps) {
  const router = useRouter();
  useLiveRefresh(salonId, ['appointments']);
  const [selected, setSelected] = useState<AppointmentFull | null>(null);
  const [draft, setDraft] = useState<{ time: string; staffId: string } | null>(null);
  const [onlyMine, setOnlyMine] = useState(!!myStaffId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tz = menu.tz;

  const columns = useMemo(
    () => menu.staff.filter((s) => s.active && (!onlyMine || s.id === myStaffId)),
    [menu.staff, onlyMine, myStaffId],
  );
  const booked = appointments.filter((a) => a.staff_id && a.status !== 'waiting');

  // Visible range: the day's opening hours, stretched to fit any appointment outside them.
  const [startMin, endMin] = useMemo(() => {
    const day = branchHours[dayKeyOf(date)] ?? [];
    let s = 9 * 60, e = 21 * 60;
    if (day.length) {
      s = Math.min(...day.map(([a]) => Number(a.slice(0, 2)) * 60));
      e = Math.max(...day.map(([, b]) => Math.ceil((Number(b.slice(0, 2)) * 60 + Number(b.slice(3))) / 60) * 60));
    }
    for (const a of booked) {
      s = Math.min(s, Math.floor(localMinutes(new Date(a.start_at), tz) / 60) * 60);
      e = Math.max(e, Math.ceil(localMinutes(new Date(a.end_at), tz) / 60) * 60);
    }
    return [s, Math.min(e, 24 * 60)];
  }, [branchHours, date, booked, tz]);

  const hours: number[] = [];
  for (let m = startMin; m < endMin; m += 60) hours.push(m);
  const height = ((endMin - startMin) / 60) * HOUR_PX;
  const y = (min: number) => ((min - startMin) / 60) * HOUR_PX;
  const now = new Date(nowIso);
  const nowMin = date === today ? localMinutes(now, tz) : null;

  // Scroll so "now" (or opening time) is in view on first paint.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && nowMin !== null) el.scrollTop = Math.max(0, y(nowMin) - 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const go = (d: string) => router.push(`/app/calendar?date=${d}`);
  const onColumnClick = (e: React.MouseEvent<HTMLDivElement>, staffId: string) => {
    if (e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const min = startMin + ((e.clientY - rect.top) / HOUR_PX) * 60;
    const snapped = Math.floor(min / menu.intervalMin) * menu.intervalMin;
    setDraft({ time: minutesToHhmm(snapped), staffId });
  };

  const gridCols = `64px repeat(${columns.length}, minmax(var(--col-min), 1fr))`;
  const counts = (id: string) => booked.filter((a) => a.staff_id === id && !['cancelled', 'no_show'].includes(a.status)).length;

  return (
    <>
      <Topbar
        title={relativeDay(date, today) === 'Today' ? 'Today’s calendar' : relativeDay(date, today)}
        subtitle={fmtDateLong(date)}
        actions={<Button variant="primary" icon="plus" onClick={() => setDraft({ time: '', staffId: '' })}><span className="hide-mobile">New appointment</span></Button>}
      />
      <div className="page">
        <div className="between" style={{ flexWrap: 'wrap' }}>
          <div className="row">
            <Button size="sm" icon="chevronLeft" aria-label="Previous day" onClick={() => go(addDays(date, -1))} />
            <Button size="sm" onClick={() => go(today)} disabled={date === today}>Today</Button>
            <Button size="sm" icon="chevronRight" aria-label="Next day" onClick={() => go(addDays(date, 1))} />
            <input type="date" className="input input-sm" style={{ width: 160 }} value={date} onChange={(e) => e.target.value && go(e.target.value)} aria-label="Pick a date" />
          </div>
          {myStaffId && (
            <div className="segmented" role="group" aria-label="Whose calendar">
              <button aria-pressed={onlyMine} onClick={() => setOnlyMine(true)}>My column</button>
              <button aria-pressed={!onlyMine} onClick={() => setOnlyMine(false)}>Everyone</button>
            </div>
          )}
        </div>

        <div className="cal">
          <div className="cal-scroll" ref={scrollRef}>
            <div className="cal-head" style={{ gridTemplateColumns: gridCols }}>
              <div className="cal-gutter" />
              {columns.map((s) => (
                <div key={s.id} className="cal-col-head">
                  <Avatar name={s.name} color={s.color} size="sm" />
                  <div style={{ minWidth: 0 }}>
                    <div className="strong small truncate">{s.name}</div>
                    <div className="tiny muted">{counts(s.id)} booked</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="cal-grid" style={{ gridTemplateColumns: gridCols, height }}>
              <div className="cal-gutter">
                {hours.map((m) => <div key={m} className="hour">{m === startMin ? '' : fmtTime(new Date(Date.UTC(2000, 0, 1, Math.floor(m / 60), 0)), 'UTC').replace(':00', '')}</div>)}
              </div>
              {columns.map((s) => {
                const windows = staffWindows(s.working_hours, branchHours, date);
                // shade time the stylist isn't working
                const off: [number, number][] = [];
                let cursor = startMin;
                for (const [a, b] of windows) { if (a > cursor) off.push([cursor, a]); cursor = Math.max(cursor, b); }
                if (cursor < endMin) off.push([cursor, endMin]);
                return (
                  <div key={s.id} className="cal-col" style={{ ['--hour' as string]: `${HOUR_PX}px` }} onClick={(e) => onColumnClick(e, s.id)}
                    role="presentation">
                    {off.map(([a, b]) => <div key={a} className="off" style={{ top: y(Math.max(a, startMin)), height: y(Math.min(b, endMin)) - y(Math.max(a, startMin)), pointerEvents: 'none' }} />)}
                    {booked.filter((a) => a.staff_id === s.id).map((a) => {
                      const top = y(localMinutes(new Date(a.start_at), tz));
                      const h = Math.max(y(localMinutes(new Date(a.end_at), tz)) - top - 2, 22);
                      const status = a.status === 'completed' ? 'is-done' : a.status === 'cancelled' || a.status === 'no_show' ? 'is-cancelled' : `is-${a.status}`;
                      return (
                        <button key={a.id} type="button" className={`appt ${status}`} onClick={() => setSelected(a)}
                          style={{ top, height: h, ['--appt-color' as string]: s.color }}
                          aria-label={`${a.customer.name}, ${fmtTime(a.start_at, tz)}`}>
                          <div className="appt-name truncate">{a.customer.name}</div>
                          {h > 34 && <div className="appt-meta truncate">{a.services.map((x) => x.name).join(', ')}</div>}
                          {h > 52 && <div className="appt-meta num">{fmtTime(a.start_at, tz)} – {fmtTime(a.end_at, tz)}</div>}
                          {a.source === 'whatsapp' && h > 34 && <Icon name="whatsapp" size={14} style={{ position: 'absolute', right: 7, top: 7, color: '#1f7a4d' }} />}
                        </button>
                      );
                    })}
                    {nowMin !== null && nowMin >= startMin && nowMin <= endMin && <div className="now-line" style={{ top: y(nowMin) }} />}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {!columns.length && <p className="muted">Add your team under Team to start booking.</p>}
      </div>

      <NewAppointmentSheet open={!!draft} onClose={() => setDraft(null)} menu={menu} date={date}
        time={draft?.time || undefined} staffId={draft?.staffId || undefined} />
      <AppointmentSheet appt={selected} onClose={() => setSelected(null)} menu={menu} canBill={canBill} />
    </>
  );
}

