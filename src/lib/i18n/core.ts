// t(): looks a key up in the active language, falls back to English, fills {placeholders} and picks plural forms.
// Pure and client-safe. English (en.ts) is bundled everywhere because it is the fallback; the other languages reach the
// browser as plain data from the server (see I18nProvider), so a page only ever ships the language it shows.
import { en, type MessageKey, type Messages } from './en';
import type { Locale } from './locales';
import { addDays, fmtDateShort, intlLocale } from '../time';

/** A message with plural forms, chosen by `count` with the language's plural rules (Intl.PluralRules). */
export interface PluralMsg { zero?: string; one?: string; two?: string; few?: string; many?: string; other: string }
export type Msg = string | PluralMsg;
export type Vars = Record<string, string | number | null | undefined>;

export interface Translator {
  (key: MessageKey, vars?: Vars): string;
  readonly locale: Locale;
  /**
   * An English message from the server (an action error such as "That time was just taken. Please pick another slot.")
   * in the active language, when the dictionary has it under an `err.*` key; otherwise the message unchanged.
   */
  err(message: string): string;
}

const pluralCache = new Map<string, Intl.PluralRules>();
function pluralForm(locale: Locale, count: number): Intl.LDMLPluralRule {
  const tag = intlLocale(locale);
  let r = pluralCache.get(tag);
  if (!r) { r = new Intl.PluralRules(tag); pluralCache.set(tag, r); }
  return r.select(count);
}

/** Fill {name} placeholders. Unknown placeholders are left as they are, so a mistake is visible, not silent. */
export function interpolate(text: string, vars?: Vars): string {
  if (!vars || text.indexOf('{') < 0) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
}

/** The text of a message for a language: plural objects pick a form by `count` (falling back to `other`). */
export function resolveMsg(msg: Msg, locale: Locale, vars?: Vars): string {
  if (typeof msg === 'string') return interpolate(msg, vars);
  const n = Number(vars?.count ?? 0);
  const form = pluralForm(locale, Number.isFinite(n) ? n : 0);
  return interpolate((n === 0 && msg.zero) || msg[form] || msg.other, vars);
}

let errIndex: Map<string, MessageKey> | null = null;
/** English text of every `err.*` message -> its key (with and without a final full stop). */
function errorKeys(): Map<string, MessageKey> {
  if (errIndex) return errIndex;
  errIndex = new Map();
  for (const [k, v] of Object.entries(en) as [MessageKey, Msg][]) {
    if (!k.startsWith('err.') || typeof v !== 'string') continue;
    errIndex.set(v, k);
    errIndex.set(v.replace(/\.$/, ''), k);
  }
  return errIndex;
}

export function createT(locale: Locale, messages: Messages = {}): Translator {
  const own = locale === 'en' ? {} : messages;
  const t = ((key: MessageKey, vars?: Vars) => {
    const mine = own[key];
    if (mine !== undefined) return resolveMsg(mine, locale, vars);
    const fallback = en[key] as Msg | undefined;
    return fallback === undefined ? key : resolveMsg(fallback, 'en', vars);
  }) as Translator;
  Object.defineProperty(t, 'locale', { value: locale });
  Object.defineProperty(t, 'err', {
    value: (message: string) => {
      const key = errorKeys().get(message?.trim?.() ?? '');
      return key ? t(key) : message;
    },
  });
  return t;
}

/** "Today", "Tomorrow", "Yesterday" or a short date, in the translator's language. */
export function relDay(t: Translator, dateStr: string, todayStr: string): string {
  if (dateStr === todayStr) return t('time.today');
  if (dateStr === addDays(todayStr, 1)) return t('time.tomorrow');
  if (dateStr === addDays(todayStr, -1)) return t('time.yesterday');
  return fmtDateShort(dateStr, t.locale);
}

/** "45 min", "1 hr 30 min" in the translator's language. */
export function fmtDurationT(t: Translator, min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return t('time.min', { m });
  return m ? t('time.hrMin', { h, m }) : t('time.hr', { h });
}

export const englishT = createT('en');
