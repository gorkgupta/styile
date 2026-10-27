import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
const current = () => (location.hash.slice(1) || '/');
window.addEventListener('hashchange', () => listeners.forEach((l) => l()));
export function navigate(href: string) { location.hash = href; }
function subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); }
export function usePathname() { return useSyncExternalStore(subscribe, () => current().split('?')[0]); }
export function useSearchParams() { const s = useSyncExternalStore(subscribe, current); return new URLSearchParams(s.split('?')[1] ?? ''); }
export function useRouter() {
  return { push: navigate, replace: navigate, refresh: () => {}, back: () => history.back(), prefetch: () => {} };
}
export function redirect(href: string): never { navigate(href); throw new Error('redirect'); }
export function notFound(): never { throw new Error('not found'); }
