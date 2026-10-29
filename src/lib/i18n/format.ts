// Translated versions of the small text helpers in lib/coins, lib/packages and lib/events (which stay English for the
// server, WhatsApp and tests). Pure and client-safe.
import type { Translator } from './core';
import { fmtCoins } from '../coins';
import { pctText } from '../packages';
import { daysTo } from '../events';
import { fmtDayMonthYear, localDate } from '../time';
import { daysBetween } from '../periods';
import type { MembershipPlan } from '../types';

/** "5,500 coins" */
export function coinsT(t: Translator, n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return t('coins.n', { count: Math.abs(v), n: fmtCoins(v) });
}

/** "6 sessions" */
export function sessionsT(t: Translator, n: number): string {
  return t('pkg.sessions', { count: n });
}

/** "8 Nov" this year, "10 Feb 2027" otherwise. */
export function dayTextT(t: Translator, date: string, today?: string | null): string {
  const [y, m, d] = date.split('-').map(Number);
  const sameYear = !!today && today.slice(0, 4) === date.slice(0, 4);
  return fmtDayMonthYear(y, m, d, t.locale, { year: !sameYear });
}

/** "10% off services · 5% off products" */
export function perksT(t: Translator, m: Pick<MembershipPlan, 'service_discount_pct' | 'product_discount_pct'>): string {
  return [
    Number(m.service_discount_pct) > 0 ? t('pkg.offServices', { pct: pctText(m.service_discount_pct) }) : '',
    Number(m.product_discount_pct) > 0 ? t('pkg.offProducts', { pct: pctText(m.product_discount_pct) }) : '',
  ].filter(Boolean).join(' · ');
}

/** "Today", "Tomorrow", "In 12 days", "3 days ago" */
export function countdownT(t: Translator, eventDate: string, today: string): string {
  const n = daysTo(eventDate, today);
  if (n === 0) return t('time.today');
  if (n === 1) return t('time.tomorrow');
  if (n === -1) return t('time.yesterday');
  return n > 0 ? t('time.inDays', { count: n }) : t('time.daysAgo', { count: -n });
}

/** "Today", "Yesterday", "5 days ago", "3 weeks ago", "2 months ago", "1 year ago", "Never" (like lib/periods relativeAgo). */
export function relativeAgoT(t: Translator, iso: string | null | undefined, today: string, tz: string): string {
  if (!iso) return t('ago.never');
  const d = daysBetween(localDate(new Date(iso), tz), today);
  if (d <= 0) return d < 0 ? t('ago.upcoming') : t('time.today');
  if (d === 1) return t('time.yesterday');
  if (d < 7) return t('time.daysAgo', { count: d });
  if (d < 30) return t('ago.weeks', { count: Math.floor(d / 7) });
  if (d < 365) return t('ago.months', { count: Math.floor(d / 30) });
  return t('ago.years', { count: Math.floor(d / 365) });
}
