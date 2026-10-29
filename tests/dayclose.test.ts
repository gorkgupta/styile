// Day close and expense helpers (the money maths itself lives in day_summary(), tested in scripts/db-test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonths, cashDifference, EXPENSE_CATEGORIES, fmtNu, isCashMethod, isClosableDate, isNuCash, isValidMonth, methodLabel, methodRows,
  monthLabel, monthRange, normalizeClose, normalizeSummary, profitAfterExpenses, showsNu, sortMethods, summaryFromClose,
} from '../src/lib/dayclose';

test('payment methods: known labels, fallbacks for new enum values, cash detection', () => {
  assert.equal(methodLabel('cash'), 'Cash');
  assert.equal(methodLabel('wallet'), 'Coins');
  assert.equal(methodLabel('cash_nu'), 'Cash (Nu)');
  assert.equal(methodLabel('upi_bhutan'), 'UPI (Bhutan)');
  assert.equal(methodLabel('bank_transfer'), 'Bank transfer');
  assert.ok(isCashMethod('cash') && isCashMethod('cash_nu') && !isCashMethod('card') && !isCashMethod('upi'));
  assert.ok(isNuCash('cash_nu') && !isNuCash('cash'));
  assert.deepEqual(sortMethods(['wallet', 'card', 'bank_transfer', 'upi', 'cash_nu', 'cash']), ['cash', 'cash_nu', 'upi', 'card', 'bank_transfer', 'wallet']);
});

test('cash difference to the paisa', () => {
  assert.deepEqual(cashDifference(4400, 4480), { amount: -80, kind: 'short' });
  assert.deepEqual(cashDifference(4500.5, 4480), { amount: 20.5, kind: 'excess' });
  assert.equal(cashDifference(0.1 + 0.2, 0.3).kind, 'balanced');
  assert.equal(fmtNu(1250), 'Nu 1,250');
  assert.equal(fmtNu(-80), '−Nu 80');
});

test('summaries are normalised from day_summary() JSON and from a stored close', () => {
  const raw = {
    date: '2026-10-20', opening: { cash: '1500', cash_nu: 0, from_date: '2026-10-19' },
    totals: { bills: 5, sales: '4000.00', expected_cash: '4480.00', cash_in_nu: 0 },
    by_method: { cash: { bills: '2600', coins: 2000, refunds: 500, net: 4100 }, wallet: { bills: 700, coins: 0, refunds: 0, net: 700 }, upi: { bills: 0, coins: 0, refunds: 0, net: 0 } },
    by_staff: [{ staff_id: 's1', name: 'Karma', collected: '6400', collected_by_method: { cash: '4600', upi: 1800 } }],
    voids: [{ id: 'v', invoice_no: 'INV-3', total: '500', paid: 500, paid_by_method: { cash: '500' } }],
  };
  const s = normalizeSummary(raw);
  assert.equal(s.totals.sales, 4000);
  assert.equal(s.totals.expected_cash, 4480);
  assert.equal(s.totals.refunds, 0, 'missing totals default to 0');
  assert.equal(s.opening.cash, 1500);
  assert.equal(s.by_staff[0].collected_by_method.cash, 4600);
  assert.equal(s.voids[0].paid_by_method.cash, 500);
  assert.deepEqual(s.expenses, { count: 0, by_paid_from: {}, by_category: {} });
  assert.deepEqual(methodRows(s.by_method).map((r) => r.method), ['cash', 'wallet'], 'zero rows dropped, coins last');
  assert.equal(showsNu(s), false);
  assert.equal(showsNu({ ...s, opening: { ...s.opening, cash_nu: 300 } }), true);

  const close = normalizeClose({
    id: 'c', salon_id: 'x', business_date: '2026-10-20', opening_cash: '1500', opening_cash_nu: '0', counted_cash: '4400', counted_cash_nu: null,
    cash_out: '4000', cash_out_nu: null, expected_cash: '4480', expected_cash_nu: '0', difference: '-80', difference_nu: null,
    by_method: raw.by_method, by_staff: raw.by_staff, totals: raw.totals, details: { opening: raw.opening, voids: raw.voids, closed_by_name: 'Karma' },
    notes: null, closed_by: null, closed_at: '2026-10-20T16:00:00Z',
  });
  assert.equal(close.difference, -80);
  assert.equal(close.counted_cash_nu, null);
  const snap = summaryFromClose(close);
  assert.equal(snap.date, '2026-10-20');
  assert.equal(snap.totals.expected_cash, 4480);
  assert.equal(snap.voids.length, 1);
});

test('months and closable dates', () => {
  assert.deepEqual(monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(monthRange('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
  assert.deepEqual(monthRange('2026-12'), { from: '2026-12-01', to: '2026-12-31' });
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-11', 2), '2027-01');
  assert.equal(monthLabel('2026-10'), 'October 2026');
  assert.ok(isValidMonth('2026-10') && !isValidMonth('2026-13') && !isValidMonth('26-10'));
  assert.ok(isClosableDate('2026-10-27', '2026-10-27'));
  assert.ok(!isClosableDate('2026-10-28', '2026-10-27'), 'future');
  assert.ok(!isClosableDate('2026-02-30', '2026-10-27'), 'not a date');
  assert.equal(EXPENSE_CATEGORIES.length, 8);
});

test('profit after expenses leaves out GST and staff advances', () => {
  const r = profitAfterExpenses(118000, 18000, { total: 41370, count: 14, staff_advances: 3000, by_category: {}, by_paid_from: {} });
  assert.deepEqual(r, { netSales: 100000, expenses: 38370, profit: 61630 });
});
