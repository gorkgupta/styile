// Date-range presets for lists and reports, and "3 days ago" style labels.
// Pure functions (no server imports) so both pages and client screens can use them.
import { addDays, dayKeyOf, DAY_KEYS, fmtDateShort, isValidDateStr, localDate } from './time';

export type RangeKey = 'today' | 'yesterday' | 'week' | 'month' | 'custom';
export const RANGE_LABEL: Record<RangeKey, string> = {
  today: 'Today', yesterday: 'Yesterday', week: 'This week', month: 'This month', custom: 'Custom',
};

/** Inclusive salon-local dates ("YYYY-MM-DD"). */
export interface DateRange { key: RangeKey; from: string; to: string }

/** Whole days from date a to date b (b - a). */
export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export function resolveRange(key: string | undefined, today: string, from?: string, to?: string): DateRange {
  switch (key) {
    case 'yesterday': {
      const y = addDays(today, -1);
      return { key: 'yesterday', from: y, to: y };
    }
    case 'week': {
      // Weeks start on Monday in India.
      const back = (DAY_KEYS.indexOf(dayKeyOf(today)) + 6) % 7;
      return { key: 'week', from: addDays(today, -back), to: today };
    }
    case 'month':
      return { key: 'month', from: `${today.slice(0, 8)}01`, to: today };
    case 'custom': {
      if (isValidDateStr(from) && isValidDateStr(to)) {
        let [a, b] = from <= to ? [from, to] : [to, from];
        if (daysBetween(a, b) > 366) a = addDays(b, -366);
        return { key: 'custom', from: a, to: b };
      }
      return { key: 'today', from: today, to: today };
    }
    default:
      return { key: 'today', from: today, to: today };
  }
}

export function describeRange(r: DateRange): string {
  if (r.from === r.to) return fmtDateShort(r.from);
  return `${fmtDateShort(r.from)} – ${fmtDateShort(r.to)}`;
}

/** "Today", "Yesterday", "5 days ago", "3 weeks ago", "2 months ago", "1 year ago". */
export function relativeAgo(iso: string | null | undefined, today: string, tz: string): string {
  if (!iso) return 'Never';
  const d = daysBetween(localDate(new Date(iso), tz), today);
  if (d <= 0) return d < 0 ? 'Upcoming' : 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 7) return `${d} days ago`;
  if (d < 30) { const w = Math.floor(d / 7); return `${w} week${w > 1 ? 's' : ''} ago`; }
  if (d < 365) { const m = Math.floor(d / 30); return `${m} month${m > 1 ? 's' : ''} ago`; }
  const y = Math.floor(d / 365);
  return `${y} year${y > 1 ? 's' : ''} ago`;
}

/** "27 Oct 2026" in the salon's time zone. */
export function fmtDateYear(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}

/** "Mar 2026" in the salon's time zone. */
export function fmtMonthYear(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: tz, month: 'short', year: 'numeric' }).format(new Date(iso));
}
