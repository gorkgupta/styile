// Packages and membership cards: pure helpers shared by the staff screens, the POS, the client portal and the
// WhatsApp assistant. The database (0012_packages_memberships.sql) has the final say on every rule here.
//
// GST (the app's reading, not tax advice — salons should confirm with their CA):
// * Selling a package is recorded with a package receipt, not a tax invoice. GST is charged on the bill when a
//   session is used: the service shows at the session's value and is paid from the package.
// * A membership card's fee is a service: it is billed as a normal line ("Membership card", SAC 999729).
import { addDays } from './time';
import type { ClientMembership, ClientPackage, ClientPackageItem, ClientPackageStatus, MembershipPlan, Service, ServicePackage } from './types';

export const MAX_PACKAGE_ITEMS = 12;
export const MAX_SESSIONS = 100;
export const MAX_PACKAGE_PRICE = 1000000;
export const MAX_CARD_FEE = 100000;
export const MAX_MEMBER_DISCOUNT = 50;
/** Validity a salon can choose, in days (same limits as the database). */
export const PACKAGE_VALIDITY = { min: 7, max: 1095 } as const;
export const CARD_VALIDITY = { min: 30, max: 1095 } as const;
/** Quick choices for validity. */
export const VALIDITY_CHOICES = [{ days: 90, label: '3 months' }, { days: 180, label: '6 months' }, { days: 365, label: '1 year' }] as const;
/** SAC printed on the membership card line. */
export const CARD_SAC = '999729';

const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

/** "10%", "7.5%". */
export function pctText(n: number | string | null | undefined): string {
  return `${nf.format(Number(n ?? 0))}%`;
}

/** "6 months", "1 year", "45 days". */
export function validityText(days: number): string {
  if (days % 365 === 0) return days === 365 ? '1 year' : `${days / 365} years`;
  if (days % 30 === 0 && days <= 360) return days === 30 ? '1 month' : `${days / 30} months`;
  return `${days} days`;
}

/** "8 Nov" this year, "10 Feb 2027" otherwise (no year when `today` is in the same year). */
export function dayText(date: string, today?: string | null): string {
  const [y, m, d] = date.split('-').map(Number);
  const sameYear = !!today && today.slice(0, 4) === date.slice(0, 4);
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

/** "1 session" / "6 sessions". */
export function sessionsText(n: number): string {
  return `${n} session${n === 1 ? '' : 's'}`;
}

export function sessionsLeft(item: Pick<ClientPackageItem, 'sessions_total' | 'sessions_used'>): number {
  return Math.max(0, Number(item.sessions_total) - Number(item.sessions_used));
}
export function packageLeft(pkg: { items: Pick<ClientPackageItem, 'sessions_total' | 'sessions_used'>[] }): number {
  return pkg.items.reduce((s, i) => s + sessionsLeft(i), 0);
}
export function packageTotalSessions(pkg: { items: Pick<ClientPackageItem, 'sessions_total'>[] }): number {
  return pkg.items.reduce((s, i) => s + Number(i.sessions_total), 0);
}
/** What the sessions still to be used are worth (what the salon still owes the client). */
export function packageLeftValue(pkg: { items: Pick<ClientPackageItem, 'sessions_total' | 'sessions_used' | 'unit_value'>[] }): number {
  return pkg.items.reduce((s, i) => s + sessionsLeft(i) * Number(i.unit_value), 0);
}

/**
 * Where a client's package stands on a salon-local day. The database stores 'active' until every session is used;
 * a package past its last day is expired (sessions can't be used) even though its row still says active.
 */
export function packageState(pkg: Pick<ClientPackage, 'status' | 'expires_on' | 'items'>, today: string): ClientPackageStatus {
  if (pkg.status === 'cancelled') return 'cancelled';
  if (pkg.status === 'used' || (pkg.items.length > 0 && packageLeft(pkg) === 0)) return 'used';
  if (pkg.status === 'expired' || pkg.expires_on < today) return 'expired';
  return 'active';
}

export const PACKAGE_STATE_LABEL: Record<ClientPackageStatus, string> = { active: 'Active', used: 'All used', expired: 'Expired', cancelled: 'Cancelled' };

/** Days from today to the last day (0 = today is the last day; negative = expired). */
export function daysLeft(lastDay: string, today: string): number {
  const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const b = Date.UTC(+lastDay.slice(0, 4), +lastDay.slice(5, 7) - 1, +lastDay.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

/** The last day of a package sold today (the database: today + validity_days). */
export function packageExpiry(today: string, validityDays: number): string {
  return addDays(today, validityDays);
}

/** Menu value of a package: what its sessions cost at menu prices. */
export function packageMenuValue(pkg: Pick<ServicePackage, 'items'>, services: Pick<Service, 'id' | 'price'>[]): number {
  return pkg.items.reduce((s, i) => s + Number(services.find((x) => x.id === i.service_id)?.price ?? 0) * i.sessions, 0);
}
/** Whole-percent saving against menu prices (0 when there is none). */
export function packageSavingPct(price: number, menuValue: number): number {
  return menuValue > price && menuValue > 0 ? Math.round(((menuValue - price) / menuValue) * 100) : 0;
}

/**
 * What one session of each service is worth when sold for `price`: the price shared across the sessions by menu
 * price, to the rupee. Same as sell_package() in the database.
 */
export function sessionValues(price: number, items: { sessions: number; menuPrice: number }[]): number[] {
  const menu = items.reduce((s, i) => s + i.menuPrice * i.sessions, 0);
  const sessions = items.reduce((s, i) => s + i.sessions, 0);
  return items.map((i) => (menu > 0 ? Math.round((price * i.menuPrice) / menu) : sessions ? Math.round(price / sessions) : 0));
}

/** The card valid on a salon-local day, if any (the latest-ending one). */
export function activeMembership<T extends Pick<ClientMembership, 'status' | 'starts_on' | 'ends_on'>>(cards: T[], today: string): T | null {
  return cards.filter((m) => m.status === 'active' && m.starts_on <= today && m.ends_on >= today)
    .sort((a, b) => b.ends_on.localeCompare(a.ends_on))[0] ?? null;
}

export type MembershipState = 'active' | 'upcoming' | 'expired' | 'cancelled';
export function membershipState(m: Pick<ClientMembership, 'status' | 'starts_on' | 'ends_on'>, today: string): MembershipState {
  if (m.status === 'cancelled') return 'cancelled';
  if (m.status === 'expired' || m.ends_on < today) return 'expired';
  return m.starts_on > today ? 'upcoming' : 'active';
}

/** The member discount (%) a bill line gets: services and products only. */
export function memberPctFor(kind: string, m: Pick<ClientMembership, 'service_discount_pct' | 'product_discount_pct'> | null | undefined): number {
  if (!m) return 0;
  return kind === 'service' ? Number(m.service_discount_pct) : kind === 'product' ? Number(m.product_discount_pct) : 0;
}

/** "10% off services · 5% off products". */
export function perksText(m: Pick<MembershipPlan, 'service_discount_pct' | 'product_discount_pct'>): string {
  return [
    Number(m.service_discount_pct) > 0 ? `${pctText(m.service_discount_pct)} off services` : '',
    Number(m.product_discount_pct) > 0 ? `${pctText(m.product_discount_pct)} off products` : '',
  ].filter(Boolean).join(' · ');
}

/** When a card bought today would start and end: a renewal starts the day after the current card ends. */
export function cardDates(cards: Pick<ClientMembership, 'status' | 'starts_on' | 'ends_on'>[], today: string, validityDays: number): { starts: string; ends: string; renewal: boolean } {
  const current = cards.filter((m) => m.status === 'active' && m.ends_on >= today).map((m) => m.ends_on).sort().at(-1);
  const starts = current ? addDays(current, 1) : today;
  return { starts, ends: addDays(starts, validityDays - 1), renewal: !!current };
}

/** Package sessions a bill line for this service can use: active, not expired, with a session left. */
export interface UsableSession { packageId: string; packageName: string; itemId: string; left: number; total: number; unitValue: number; expiresOn: string }
export function usableSessions(packages: ClientPackage[], serviceId: string | null | undefined, today: string): UsableSession[] {
  if (!serviceId) return [];
  const out: UsableSession[] = [];
  for (const p of packages) {
    if (packageState(p, today) !== 'active') continue;
    for (const i of p.items) {
      if (i.service_id === serviceId && sessionsLeft(i) > 0) {
        out.push({ packageId: p.id, packageName: p.name, itemId: i.id, left: sessionsLeft(i), total: i.sessions_total, unitValue: Number(i.unit_value), expiresOn: p.expires_on });
      }
    }
  }
  // The one ending soonest first, so sessions aren't lost.
  return out.sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
}

// ---------------------------------------------------------------------------
// Checking what owners type (the database checks the same)
// ---------------------------------------------------------------------------
export interface PackageInput { name: string; description?: string | null; price: number; validityDays: number; active?: boolean; items: { serviceId: string; sessions: number }[] }

export function checkPackage(input: PackageInput): { ok: true; value: PackageInput } | { ok: false; error: string } {
  const name = (input.name ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2) return { ok: false, error: 'Give the package a name, like “6 Facials”.' };
  if (name.length > 60) return { ok: false, error: 'Keep the package name under 60 characters.' };
  const price = Number(input.price);
  if (!Number.isFinite(price) || price <= 0) return { ok: false, error: 'Enter the package price.' };
  if (price > MAX_PACKAGE_PRICE) return { ok: false, error: 'A package can cost up to ₹10,00,000.' };
  const days = Number(input.validityDays);
  if (!Number.isInteger(days) || days < PACKAGE_VALIDITY.min || days > PACKAGE_VALIDITY.max) return { ok: false, error: 'Validity should be from 7 days to 3 years.' };
  const items = (input.items ?? []).filter((i) => i.serviceId);
  if (!items.length) return { ok: false, error: 'Add at least one service to the package.' };
  if (items.length > MAX_PACKAGE_ITEMS) return { ok: false, error: `Keep a package to ${MAX_PACKAGE_ITEMS} services or fewer.` };
  if (new Set(items.map((i) => i.serviceId)).size !== items.length) return { ok: false, error: 'A service is in the package twice. Add its sessions together instead.' };
  for (const i of items) {
    if (!Number.isInteger(i.sessions) || i.sessions < 1 || i.sessions > MAX_SESSIONS) return { ok: false, error: 'Sessions should be a whole number from 1 to 100.' };
  }
  const description = (input.description ?? '').trim().slice(0, 300) || null;
  return { ok: true, value: { name, description, price: Math.round(price * 100) / 100, validityDays: days, active: input.active ?? true, items } };
}

export interface PlanInput { name: string; description?: string | null; fee: number; validityDays: number; serviceDiscountPct: number; productDiscountPct: number; active?: boolean }

export function checkPlan(input: PlanInput): { ok: true; value: PlanInput } | { ok: false; error: string } {
  const name = (input.name ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2) return { ok: false, error: 'Give the card a name, like “Glow Card”.' };
  if (name.length > 40) return { ok: false, error: 'Keep the card name under 40 characters.' };
  const fee = Number(input.fee);
  if (!Number.isFinite(fee) || fee <= 0) return { ok: false, error: 'Enter the card fee.' };
  if (fee > MAX_CARD_FEE) return { ok: false, error: 'A card fee can be up to ₹1,00,000.' };
  const days = Number(input.validityDays);
  if (!Number.isInteger(days) || days < CARD_VALIDITY.min || days > CARD_VALIDITY.max) return { ok: false, error: 'A card can last from 30 days to 3 years.' };
  const s = Number(input.serviceDiscountPct), p = Number(input.productDiscountPct);
  for (const [v, what] of [[s, 'services'], [p, 'products']] as const) {
    if (!Number.isFinite(v) || v < 0 || v > MAX_MEMBER_DISCOUNT) return { ok: false, error: `Discount on ${what} should be from 0 to 50%.` };
  }
  if (s <= 0 && p <= 0) return { ok: false, error: 'Give members a discount on services, products or both.' };
  const description = (input.description ?? '').trim().slice(0, 300) || null;
  return { ok: true, value: { name, description, fee: Math.round(fee * 100) / 100, validityDays: days, serviceDiscountPct: Math.round(s * 100) / 100, productDiscountPct: Math.round(p * 100) / 100, active: input.active ?? true } };
}

/** Coerce rows from the database (numeric columns come back as strings) into ClientPackage. */
export function normalizeClientPackage(raw: unknown): ClientPackage {
  const r = raw as ClientPackage & { items?: ClientPackageItem[] | null };
  return {
    ...r,
    price: Number(r.price), amount_paid: Number(r.amount_paid), validity_days: Number(r.validity_days),
    refund_amount: r.refund_amount == null ? null : Number(r.refund_amount),
    items: [...(r.items ?? [])].sort((a, b) => a.sort - b.sort).map((i) => ({
      ...i, sessions_total: Number(i.sessions_total), sessions_used: Number(i.sessions_used), unit_value: Number(i.unit_value),
    })),
  };
}
export function normalizeMembership(raw: unknown): ClientMembership {
  const r = raw as ClientMembership;
  return { ...r, fee: Number(r.fee), service_discount_pct: Number(r.service_discount_pct), product_discount_pct: Number(r.product_discount_pct) };
}
export const CLIENT_PACKAGE_SELECT = '*, items:client_package_items(id, service_id, name, sessions_total, sessions_used, unit_value, sort)';
