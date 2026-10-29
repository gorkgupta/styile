// GST modes and rates: the same cases as the "GST modes (0007)" block in scripts/db-test/tests.sql.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBill, taxByRate } from '../src/lib/billing';
import {
  billDocument, billTypeFor, BUSINESS_GSTIN_RE, financialYear, HSN_RE, placeOfSupply, serviceGstRate, stateByName, INDIAN_STATES,
} from '../src/lib/gst';

test('salon services: 18% until 21 Sep 2025, 5% from 22 Sep 2025', () => {
  assert.equal(serviceGstRate('2025-09-21'), 18);
  assert.equal(serviceGstRate('2025-09-22'), 5);
  assert.equal(serviceGstRate('2026-10-28'), 5);
});

test('unregistered salon: plain bill, no tax on any line (959 = 600 + 299 + 60)', () => {
  const b = computeBill([
    { kind: 'service', name: 'Haircut', qty: 1, unitPrice: 600, gstRate: 18 },
    { kind: 'product', name: 'Hair oil', qty: 2, unitPrice: 149.5, gstRate: 5 },
    { kind: 'custom', name: 'Threading', qty: 1, unitPrice: 60 },
  ], { gstMode: 'unregistered', pricesIncludeTax: true, serviceRate: 5 });
  assert.equal(b.total, 959);
  assert.equal(b.taxableTotal, 959);
  assert.equal(b.taxTotal + b.cgst + b.sgst, 0);
  assert.ok(b.lines.every((l) => l.gstRate === 0 && l.tax === 0));
  assert.equal(b.compositionTax, 0);
  // Exclusive pricing changes nothing when no tax is charged.
  assert.equal(computeBill([{ name: 'Haircut', qty: 1, unitPrice: 600 }], { gstMode: 'unregistered', pricesIncludeTax: false, serviceRate: 5 }).total, 600);
});

test('composition salon: bill of supply, zero tax, 6% composition tax estimate (1549 -> 92.94)', () => {
  const b = computeBill([
    { kind: 'service', name: 'Facial', qty: 1, unitPrice: 1200, gstRate: 18 },
    { kind: 'product', name: 'Lipstick', qty: 1, unitPrice: 349, gstRate: 18 },
  ], { gstMode: 'composition', pricesIncludeTax: true, serviceRate: 5 });
  assert.equal(b.total, 1549);
  assert.equal(b.taxTotal, 0);
  assert.equal(b.compositionTax, 92.94);
});

test('regular salon: 5% on services, product rates as chosen (3305 = 3171.43 + 133.57)', () => {
  const b = computeBill([
    { kind: 'service', name: 'Haircut', qty: 1, unitPrice: 600, gstRate: null },
    { kind: 'service', name: 'Facial', qty: 1, unitPrice: 1800, gstRate: 0 }, // menu override
    { kind: 'product', name: 'Face cream', qty: 1, unitPrice: 590, gstRate: 18 },
    { kind: 'product', name: 'Shampoo', qty: 1, unitPrice: 315, gstRate: 5 },
  ], { gstMode: 'regular', pricesIncludeTax: true, serviceRate: 5 });
  assert.equal(b.total, 3305);
  assert.equal(b.taxableTotal, 3171.43);
  assert.equal(b.taxTotal, 133.57);
  assert.deepEqual(b.lines.map((l) => l.gstRate), [5, 0, 18, 5]);
  const summary = taxByRate(b.lines.map((l) => ({ gst_rate: l.gstRate, taxable: l.taxable, tax: l.tax })));
  assert.deepEqual(summary, [
    { rate: 0, taxable: 1800, tax: 0 },
    { rate: 5, taxable: 871.43, tax: 43.57 },
    { rate: 18, taxable: 500, tax: 90 },
  ]);
});

test('bill types: title, declaration and what each may show', () => {
  assert.equal(billTypeFor('unregistered'), 'bill');
  assert.equal(billTypeFor('composition'), 'bill_of_supply');
  assert.equal(billTypeFor('regular'), 'tax_invoice');
  const plain = billDocument('bill');
  assert.deepEqual([plain.title, plain.showTax, plain.showGstin, plain.declaration], ['Bill', false, false, null]);
  const bos = billDocument('bill_of_supply');
  assert.deepEqual([bos.title, bos.showTax, bos.showGstin], ['Bill of Supply', false, true]);
  assert.equal(bos.declaration, 'Composition taxable person, not eligible to collect tax on supplies');
  const ti = billDocument('tax_invoice');
  assert.deepEqual([ti.title, ti.showTax, ti.showGstin, ti.declaration], ['Tax Invoice', true, true, null]);
});

test('place of supply, state codes and GSTIN formats', () => {
  assert.equal(placeOfSupply('West Bengal', null), 'West Bengal (19)');
  assert.equal(placeOfSupply('Karnataka', '19ABCDE1234F1Z5'), 'West Bengal (19)', 'GSTIN state wins');
  assert.equal(placeOfSupply('Jammu & Kashmir', null), 'Jammu and Kashmir (01)');
  assert.equal(placeOfSupply('  ', null), null);
  assert.equal(stateByName('west bengal')?.code, '19');
  assert.equal(new Set(INDIAN_STATES.map((s) => s.code)).size, INDIAN_STATES.length);
  assert.ok(BUSINESS_GSTIN_RE.test('19PQRST1234K1Z9'));
  assert.ok(!BUSINESS_GSTIN_RE.test('19PQRST1234K1Z'));
  assert.ok(!BUSINESS_GSTIN_RE.test('19pqrst1234k1z9'));
  assert.ok(HSN_RE.test('3305') && HSN_RE.test('330499') && HSN_RE.test('33049910') && !HSN_RE.test('33049') && !HSN_RE.test('33A4'));
});

test('financial year runs April to March', () => {
  assert.deepEqual(financialYear('2026-10-28'), { from: '2026-04-01', to: '2027-03-31', label: '2026–27' });
  assert.deepEqual(financialYear('2027-03-31'), { from: '2026-04-01', to: '2027-03-31', label: '2026–27' });
  assert.equal(financialYear('2027-04-01').from, '2027-04-01');
});
