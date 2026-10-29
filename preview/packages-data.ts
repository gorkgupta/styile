// Sample packages and membership cards for the preview (Glow Studio). Session values come from sessionValues(),
// the same sharing rule as sell_package() in the database.
import type { ClientMembership, ClientPackage, MembershipPlan, ServicePackage } from '../src/lib/types';
import type { PackageMenuItem } from '../src/components/app/client-packages';
import { sessionValues } from '../src/lib/packages';
import { salon, services } from './data';

const ist = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, m) - 330 * 60000).toISOString();
};
const svc = (id: string) => services.find((s) => s.id === id)!;

export const menuPackages: ServicePackage[] = [
  { id: 'pk-facials', salon_id: salon.id, name: '6 Hydra facials', description: null, price: 14000, validity_days: 180, active: true, sort: 1, created_at: '2026-06-01T05:00:00Z', items: [{ service_id: 's-facial', sessions: 6 }] },
  { id: 'pk-bridal', salon_id: salon.id, name: 'Bridal glow pack', description: 'Start 6–8 weeks before the wedding', price: 6500, validity_days: 90, active: true, sort: 2, created_at: '2026-06-01T05:00:00Z',
    items: [{ service_id: 's-cleanup', sessions: 3 }, { service_id: 's-facial', sessions: 2 }] },
  { id: 'pk-blow', salon_id: salon.id, name: '10 Blow-dries', description: null, price: 4200, validity_days: 365, active: true, sort: 3, created_at: '2026-06-01T05:00:00Z', items: [{ service_id: 's-blow', sessions: 10 }] },
  { id: 'pk-mani', salon_id: salon.id, name: 'Mani-pedi monthly (old)', description: null, price: 4800, validity_days: 180, active: false, sort: 4, created_at: '2026-03-01T05:00:00Z',
    items: [{ service_id: 's-mani', sessions: 3 }, { service_id: 's-pedi', sessions: 3 }] },
];
export const packageHolders: Record<string, number> = { 'pk-facials': 14, 'pk-bridal': 3, 'pk-blow': 6 };

export const plans: MembershipPlan[] = [
  { id: 'pl-glow', salon_id: salon.id, name: 'Glow Card', description: null, fee: 299, validity_days: 365, service_discount_pct: 10, product_discount_pct: 5, active: true, sort: 1, created_at: '2026-06-01T05:00:00Z' },
  { id: 'pl-gold', salon_id: salon.id, name: 'Gold Card', description: 'For brides and regulars', fee: 1499, validity_days: 365, service_discount_pct: 20, product_discount_pct: 10, active: true, sort: 2, created_at: '2026-06-01T05:00:00Z' },
];
export const planMembers: Record<string, number> = { 'pl-glow': 58, 'pl-gold': 9 };

/** Packages on sale with service names and menu prices (what the client profile's sell sheet gets). */
export const packageMenu: PackageMenuItem[] = menuPackages.filter((p) => p.active).map((p) => ({
  id: p.id, name: p.name, price: p.price, validity_days: p.validity_days,
  items: p.items.map((i) => ({ service_id: i.service_id, name: svc(i.service_id).name, sessions: i.sessions, price: svc(i.service_id).price })),
}));

function clientPackage(id: string, menuId: string, receipt: string, bought: string, expires: string, used: number[], extra: Partial<ClientPackage> = {}): ClientPackage {
  const m = menuPackages.find((x) => x.id === menuId)!;
  const values = sessionValues(m.price, m.items.map((i) => ({ sessions: i.sessions, menuPrice: svc(i.service_id).price })));
  return {
    id, salon_id: salon.id, customer_id: 'cu-1', package_id: m.id, name: m.name, price: m.price, validity_days: m.validity_days,
    purchased_at: bought, expires_on: expires, status: 'active', receipt_no: receipt, amount_paid: m.price, method: 'upi', reference: 'UPI 6612 0091', note: null,
    cancelled_at: null, cancel_reason: null, refund_amount: null, refund_method: null,
    items: m.items.map((i, k) => ({ id: `${id}-i${k}`, service_id: i.service_id, name: svc(i.service_id).name, sessions_total: i.sessions, sessions_used: used[k] ?? 0, unit_value: values[k], sort: k + 1 })),
    ...extra,
  };
}

/** Ananya: 6 Hydra facials (2 used), a bridal glow pack ending soon, and an old blow-dry pack used up. */
export const ananyaPackages: ClientPackage[] = [
  clientPackage('cp-1', 'pk-facials', 'PK-00041', ist('2026-08-14', '12:10'), '2027-02-10', [2]),
  clientPackage('cp-2', 'pk-bridal', 'PK-00057', ist('2026-09-02', '17:40'), '2026-11-08', [2, 1], { method: 'cash', reference: null }),
  clientPackage('cp-3', 'pk-blow', 'PK-00012', ist('2025-10-20', '11:00'), '2026-10-20', [10], { status: 'used' }),
];

export const ananyaCards: ClientMembership[] = [
  { id: 'cm-2', salon_id: salon.id, customer_id: 'cu-1', plan_id: 'pl-glow', name: 'Glow Card', fee: 299, service_discount_pct: 10, product_discount_pct: 5,
    starts_on: '2026-03-12', ends_on: '2027-03-11', status: 'active', invoice_id: 'inv-0988', created_at: ist('2026-03-12', '12:00'), cancelled_at: null, cancel_reason: null },
  { id: 'cm-1', salon_id: salon.id, customer_id: 'cu-1', plan_id: 'pl-glow', name: 'Glow Card', fee: 249, service_discount_pct: 10, product_discount_pct: 0,
    starts_on: '2025-03-12', ends_on: '2026-03-11', status: 'active', invoice_id: 'inv-0712', created_at: ist('2025-03-12', '12:00'), cancelled_at: null, cancel_reason: null },
];

export const packagesReport = {
  packages_sold: 11, packages_sold_amount: 96400, packages_refunded: 2000, package_sessions_redeemed: 38, package_redeemed_value: 61250,
  package_sessions_outstanding: 112, package_outstanding_value: 187300, memberships_sold: 14, memberships_amount: 6185, member_discounts: 18420, active_members: 67,
};
