// Weekly hours helpers shared by Settings (salon opening hours) and Team (stylist working hours).
// Pure and client-safe. Shape: { mon: [["10:00","20:00"]], tue: [], ... } — an empty or missing day means closed.
import type { Hours } from './types';
import { hhmmToMinutes } from './time';

export type WeekDay = keyof Hours;
export const WEEK_DAYS: WeekDay[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const WEEK_SHORT: Record<WeekDay, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
export const WEEK_LONG: Record<WeekDay, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Validate and normalise an hours object. Every day is present in the result (closed days as []). */
export function cleanHours(input: unknown): { ok: true; hours: Hours } | { ok: false; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Opening hours are missing. Refresh and try again.' };
  const src = input as Record<string, unknown>;
  const out: Hours = {};
  for (const day of WEEK_DAYS) {
    const raw = src[day];
    if (raw == null) { out[day] = []; continue; }
    if (!Array.isArray(raw) || raw.length > 3) return { ok: false, error: `Check the hours for ${WEEK_LONG[day]}.` };
    const windows: [string, string][] = [];
    for (const w of raw) {
      if (!Array.isArray(w) || w.length !== 2 || !HHMM.test(String(w[0])) || !HHMM.test(String(w[1]))) {
        return { ok: false, error: `Use times like 10:00 for ${WEEK_LONG[day]}.` };
      }
      const [a, b] = [String(w[0]), String(w[1])];
      if (hhmmToMinutes(a) >= hhmmToMinutes(b)) return { ok: false, error: `On ${WEEK_LONG[day]} the closing time must be after the opening time.` };
      windows.push([a, b]);
    }
    windows.sort((x, y) => hhmmToMinutes(x[0]) - hhmmToMinutes(y[0]));
    for (let i = 1; i < windows.length; i++) {
      if (hhmmToMinutes(windows[i][0]) < hhmmToMinutes(windows[i - 1][1])) return { ok: false, error: `The time ranges on ${WEEK_LONG[day]} overlap.` };
    }
    out[day] = windows;
  }
  return { ok: true, hours: out };
}

/** Days with at least one open window. */
export function openDays(hours: Hours | null | undefined): WeekDay[] {
  return WEEK_DAYS.filter((d) => (hours?.[d]?.length ?? 0) > 0);
}

/** "Every day", "Tue–Sun", "Mon, Wed, Fri" or "No days". */
export function daysLabel(days: WeekDay[]): string {
  if (!days.length) return 'No days';
  if (days.length === 7) return 'Every day';
  const idx = days.map((d) => WEEK_DAYS.indexOf(d)).sort((a, b) => a - b);
  const contiguous = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  if (contiguous && idx.length >= 3) return `${WEEK_SHORT[WEEK_DAYS[idx[0]]]}–${WEEK_SHORT[WEEK_DAYS[idx[idx.length - 1]]]}`;
  return idx.map((i) => WEEK_SHORT[WEEK_DAYS[i]]).join(', ');
}
