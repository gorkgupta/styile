// Date ranges for the Reports screen. Pure and client-safe; all dates are salon-local "YYYY-MM-DD".
import { addDays, isValidDateStr } from './time';

export type RangeKey = 'today' | 'yesterday' | '7d' | 'month' | 'lastmonth' | 'custom';
export interface ReportRange { key: RangeKey; from: string; to: string }

export const RANGE_PRESETS: { key: Exclude<RangeKey, 'custom'>; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: 'Last 7 days' },
  { key: 'month', label: 'This month' },
  { key: 'lastmonth', label: 'Last month' },
];

const MAX_DAYS = 366;

/** Inclusive number of days from `from` to `to`. */
export function daysInRange(from: string, to: string): number {
  const t = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(to) - t(from)) / 86400000) + 1;
}

/** Every date in the range, oldest first. */
export function eachDay(from: string, to: string): string[] {
  const n = Math.min(daysInRange(from, to), MAX_DAYS);
  return Array.from({ length: Math.max(n, 0) }, (_, i) => addDays(from, i));
}

export function resolveRange(params: { range?: string; from?: string; to?: string }, today: string): ReportRange {
  const monthStart = `${today.slice(0, 8)}01`;
  switch (params.range) {
    case 'today': return { key: 'today', from: today, to: today };
    case 'yesterday': { const y = addDays(today, -1); return { key: 'yesterday', from: y, to: y }; }
    case '7d': return { key: '7d', from: addDays(today, -6), to: today };
    case 'lastmonth': {
      const lastDay = addDays(monthStart, -1);
      return { key: 'lastmonth', from: `${lastDay.slice(0, 8)}01`, to: lastDay };
    }
    case 'custom': {
      const { from, to } = params;
      if (isValidDateStr(from) && isValidDateStr(to) && from <= to && daysInRange(from, to) <= MAX_DAYS) return { key: 'custom', from, to };
      break;
    }
  }
  return { key: 'month', from: monthStart, to: today };
}

/** The same number of days immediately before the range, for "vs previous period". */
export function previousRange(r: ReportRange): { from: string; to: string } {
  const len = daysInRange(r.from, r.to);
  return { from: addDays(r.from, -len), to: addDays(r.from, -1) };
}

/** "27 Oct 2026" or "1 – 27 Oct 2026" or "28 Sep – 27 Oct 2026". */
export function rangeLabel(from: string, to: string): string {
  const fmt = (s: string, opts: Intl.DateTimeFormatOptions) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', ...opts }).format(new Date(Date.UTC(y, m - 1, d)));
  };
  if (from === to) return fmt(from, { day: 'numeric', month: 'short', year: 'numeric' });
  if (from.slice(0, 7) === to.slice(0, 7)) return `${Number(from.slice(8))} – ${fmt(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  if (from.slice(0, 4) === to.slice(0, 4)) return `${fmt(from, { day: 'numeric', month: 'short' })} – ${fmt(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  return `${fmt(from, { day: 'numeric', month: 'short', year: 'numeric' })} – ${fmt(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
