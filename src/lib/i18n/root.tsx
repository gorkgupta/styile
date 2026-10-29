// Server component: wraps a page (or the staff app) in its language. Sets <html lang> before first paint with a
// one-line script, so the root layout can stay static for the marketing pages; the provider keeps it in sync after.
import type { ReactNode } from 'react';
import { I18nProvider } from './react';
import { getMessages } from './server';
import { HTML_LANG, type Locale } from './locales';

export function I18nRoot({ locale, children }: { locale: Locale; children: ReactNode }) {
  return (
    <I18nProvider locale={locale} messages={locale === 'en' ? undefined : getMessages(locale)}>
      {locale !== 'en' && <script dangerouslySetInnerHTML={{ __html: `document.documentElement.lang=${JSON.stringify(HTML_LANG[locale])}` }} />}
      {children}
    </I18nProvider>
  );
}
