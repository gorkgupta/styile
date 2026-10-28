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

const all = { ...core, ...billing, ...manage, ...publicSide, ...dayclose, ...packages };
const sub = (l: () => void) => { window.addEventListener('hashchange', l); return () => window.removeEventListener('hashchange', l); };

function Index() {
  return (
    <main className="page" style={{ maxWidth: 720, margin: '40px auto' }}>
      <h1>Styile — every screen</h1>
      <p className="muted">A clickable demo with sample data from a Bengaluru salon. Buttons work, but nothing is saved.</p>
      <ul className="list panel">{Object.entries(all).map(([p, s]) => <li key={p}><a href={'#' + p}>{s.title}</a> <span className="muted small">{p}</span></li>)}</ul>
    </main>
  );
}

function App() {
  const hash = useSyncExternalStore(sub, () => location.hash.slice(1) || '/');
  const path = hash.split('?')[0];
  const screen = all[path as keyof typeof all] ?? Object.entries(all).find(([k]) => k.includes('[') && new RegExp('^' + k.replace(/\[[^\]]+\]/g, '[^/]+') + '$').test(path))?.[1];
  if (!screen || path === '/screens') return <Index />;
  const body = path.startsWith('/app') ? <AppShell {...shellProps}>{screen.render()}</AppShell> : screen.render();
  return <>{body}<a href="#/screens" className="demo-pill">All screens</a></>;
}

createRoot(document.getElementById('root')!).render(<ToastProvider><App /></ToastProvider>);
