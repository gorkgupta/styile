import { createRoot } from 'react-dom/client';
import { useSyncExternalStore } from 'react';
import { AppShell } from '../src/components/app/shell';
import { ToastProvider } from '../src/components/ui/ui';
import { shellProps } from './data';
import { screens as core } from './screens/core';
import { screens as billing } from './screens/billing';
import { screens as manage } from './screens/manage';
import { screens as publicSide } from './screens/public';
import { screens as dayclose } from './screens/dayclose';
import { screens as packages } from './screens/packages';
import { screens as events } from './screens/events';
import { I18nProvider } from '../src/lib/i18n/react';
import { hi } from '../src/lib/i18n/hi';
import { ne } from '../src/lib/i18n/ne';
import { bn } from '../src/lib/i18n/bn';
import { LOCALES, LOCALE_NAMES, toLocale, type Locale } from '../src/lib/i18n/locales';
import type { Messages } from '../src/lib/i18n/en';

const all = { ...core, ...billing, ...manage, ...publicSide, ...dayclose, ...packages, ...events };
const sub = (l: () => void) => { window.addEventListener('hashchange', l); return () => window.removeEventListener('hashchange', l); };

// Languages: add ?lang=hi|ne|bn to a route (#/app?lang=bn) or pick one on the index. The real app gets the
// dictionary from the server; the preview bundles all of them.
const DICTS: Record<Locale, Messages> = { en: {}, hi, ne, bn };
const langOf = (hash: string) => toLocale(new URLSearchParams(hash.split('?')[1] ?? '').get('lang'));
const withLang = (route: string, lang: Locale) => (lang === 'en' ? route : `${route}?lang=${lang}`);
function switchLang(l: Locale) {
  const [route, query = ''] = (location.hash.slice(1) || '/screens').split('?');
  const q = new URLSearchParams(query);
  if (l === 'en') q.delete('lang'); else q.set('lang', l);
  location.hash = route + (q.toString() ? `?${q}` : '');
}

function Index({ lang }: { lang: Locale }) {
  return (
    <main className="page" style={{ maxWidth: 720, margin: '40px auto' }}>
      <h1>Styile — every screen</h1>
      <p className="muted">A clickable demo with sample data from a Bengaluru salon. Buttons work, but nothing is saved.</p>
      <label className="row" style={{ gap: 8 }}><span className="strong">Language</span>
        <select className="select" style={{ width: 'auto' }} value={lang} onChange={(e) => switchLang(e.target.value as Locale)} aria-label="Language">
          {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}
        </select>
      </label>
      <ul className="list panel">{Object.entries(all).map(([p, s]) => <li key={p}><a href={'#' + withLang(p, lang)}>{s.title}</a> <span className="muted small">{p}</span></li>)}</ul>
    </main>
  );
}

function App() {
  const hash = useSyncExternalStore(sub, () => location.hash.slice(1) || '/');
  const path = hash.split('?')[0];
  const lang = langOf(hash);
  const screen = all[path as keyof typeof all] ?? Object.entries(all).find(([k]) => k.includes('[') && new RegExp('^' + k.replace(/\[[^\]]+\]/g, '[^/]+') + '$').test(path))?.[1];
  const body = !screen || path === '/screens' ? <Index lang={lang} />
    : <>{path.startsWith('/app') ? <AppShell {...shellProps}>{screen.render()}</AppShell> : screen.render()}<a href={'#' + withLang('/screens', lang)} className="demo-pill">All screens</a></>;
  return <I18nProvider key={lang} locale={lang} messages={DICTS[lang]} onSwitch={switchLang}>{body}</I18nProvider>;
}

createRoot(document.getElementById('root')!).render(<ToastProvider><App /></ToastProvider>);
