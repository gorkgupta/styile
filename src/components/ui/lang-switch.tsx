'use client';
// Language menu: each language in its own script. On salon sites it remembers the choice in the styile_lang cookie;
// in the staff app pass onPick to save it to the user's profile first.
import { useState } from 'react';
import { Icon } from './icons';
import { cx } from './ui';
import { useSetLocale, useT } from '@/lib/i18n/react';
import { LOCALES, LOCALE_NAMES, type Locale } from '@/lib/i18n/locales';

export function LanguageSwitch({ onPick, className, compact }: {
  /** Runs before the page switches (e.g. save to the profile). Return false to stay. */
  onPick?: (l: Locale) => Promise<boolean> | boolean;
  className?: string;
  /** Icon + language name only (headers on phones). */
  compact?: boolean;
}) {
  const t = useT();
  const setLocale = useSetLocale();
  const [busy, setBusy] = useState(false);
  return (
    <label className={cx('lang-switch', compact && 'is-compact', busy && 'is-busy', className)} title={t('lang.choose')}>
      <Icon name="globe" size={16} />
      <span className="lang-switch-name" aria-hidden>{LOCALE_NAMES[t.locale]}</span>
      <Icon name="chevronDown" size={13} className="lang-switch-caret" />
      <select aria-label={t('lang.choose')} value={t.locale} disabled={busy} onChange={async (e) => {
        const l = e.target.value as Locale;
        if (onPick) {
          setBusy(true);
          const ok = await onPick(l);
          setBusy(false);
          if (!ok) return;
        }
        setLocale(l);
      }}>
        {LOCALES.map((l) => <option key={l} value={l} lang={l}>{LOCALE_NAMES[l]}</option>)}
      </select>
    </label>
  );
}
