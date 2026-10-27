// Time-zone helpers with no dependencies. All instants are stored as UTC (timestamptz);
// salon-facing dates ("2026-11-02") and times ("14:30") are always in the salon's time zone.

export type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
export const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const DAY_LABELS: Record<DayKey, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export interface ZonedParts { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: DayKey }

export function zonedParts(date: Date, tz: string): ZonedParts {
  const p: Record<string, string> = {};
  for (const part of partsFormatter(tz).formatToParts(date)) p[part.type] = part.value;
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour) % 24, minute: Number(p.minute), second: Number(p.second),
    weekday: p.weekday.toLowerCase().slice(0, 3) as DayKey,
  };
}

/** Minutes the zone is ahead of UTC at the given instant (IST = 330). */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const z = zonedParts(date, tz);
  const asUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** Salon-local "YYYY-MM-DD" + "HH:MM" -> UTC instant. */
export function zonedToUtc(dateStr: string, timeStr: string, tz: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let result = guess - tzOffsetMinutes(new Date(guess), tz) * 60000;
  const second = guess - tzOffsetMinutes(new Date(result), tz) * 60000; // settle DST edges
  if (second !== result) result = second;
  return new Date(result);
}

export function pad2(n: number) { return n < 10 ? `0${n}` : String(n); }

/** Salon-local calendar date of an instant. */
export function localDate(date: Date, tz: string): string {
  const z = zonedParts(date, tz);
  return `${z.year}-${pad2(z.month)}-${pad2(z.day)}`;
}

/** Salon-local "HH:MM" of an instant. */
export function localTime(date: Date, tz: string): string {
  const z = zonedParts(date, tz);
  return `${pad2(z.hour)}:${pad2(z.minute)}`;
}

/** Minutes since local midnight. */
export function localMinutes(date: Date, tz: string): number {
  const z = zonedParts(date, tz);
  return z.hour * 60 + z.minute;
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

export function dayKeyOf(dateStr: string): DayKey {
  const [y, m, d] = dateStr.split('-').map(Number);
  return DAY_KEYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function isValidDateStr(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToHhmm(min: number): string {
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
}

// ---- Display formatting (Indian English conventions) ----

export function fmtTime(date: Date | string, tz: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true })
    .format(typeof date === 'string' ? new Date(date) : date).replace(' am', ' AM').replace(' pm', ' PM');
}

export function fmtHhmm(hhmm: string): string {
  const min = hhmmToMinutes(hhmm);
  const h = Math.floor(min / 60), m = min % 60;
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${pad2(m)} ${h < 12 ? 'AM' : 'PM'}`;
}

export function fmtDateLong(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

export function fmtDateShort(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

export function fmtDateTime(date: Date | string, tz: string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return `${fmtDateShort(localDate(d, tz))}, ${fmtTime(d, tz)}`;
}

/** "Today", "Tomorrow", or "Mon, 3 Nov" relative to the salon's today. */
export function relativeDay(dateStr: string, todayStr: string): string {
  if (dateStr === todayStr) return 'Today';
  if (dateStr === addDays(todayStr, 1)) return 'Tomorrow';
  if (dateStr === addDays(todayStr, -1)) return 'Yesterday';
  return fmtDateShort(dateStr);
}
