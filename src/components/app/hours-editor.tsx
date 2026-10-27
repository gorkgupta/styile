'use client';
import { Switch } from '@/components/ui/ui';
import { WEEK_DAYS, WEEK_LONG, WEEK_SHORT, type WeekDay } from '@/lib/hours';
import { fmtHhmm, minutesToHhmm } from '@/lib/time';
import type { Hours } from '@/lib/types';

const STEP = 30;
const BASE_TIMES: string[] = Array.from({ length: (24 * 60) / STEP }, (_, i) => minutesToHhmm(i * STEP));

function timeOptions(current: string) {
  return BASE_TIMES.includes(current) ? BASE_TIMES : [...BASE_TIMES, current].sort();
}

/**
 * One row per weekday: open/closed switch and a start–end time pair.
 * Edits the first window of each day; extra windows (split shifts set elsewhere) are kept as they are.
 */
export function HoursEditor({ value, onChange, fallback = ['10:00', '20:00'], idPrefix = 'hours', closedLabel = 'Closed' }: {
  value: Hours; onChange: (h: Hours) => void; fallback?: [string, string]; idPrefix?: string; closedLabel?: string;
}) {
  const setDay = (day: WeekDay, windows: [string, string][]) => onChange({ ...value, [day]: windows });

  return (
    <div className="hours-editor" role="group" aria-label="Weekly hours">
      {WEEK_DAYS.map((day) => {
        const windows = value[day] ?? [];
        const open = windows.length > 0;
        const [start, end] = windows[0] ?? fallback;
        const invalid = open && start >= end;
        return (
          <div key={day} className="hours-row">
            <div className="hours-day">
              <Switch checked={open} onChange={(on) => setDay(day, on ? [[start, end]] : [])}
                label={<><span className="hide-mobile">{WEEK_LONG[day]}</span><span className="show-mobile">{WEEK_SHORT[day]}</span></>} />
            </div>
            {open ? (
              <div className="hours-times">
                <label className="sr-only" htmlFor={`${idPrefix}-${day}-from`}>{WEEK_LONG[day]} opens</label>
                <select id={`${idPrefix}-${day}-from`} className="select input-sm" value={start} aria-invalid={invalid || undefined}
                  onChange={(e) => setDay(day, [[e.target.value, end], ...windows.slice(1)])}>
                  {timeOptions(start).map((t) => <option key={t} value={t}>{fmtHhmm(t)}</option>)}
                </select>
                <span className="muted small">to</span>
                <label className="sr-only" htmlFor={`${idPrefix}-${day}-to`}>{WEEK_LONG[day]} closes</label>
                <select id={`${idPrefix}-${day}-to`} className="select input-sm" value={end} aria-invalid={invalid || undefined}
                  onChange={(e) => setDay(day, [[start, e.target.value], ...windows.slice(1)])}>
                  {timeOptions(end).map((t) => <option key={t} value={t}>{fmtHhmm(t)}</option>)}
                </select>
                {windows.length > 1 && <span className="tiny muted nowrap">+{windows.length - 1} more</span>}
              </div>
            ) : (
              <div className="hours-times"><span className="muted small">{closedLabel}</span></div>
            )}
          </div>
        );
      })}
    </div>
  );
}
