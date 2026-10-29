'use client';
// React side of i18n: <I18nProvider> (given the language and its dictionary by a server component) and useT().
// Without a provider everything renders in English, so untranslated screens and the preview keep working.
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { createT, englishT, type Translator } from './core';
import type { Messages } from './en';
import { HTML_LANG, LANG_COOKIE, type Locale } from './locales';
import { cookieDomain } from '../tenant';

interface I18nContext { t: Translator; setLocale: (l: Locale) => void }
const Ctx = createContext<I18nContext>({ t: englishT, setLocale: () => {} });

/** Remember a visitor's language on this browser (salon sites read it when there is no ?lang=). */
export function rememberLocale(l: Locale) {
  const domain = cookieDomain();
  document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax${domain ? `; domain=${domain}` : ''}`;
}

export function I18nProvider({ locale, messages, onSwitch, children }: {
  locale: Locale;
  /** The language's dictionary (missing keys fall back to English). Omit for English. */
  messages?: Messages;
  /** Replaces the default switch (cookie + reload from the server); the preview uses it. */
  onSwitch?: (l: Locale) => void;
  children: ReactNode;
}) {
  const router = useRouter();
  const t = useMemo(() => createT(locale, messages ?? {}), [locale, messages]);
  useEffect(() => { document.documentElement.lang = HTML_LANG[locale]; }, [locale]);
  const setLocale = useCallback((l: Locale) => {
    if (onSwitch) { onSwitch(l); return; }
    rememberLocale(l);
    const url = new URL(window.location.href);
    if (url.searchParams.has('lang')) {
      url.searchParams.delete('lang');
      router.replace(url.pathname + url.search + url.hash);
    }
    router.refresh();
  }, [onSwitch, router]);
  const value = useMemo(() => ({ t, setLocale }), [t, setLocale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The translator for the current language: t('key', { name }) ; t.locale ; t.err(serverMessage). */
export function useT(): Translator {
  return useContext(Ctx).t;
}

/**
 * Put React nodes into a translated sentence: rich(t('pt.coinsWorth'), { money: <span className="num">₹500</span> }).
 * t() leaves placeholders it wasn't given as "{money}", so word order stays the translator's.
 */
export function rich(text: string, nodes: Record<string, ReactNode>): ReactNode {
  const parts = text.split(/\{(\w+)\}/g);
  if (parts.length === 1) return text;
  return parts.map((p, i) => (i % 2 === 1 ? <Fragment key={i}>{p in nodes ? nodes[p] : `{${p}}`}</Fragment> : p));
}

/** Switch the page's language (the server renders it again in the new language). */
export function useSetLocale(): (l: Locale) => void {
  return useContext(Ctx).setLocale;
}
