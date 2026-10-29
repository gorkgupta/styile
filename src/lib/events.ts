// Bridal and event bookings with advances: pure helpers shared by the staff screens, the POS and the client portal.
// The database (0014_events_advances.sql) has the final say on every rule here.
//
// An advance is recorded with an advance receipt — not a tax invoice. It is applied on the final bill as a payment
// ('advance'); for regular-GST salons GST is charged on that bill. Salons should confirm the treatment with their CA.
import type { AdvancePayment, EventType, SalonEvent } from './types';

export const EVENT_TYPES: { key: EventType; label: string; short: string }[] = [
  { key: 'bridal', label: 'Bridal', short: 'Bridal' },
  { key: 'engagement', label: 'Engagement', short: 'Engagement' },
  { key: 'party', label: 'Party make-up', short: 'Party' },
  { key: 'group', label: 'Group', short: 'Group' },
  { key: 'other', label: 'Other event', short: 'Event' },
];
export const EVENT_TYPE_LABEL: Record<EventType, string> = Object.fromEntries(EVENT_TYPES.map((t) => [t.key, t.label])) as Record<EventType, string>;
export const isEventType = (t: unknown): t is EventType => EVENT_TYPES.some((x) => x.key === t);

/** Who a person on an event usually is — quick picks for the name. */
export const GUEST_PRESETS = ['Bride', 'Groom', 'Mother', 'Sister', 'Friend', 'Bridesmaid'] as const;

export const MAX_PEOPLE = 50;
export const MAX_TRAVEL = 100000;
export const MAX_ADVANCE = 10000000;

const num = (v: unknown) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };

/** What is left of an advance to use on a bill: received − used − handed back. */
export function advanceLeft(a: Pick<AdvancePayment, 'amount' | 'applied_amount' | 'refund_amount'>): number {
  return Math.max(0, Math.round((num(a.amount) - num(a.applied_amount) - num(a.refund_amount)) * 100) / 100);
}

export interface EventMoney {
  /** The price agreed (quote + travel charge for a home visit). */
  quoted: number;
  received: number; applied: number; refunded: number;
  /** Advances still to be used. */
  left: number;
  /** What the client still owes against the quote (never below zero). */
  balanceDue: number;
}

/** Money on an event: the quote (with travel), advances received, used, handed back, and the balance due. */
export function eventMoney(ev: Pick<SalonEvent, 'quoted_price' | 'travel_charge' | 'location'>, advances: Pick<AdvancePayment, 'amount' | 'applied_amount' | 'refund_amount'>[]): EventMoney {
  const quoted = num(ev.quoted_price) + (ev.location === 'home' ? num(ev.travel_charge) : 0);
  const received = advances.reduce((s, a) => s + num(a.amount), 0);
  const applied = advances.reduce((s, a) => s + num(a.applied_amount), 0);
  const refunded = advances.reduce((s, a) => s + num(a.refund_amount), 0);
  const left = advances.reduce((s, a) => s + advanceLeft(a), 0);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { quoted: r2(quoted), received: r2(received), applied: r2(applied), refunded: r2(refunded), left: r2(left), balanceDue: r2(Math.max(0, quoted - received + refunded)) };
}

/** Days from `today` to the event's salon-local date (0 = today). */
export function daysTo(eventDate: string, today: string): number {
  const d = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((d(eventDate) - d(today)) / 86400000);
}

/** "Today", "Tomorrow", "In 12 days", "3 days ago". */
export function countdown(eventDate: string, today: string): string {
  const n = daysTo(eventDate, today);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return n > 0 ? `In ${n} days` : `${-n} days ago`;
}

/** Group events by salon-local month "2026-11" (in order). */
export function byMonth<T>(rows: T[], dateOf: (r: T) => string): { month: string; rows: T[] }[] {
  const out: { month: string; rows: T[] }[] = [];
  for (const r of rows) {
    const m = dateOf(r).slice(0, 7);
    const last = out[out.length - 1];
    if (last && last.month === m) last.rows.push(r); else out.push({ month: m, rows: [r] });
  }
  return out;
}

export interface EventPersonInput { name: string; serviceIds: string[]; staffId: string | null; start: string }
export interface EventInput {
  customerId: string; type: EventType; title: string; eventAt: string; location: 'salon' | 'home'; address?: string | null;
  travelCharge?: number; quotedPrice?: number | null; notes?: string | null;
  people: EventPersonInput[];
  trial?: { start: string; staffId: string | null; serviceIds: string[] } | null;
  advance?: { amount: number; method: string; reference?: string | null } | null;
}

/** Check a new event the way the database will, with messages the desk can act on. */
export function checkEvent(input: EventInput): { ok: true } | { ok: false; error: string } {
  if (!input.customerId) return { ok: false, error: 'Choose the client.' };
  if (!isEventType(input.type)) return { ok: false, error: 'Pick the kind of event.' };
  const title = (input.title ?? '').trim();
  if (title.length < 2) return { ok: false, error: 'Give the event a name, like “Deki’s wedding”.' };
  if (title.length > 80) return { ok: false, error: 'Keep the event name under 80 characters.' };
  const at = new Date(input.eventAt);
  if (Number.isNaN(at.getTime())) return { ok: false, error: 'Pick the event date and the time everyone must be ready.' };
  if (input.location === 'home' && !(input.address ?? '').trim()) return { ok: false, error: 'Enter the address for the home visit.' };
  if ((input.address ?? '').length > 240) return { ok: false, error: 'Keep the address under 240 characters.' };
  const travel = num(input.travelCharge);
  if (travel < 0 || travel > MAX_TRAVEL) return { ok: false, error: 'Travel charge should be from ₹0 to ₹1,00,000.' };
  if (input.quotedPrice != null && (num(input.quotedPrice) < 0 || num(input.quotedPrice) > MAX_ADVANCE)) return { ok: false, error: 'Check the quoted price.' };
  if (!input.people?.length) return { ok: false, error: 'Add at least one person and their services.' };
  if (input.people.length > MAX_PEOPLE) return { ok: false, error: `Up to ${MAX_PEOPLE} people for one event.` };
  for (const [i, p] of input.people.entries()) {
    const who = p.name.trim() || `person ${i + 1}`;
    if (!p.serviceIds.length) return { ok: false, error: `Pick the services for ${who}.` };
    if (Number.isNaN(new Date(p.start).getTime())) return { ok: false, error: `Pick the start time for ${who}.` };
  }
  if (input.trial) {
    const t = new Date(input.trial.start);
    if (Number.isNaN(t.getTime())) return { ok: false, error: 'Pick the trial date and time, or remove the trial.' };
    if (t >= at) return { ok: false, error: 'The trial should be before the event.' };
    if (!input.trial.serviceIds.length) return { ok: false, error: 'Pick the service for the trial.' };
  }
  if (input.advance && num(input.advance.amount) > 0) {
    if (num(input.advance.amount) > MAX_ADVANCE) return { ok: false, error: 'That advance is too large. Check the amount.' };
    if (['wallet', 'package', 'advance'].includes(input.advance.method)) return { ok: false, error: 'Take the advance by cash, UPI or card.' };
  }
  return { ok: true };
}

export function normalizeEvent(raw: unknown): SalonEvent {
  const r = raw as SalonEvent;
  return { ...r, travel_charge: num(r.travel_charge), quoted_price: r.quoted_price == null ? null : num(r.quoted_price), people: num(r.people) };
}
export function normalizeAdvance(raw: unknown): AdvancePayment {
  const r = raw as AdvancePayment;
  return { ...r, amount: num(r.amount), applied_amount: num(r.applied_amount), refund_amount: r.refund_amount == null ? null : num(r.refund_amount) };
}
