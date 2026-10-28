import 'server-only';
import { cookies } from 'next/headers';
import { createT, type Translator } from './core';
import type { Messages } from './en';
import { hi } from './hi';
import { ne } from './ne';
import { bn } from './bn';
import { LANG_COOKIE, pickSiteLocale, toLocale, type Locale } from './locales';

const DICTIONARIES: Record<Locale, Messages> = { en: {}, hi, ne, bn };

/** A language's dictionary, to hand to <I18nProvider> (English needs none: it is the bundled fallback). */
export function getMessages(locale: Locale): Messages {
  return DICTIONARIES[locale] ?? {};
}

/** t() for server components and server actions. */
export function getT(locale: Locale | string | null | undefined): Translator {
  const l = toLocale(locale);
  return createT(l, getMessages(l));
}

/** Language of a salon-site page: ?lang=, then the styile_lang cookie, then the salon's default. */
export async function siteLocale(salonDefault: string | null | undefined, query?: string | string[]): Promise<Locale> {
  const cookie = (await cookies()).get(LANG_COOKIE)?.value;
  return pickSiteLocale({ query, cookie, salonDefault });
}
