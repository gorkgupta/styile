// The languages Styile speaks. English is the default and the source of every string (see docs/TRANSLATIONS.md).
// Pure and client-safe.

export const LOCALES = ['en', 'hi', 'ne', 'bn'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** Each language in its own script, as people look for it in a menu. */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', hi: 'हिन्दी', ne: 'नेपाली', bn: 'বাংলা' };

/** <html lang> for each language. */
export const HTML_LANG: Record<Locale, string> = { en: 'en-IN', hi: 'hi-IN', ne: 'ne', bn: 'bn-IN' };

/** The browser's chosen language on salon sites (booking page, /me): set by the switcher in the header. */
export const LANG_COOKIE = 'styile_lang';

export function isLocale(x: unknown): x is Locale {
  return typeof x === 'string' && (LOCALES as readonly string[]).includes(x);
}

/** A locale from untrusted input ("bn", "BN", ["hi"]), or the fallback. */
export function toLocale(x: unknown, fallback: Locale = DEFAULT_LOCALE): Locale {
  const v = Array.isArray(x) ? x[0] : x;
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return isLocale(s) ? s : fallback;
}

/**
 * Language of a salon-site page: ?lang= wins, then the visitor's cookie, then the salon's default.
 * (A staff member's own language comes from profiles.locale instead.)
 */
export function pickSiteLocale(opts: { query?: unknown; cookie?: unknown; salonDefault?: unknown }): Locale {
  for (const c of [opts.query, opts.cookie, opts.salonDefault]) {
    const l = toLocale(c, 'xx' as Locale);
    if (isLocale(l)) return l;
  }
  return DEFAULT_LOCALE;
}
