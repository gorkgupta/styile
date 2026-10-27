'use client';
import { useEffect, useMemo, useRef } from 'react';
import { groupSlots, type Slot } from '@/lib/availability';
import { addDays, dayKeyOf, fmtDateLong, fmtHhmm } from '@/lib/time';
import type { Hours } from '@/lib/types';

/** Weekday / day / month of a salon-local date. */
function dateParts(date: string): { wd: string; dd: string; mon: string } {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', ...o }).format(t);
  return { wd: f({ weekday: 'short' }), dd: String(d), mon: f({ month: 'short' }) };
}

export function bookableDays(today: string, windowDays: number, hours: Hours | null) {
  return Array.from({ length: windowDays + 1 }, (_, i) => {
    const date = addDays(today, i);
    return { date, open: hours ? !!hours[dayKeyOf(date)]?.length : true };
  });
}

/** Horizontally scrolling date pills: weekday + date, closed days disabled. */
export function DateStrip({ today, windowDays, hours, value, onChange }: { today: string; windowDays: number; hours: Hours | null; value: string; onChange: (d: string) => void }) {
  const days = useMemo(() => bookableDays(today, windowDays, hours), [today, windowDays, hours]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    const strip = ref.current;
    if (el && strip) {
      const left = el.offsetLeft - strip.offsetLeft;
      if (left < strip.scrollLeft || left + el.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollTo({ left: Math.max(0, left - 16) });
    }
  }, [value]);
  return (
    <div className="bk-dates" role="group" aria-label="Date" ref={ref}>
      {days.map((d) => {
        const { wd, dd, mon } = dateParts(d.date);
        const label = d.date === today ? 'Today' : d.date === addDays(today, 1) ? 'Tmrw' : wd;
        return (
          <button key={d.date} type="button" className="bk-date" aria-pressed={value === d.date} disabled={!d.open}
            onClick={() => onChange(d.date)} aria-label={`${fmtDateLong(d.date)}${d.open ? '' : ', closed'}`}>
            <span className="bk-date-wd">{label}</span>
            <span className="bk-date-d num">{dd}</span>
            <span className="bk-date-m">{d.open ? mon : 'Closed'}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Free times grouped into Morning / Afternoon / Evening. */
export function SlotGrid({ slots, value, onChange }: { slots: Slot[]; value: string | null; onChange: (s: Slot) => void }) {
  return (
    <div className="stack-lg">
      {groupSlots(slots).map((g) => (
        <div key={g.label} className="stack-sm">
          <div className="small muted strong">{g.label}</div>
          <div className="bk-times">
            {g.slots.map((s) => (
              <button key={s.start} type="button" className="chip bk-time num" aria-pressed={value === s.start} onClick={() => onChange(s)}>{fmtHhmm(s.time)}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
