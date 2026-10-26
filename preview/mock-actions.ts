// Mock server actions for the preview. Area files register handlers by action name;
// anything unregistered resolves to { ok: true } after a short delay.
import { handlers as core } from './mocks/core';
import { handlers as billing } from './mocks/billing';
import { handlers as manage } from './mocks/manage';
import { handlers as publicSide } from './mocks/public';

const all: Record<string, (...args: any[]) => any> = { ...core, ...billing, ...manage, ...publicSide };

export async function mockAction(name: string, ...args: unknown[]) {
  await new Promise((r) => setTimeout(r, 250));
  const h = all[name];
  if (h) return h(...args);
  console.info('[preview] action', name, args);
  return { ok: true, message: 'Saved (preview)' };
}
