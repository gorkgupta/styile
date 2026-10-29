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

// ---- Display formatting (Indian conventions) ----
// Helpers that print words (weekday and month names) take an optional language: 'en' (default), 'hi', 'ne', 'bn',
// or any BCP-47 tag. Digits always stay Latin ("28", not "২৮"/"२८") and times stay "5:30 PM" in every language —
// that is how salons write money and times. Existing calls without a language print Indian English as before.

const INTL_CANDIDATES: Record<string, string[]> = { en: ['en-IN'], hi: ['hi-IN', 'hi'], ne: ['ne-NP', 'ne'], bn: ['bn-IN', 'bn'] };
const intlCache = new Map<string, string>();

/** The Intl locale for an app language, with Latin digits: 'bn' -> 'bn-IN-u-nu-latn' ('ne-NP', else 'ne', for Nepali). */
export function intlLocale(lang?: string | null): string {
  const key = lang || 'en';
  let tag = intlCache.get(key);
  if (!tag) {
    const candidates = INTL_CANDIDATES[key] ?? [key];
    let base = 'en-IN';
    try { base = Intl.DateTimeFormat.supportedLocalesOf(candidates)[0] ?? 'en-IN'; } catch { /* bad tag: English */ }
    tag = base === 'en-IN' ? base : `${base}-u-nu-latn`;
    intlCache.set(key, tag);
  }
  return tag;
}

// Weekday and month names for Hindi, Nepali and Bengali, so a date prints the same on the server and in every browser
// (Chrome ships without Nepali date data, and ICU versions differ — a mismatch would break React hydration).
interface DateNames { m: string[]; ms: string[]; w: string[]; ws: string[] }
const NAMES: Record<string, DateNames> = {
  hi: {
    m: ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'],
    ms: ['जन॰', 'फ़र॰', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुल॰', 'अग॰', 'सित॰', 'अक्टू॰', 'नव॰', 'दिस॰'],
    w: ['रविवार', 'सोमवार', 'मंगलवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'],
    ws: ['रवि', 'सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि'],
  },
  ne: {
    m: ['जनवरी', 'फेब्रुअरी', 'मार्च', 'अप्रिल', 'मे', 'जुन', 'जुलाई', 'अगस्ट', 'सेप्टेम्बर', 'अक्टोबर', 'नोभेम्बर', 'डिसेम्बर'],
    ms: ['जन', 'फेब', 'मार्च', 'अप्रिल', 'मे', 'जुन', 'जुलाई', 'अग', 'सेप', 'अक्टो', 'नोभे', 'डिसे'],
    w: ['आइतबार', 'सोमबार', 'मङ्गलबार', 'बुधबार', 'बिहिबार', 'शुक्रबार', 'शनिबार'],
    ws: ['आइत', 'सोम', 'मङ्गल', 'बुध', 'बिहि', 'शुक्र', 'शनि'],
  },
  bn: {
    m: ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'],
    ms: ['জানু', 'ফেব', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টে', 'অক্টো', 'নভে', 'ডিসে'],
    w: ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'],
    ws: ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহঃ', 'শুক্র', 'শনি'],
  },
};
/** Built-in names for an app language ('hi', 'ne', 'bn'), or null for English (Intl en-IN). */
function namesFor(lang?: string | null): DateNames | null {
  return lang ? NAMES[lang] ?? null : null;
}

/** "28 Oct 2026" / "28 अक्टो 2026" for a year, month (1-12) and day. */
export function fmtDayMonthYear(y: number, m: number, d: number, lang?: string | null, opts: { year?: boolean; month?: 'short' | 'long' } = {}): string {
  const n = namesFor(lang);
  const withYear = opts.year ?? true;
  if (n) return `${d} ${(opts.month === 'long' ? n.m : n.ms)[m - 1]}${withYear ? ` ${y}` : ''}`;
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: opts.month ?? 'short', ...(withYear ? { year: 'numeric' } : {}) })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

/** "Oct 2026" / "অক্টো 2026" */
export function fmtMonthYearParts(y: number, m: number, lang?: string | null): string {
  const n = namesFor(lang);
  if (n) return `${n.ms[m - 1]} ${y}`;
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', month: 'short', year: 'numeric' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function utcDateFormat(lang: string | null | undefined, opts: Intl.DateTimeFormatOptions, name: string): Intl.DateTimeFormat {
  const tag = intlLocale(lang);
  const k = `${tag}|${name}`;
  let f = fmtCache.get(k);
  if (!f) { f = new Intl.DateTimeFormat(tag, { timeZone: 'UTC', ...opts }); fmtCache.set(k, f); }
  return f;
}
const utcDate = (dateStr: string) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

/** "5:30 PM" in the salon's time zone (the same in every language). */
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

/** "Wednesday, 28 October" / "बुधवार, 28 अक्टूबर" (always a comma after the weekday) */
export function fmtDateLong(dateStr: string, lang?: string | null): string {
  const n = namesFor(lang);
  if (n) { const d = utcDate(dateStr); return `${n.w[d.getUTCDay()]}, ${d.getUTCDate()} ${n.m[d.getUTCMonth()]}`; }
  return utcDateFormat(lang, { weekday: 'long', day: 'numeric', month: 'long' }, 'long').format(utcDate(dateStr));
}

/** "Wed, 28 Oct" / "বুধ 28 অক্টোঃ" */
export function fmtDateShort(dateStr: string, lang?: string | null): string {
  const n = namesFor(lang);
  if (n) { const d = utcDate(dateStr); return `${n.ws[d.getUTCDay()]}, ${d.getUTCDate()} ${n.ms[d.getUTCMonth()]}`; }
  return utcDateFormat(lang, { weekday: 'short', day: 'numeric', month: 'short' }, 'short').format(utcDate(dateStr));
}

/** Weekday, day and month of a date as separate pieces (date pills, calendar chips): { wd: 'Wed', day: '28', mon: 'Oct' }. */
export function dateParts(dateStr: string, lang?: string | null): { wd: string; day: string; mon: string } {
  const d = utcDate(dateStr);
  const n = namesFor(lang);
  if (n) return { wd: n.ws[d.getUTCDay()], day: String(d.getUTCDate()), mon: n.ms[d.getUTCMonth()] };
  return {
    wd: utcDateFormat(lang, { weekday: 'short' }, 'wd').format(d),
    day: String(d.getUTCDate()),
    mon: utcDateFormat(lang, { month: 'short' }, 'mon').format(d),
  };
}

export function fmtDateTime(date: Date | string, tz: string, lang?: string | null): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return `${fmtDateShort(localDate(d, tz), lang)}, ${fmtTime(d, tz)}`;
}

/** "Today", "Tomorrow", or "Mon, 3 Nov" relative to the salon's today (English; translated screens use relDay from lib/i18n). */
export function relativeDay(dateStr: string, todayStr: string): string {
  if (dateStr === todayStr) return 'Today';
  if (dateStr === addDays(todayStr, 1)) return 'Tomorrow';
  if (dateStr === addDays(todayStr, -1)) return 'Yesterday';
  return fmtDateShort(dateStr);
}
