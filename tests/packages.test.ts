// Packages and membership cards: the POS mirror of create_invoice() (same numbers as scripts/db-test) and the helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBill } from '../src/lib/billing';
import {
  activeMembership, cardDates, checkPackage, checkPlan, daysLeft, memberPctFor, membershipState, packageExpiry, packageLeftValue,
  packageMenuValue, packageSavingPct, packageState, pctText, perksText, sessionValues, usableSessions, validityText,
} from '../src/lib/packages';
import type { ClientMembership, ClientPackage } from '../src/lib/types';

const regular = { gstMode: 'regular' as const, pricesIncludeTax: true, serviceRate: 5 };

test('a package session on the bill: priced at its value, paid from the package, GST on that value', () => {
  const b = computeBill([
    { kind: 'service', name: 'Facial', qty: 1, unitPrice: 1500, discount: 100, fromPackage: true },
    { kind: 'service', name: 'Haircut', qty: 1, unitPrice: 600 },
  ], regular);
  assert.equal(b.total, 2100);
  assert.equal(b.cgst, 50);
  assert.equal(b.sgst, 50);
  assert.equal(b.lines[0].discount, 0, 'no discount on a package session');
  assert.equal(b.lines[0].taxable, 1428.57);
  assert.equal(b.packageTotal, 1500);
});

test('member prices: % off services and products, on top of a desk discount, never on package sessions', () => {
  const b = computeBill([
    { kind: 'service', name: 'Haircut', qty: 1, unitPrice: 600, discount: 40, memberPct: 10 },
    { kind: 'product', name: 'Shampoo', qty: 1, unitPrice: 400, gstRate: 5, memberPct: 5 },
    { kind: 'service', name: 'Facial', qty: 1, unitPrice: 1500, memberPct: 10, fromPackage: true },
    { kind: 'custom', name: 'Add-on', qty: 1, unitPrice: 200, memberPct: 10 },
  ], regular);
  assert.deepEqual(b.lines.map((l) => [l.discount, l.memberDiscount]), [[100, 60], [20, 20], [0, 0], [0, 0]]);
  assert.equal(b.memberDiscountTotal, 80);
  assert.equal(b.total, 2580);
  assert.equal(b.packageTotal, 1500);
});

test('GST added on top: the package pays the session value, the GST is due at the visit', () => {
  const b = computeBill([{ kind: 'service', name: 'Facial', qty: 1, unitPrice: 1543, fromPackage: true }], { ...regular, pricesIncludeTax: false });
  assert.equal(b.total, 1620);
  assert.equal(b.packageTotal, 1543);
});

test('session values share the price by menu price, to the rupee (same as sell_package)', () => {
  assert.deepEqual(sessionValues(9000, [{ sessions: 6, menuPrice: 1800 }]), [1500]);
  assert.deepEqual(sessionValues(5400, [{ sessions: 3, menuPrice: 900 }, { sessions: 2, menuPrice: 1800 }]), [771, 1543]);
  assert.deepEqual(sessionValues(1000, [{ sessions: 4, menuPrice: 0 }]), [250], 'free services: shared evenly');
  const services = [{ id: 'f', price: 1800 }, { id: 'c', price: 900 }];
  assert.equal(packageMenuValue({ items: [{ service_id: 'f', sessions: 6 }] }, services), 10800);
  assert.equal(packageSavingPct(9000, 10800), 17);
  assert.equal(packageSavingPct(11000, 10800), 0);
});

const pkg = (over: Partial<ClientPackage> = {}): ClientPackage => ({
  id: 'p1', salon_id: 's', customer_id: 'c', package_id: 'm', name: '6 Facials', price: 9000, validity_days: 180,
  purchased_at: '2026-10-28T05:00:00Z', expires_on: '2027-04-26', status: 'active', receipt_no: 'PK-00001', amount_paid: 9000, method: 'upi',
  reference: null, note: null, cancelled_at: null, cancel_reason: null, refund_amount: null, refund_method: null,
  items: [{ id: 'i1', service_id: 'facial', name: 'Facial', sessions_total: 6, sessions_used: 2, unit_value: 1500, sort: 1 }],
  ...over,
});

test('package state: active, all used, expired after its last day, cancelled', () => {
  assert.equal(packageState(pkg(), '2026-10-28'), 'active');
  assert.equal(packageState(pkg(), '2027-04-26'), 'active', 'usable on its last day');
  assert.equal(packageState(pkg(), '2027-04-27'), 'expired');
  assert.equal(packageState(pkg({ items: [{ ...pkg().items[0], sessions_used: 6 }] }), '2026-10-28'), 'used');
  assert.equal(packageState(pkg({ status: 'cancelled' }), '2026-10-28'), 'cancelled');
  assert.equal(packageLeftValue(pkg()), 6000);
  assert.equal(packageExpiry('2026-10-28', 180), '2027-04-26');
  assert.equal(daysLeft('2026-11-05', '2026-10-27'), 9);
});

test('POS: usable sessions for a service, the package ending soonest first', () => {
  const soon = pkg({ id: 'p2', name: 'Bridal glow pack', expires_on: '2026-11-30', items: [{ id: 'i2', service_id: 'facial', name: 'Facial', sessions_total: 2, sessions_used: 0, unit_value: 1543, sort: 1 }] });
  const out = usableSessions([pkg(), soon, pkg({ id: 'p3', expires_on: '2026-10-01' })], 'facial', '2026-10-28');
  assert.deepEqual(out.map((u) => [u.packageName, u.left, u.unitValue]), [['Bridal glow pack', 2, 1543], ['6 Facials', 4, 1500]]);
  assert.deepEqual(usableSessions([pkg()], 'haircut', '2026-10-28'), []);
  assert.deepEqual(usableSessions([pkg()], null, '2026-10-28'), []);
});

const card = (over: Partial<ClientMembership> = {}): ClientMembership => ({
  id: 'm1', salon_id: 's', customer_id: 'c', plan_id: 'pl', name: 'Glow Card', fee: 299, service_discount_pct: 10, product_discount_pct: 5,
  starts_on: '2026-10-28', ends_on: '2027-10-27', status: 'active', invoice_id: 'inv', created_at: '2026-10-28T05:00:00Z', cancelled_at: null, cancel_reason: null,
  ...over,
});

test('membership: the card valid today, renewals start when the current card ends, discount per line kind', () => {
  assert.equal(activeMembership([card()], '2026-10-28')?.id, 'm1');
  assert.equal(activeMembership([card()], '2027-10-28'), null, 'ended');
  assert.equal(activeMembership([card({ status: 'cancelled' })], '2026-10-28'), null);
  assert.equal(membershipState(card({ starts_on: '2027-10-28', ends_on: '2028-10-26' }), '2026-10-28'), 'upcoming');
  assert.deepEqual(cardDates([card()], '2026-11-01', 365), { starts: '2027-10-28', ends: '2028-10-26', renewal: true });
  assert.deepEqual(cardDates([], '2026-11-01', 365), { starts: '2026-11-01', ends: '2027-10-31', renewal: false });
  assert.equal(memberPctFor('service', card()), 10);
  assert.equal(memberPctFor('product', card()), 5);
  assert.equal(memberPctFor('custom', card()), 0);
  assert.equal(memberPctFor('service', null), 0);
  assert.equal(perksText(card()), '10% off services · 5% off products');
  assert.equal(perksText(card({ product_discount_pct: 0, service_discount_pct: 7.5 })), '7.5% off services');
  assert.equal(pctText(12.5), '12.5%');
  assert.equal(validityText(180), '6 months');
  assert.equal(validityText(365), '1 year');
  assert.equal(validityText(45), '45 days');
});

test('checking what owners type, with the database’s limits', () => {
  const ok = checkPackage({ name: '  6   Facials ', price: 9000, validityDays: 180, items: [{ serviceId: 'f', sessions: 6 }] });
  assert.ok(ok.ok && ok.value.name === '6 Facials');
  const err = (r: { ok: boolean; error?: string }) => (r.ok ? '' : r.error);
  assert.match(err(checkPackage({ name: 'X', price: 9000, validityDays: 180, items: [{ serviceId: 'f', sessions: 6 }] })) ?? '', /name/);
  assert.match(err(checkPackage({ name: 'Pack', price: 0, validityDays: 180, items: [{ serviceId: 'f', sessions: 6 }] })) ?? '', /price/);
  assert.match(err(checkPackage({ name: 'Pack', price: 100, validityDays: 3, items: [{ serviceId: 'f', sessions: 6 }] })) ?? '', /7 days/);
  assert.match(err(checkPackage({ name: 'Pack', price: 100, validityDays: 30, items: [] })) ?? '', /at least one service/);
  assert.match(err(checkPackage({ name: 'Pack', price: 100, validityDays: 30, items: [{ serviceId: 'f', sessions: 1 }, { serviceId: 'f', sessions: 2 }] })) ?? '', /twice/);
  assert.match(err(checkPackage({ name: 'Pack', price: 100, validityDays: 30, items: [{ serviceId: 'f', sessions: 1.5 }] })) ?? '', /whole number/);
  assert.ok(checkPlan({ name: 'Glow Card', fee: 299, validityDays: 365, serviceDiscountPct: 10, productDiscountPct: 0 }).ok);
  assert.match(err(checkPlan({ name: 'Glow Card', fee: 299, validityDays: 365, serviceDiscountPct: 60, productDiscountPct: 0 })) ?? '', /0 to 50%/);
  assert.match(err(checkPlan({ name: 'Glow Card', fee: 299, validityDays: 365, serviceDiscountPct: 0, productDiscountPct: 0 })) ?? '', /discount/);
  assert.match(err(checkPlan({ name: 'Glow Card', fee: 299, validityDays: 10, serviceDiscountPct: 10, productDiscountPct: 0 })) ?? '', /30 days/);
});

test('day close: package sales are money by method, package sessions are not money', async () => {
  const { normalizeSummary, methodRows, isPrepaid, methodLabel, sortMethods } = await import('../src/lib/dayclose');
  const s = normalizeSummary({
    totals: { packages_sold: '23400', packages_sold_count: 3, package_used: '5313', package_refunds: 2000 },
    by_method: { card: { bills: 0, coins: 0, packages: '9000', refunds: 0, net: 9000 }, package: { bills: 9899, refunds: 4586, net: 5313 } },
  });
  assert.equal(s.totals.packages_sold, 23400);
  assert.equal(s.totals.package_used, 5313);
  assert.equal(s.by_method.card.packages, 9000);
  assert.deepEqual(methodRows(s.by_method).map((r) => r.method), ['card', 'package'], 'a method with only package sales is listed');
  assert.ok(isPrepaid('package') && isPrepaid('wallet') && !isPrepaid('cash'));
  assert.equal(methodLabel('package'), 'Package');
  assert.deepEqual(sortMethods(['package', 'cash', 'wallet']), ['cash', 'wallet', 'package']);
});
