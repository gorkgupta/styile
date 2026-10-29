// Sample day-close and expense data for the preview: Glow Studio on Tuesday 27 Oct 2026, end of the day.
// The salon also takes a little Bhutanese Ngultrum cash and Bhutan QR (as parlours near the border do).
import type { DayClose, DaySummary, ExpenseRow, ExpenseReport } from '../src/lib/dayclose';
import { salon, TODAY } from './data';

const ist = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, m) - 330 * 60000).toISOString();
};

export const dayStaff = [
  { id: 'st-priya', name: 'Priya Nair' }, { id: 'st-arjun', name: 'Arjun Das' }, { id: 'st-meera', name: 'Meera Iyer' }, { id: 'st-sana', name: 'Sana Sheikh' },
];

export const daySummary: DaySummary = {
  date: TODAY,
  timezone: 'Asia/Kolkata',
  opening: { cash: 2000, cash_nu: 0, from_date: '2026-10-26' },
  totals: {
    bills: 31, sales: 39298, taxable: 33303.39, tax: 5994.61, discounts: 1480, discounted_bills: 3, due: 1150,
    voids: 1, voids_total: 650,
    received: 44180, refunds: 650, collected: 43530,
    coins_sold: 7000, coins_bonus: 500, coins_used: 3218,
    expenses: 6770, expenses_cash: 2420,
    opening_cash: 2000, cash_in: 11450, cash_refunds: 650, expected_cash: 10380,
    opening_cash_nu: 0, cash_in_nu: 1200, cash_refunds_nu: 0, expected_cash_nu: 1200,
  },
  by_method: {
    cash: { bills: 9450, coins: 2000, refunds: 650, net: 10800 },
    cash_nu: { bills: 1200, coins: 0, refunds: 0, net: 1200 },
    upi: { bills: 18230, coins: 5000, refunds: 0, net: 23230 },
    upi_bhutan: { bills: 1500, coins: 0, refunds: 0, net: 1500 },
    card: { bills: 6800, coins: 0, refunds: 0, net: 6800 },
    wallet: { bills: 3218, coins: 0, refunds: 0, net: 3218 },
  },
  by_staff: [
    { staff_id: 'st-meera', user_id: null, name: 'Meera Iyer', color: '#C2541B', services: 6, sales: 14620.34, collected: 0, collected_by_method: {} },
    { staff_id: 'st-priya', user_id: null, name: 'Priya Nair', color: '#7A3FB8', services: 9, sales: 8135.59, collected: 0, collected_by_method: {} },
    { staff_id: 'st-sana', user_id: null, name: 'Sana Sheikh', color: '#B43D6B', services: 7, sales: 6525.42, collected: 0, collected_by_method: {} },
    { staff_id: 'st-arjun', user_id: null, name: 'Arjun Das', color: '#0F6E73', services: 11, sales: 4022.03, collected: 0, collected_by_method: {} },
    { staff_id: null, user_id: 'u-kavya', name: 'Kavya S', color: null, services: 0, sales: 0, collected: 41030,
      collected_by_method: { cash: 10800, cash_nu: 1200, upi: 20730, upi_bhutan: 1500, card: 6800 } },
    { staff_id: 'st-desk', user_id: null, name: 'Asha Rao', color: '#9A6B00', services: 0, sales: 0, collected: 3150, collected_by_method: { cash: 650, upi: 2500 } },
  ],
  voids: [
    { id: 'inv-1039', invoice_no: 'GS-01039', total: 650, paid: 650, paid_by_method: { cash: 650 }, reason: 'Client didn’t take the service — billed by mistake',
      created_at: ist(TODAY, '16:05'), voided_at: ist(TODAY, '18:40'), voided_by: 'Meera Iyer', billed_by: 'Kavya S', customer: 'Rohan Mehta' },
  ],
  discounts: [
    { id: 'inv-1031', invoice_no: 'GS-01031', discount: 760, subtotal: 3800, total: 3040, billed_by: 'Kavya S', customer: 'Lakshmi Menon', created_at: ist(TODAY, '12:20') },
    { id: 'inv-1036', invoice_no: 'GS-01036', discount: 500, subtotal: 7500, total: 7000, billed_by: 'Asha Rao', customer: 'Divya Shetty', created_at: ist(TODAY, '17:55') },
    { id: 'inv-1028', invoice_no: 'GS-01028', discount: 220, subtotal: 700, total: 480, billed_by: 'Kavya S', customer: 'Imran Qureshi', created_at: ist(TODAY, '11:10') },
  ],
  expenses: {
    count: 4,
    by_paid_from: { cash: 2420, upi: 4350 },
    by_category: { 'Electricity': 4350, 'Products & supplies': 1240, 'Staff advance': 1000, 'Tea & snacks': 180 },
  },
  uses_nu: true,
};

const exp = (id: string, spent_on: string, category: ExpenseRow['category'], amount: number, paid_from: ExpenseRow['paid_from'], note: string | null,
  extra: Partial<ExpenseRow> = {}): ExpenseRow => ({
  id, salon_id: salon.id, spent_on, category, amount, paid_from, note, staff_id: null, created_by: 'u-asha', created_at: ist(spent_on, '12:00'),
  staff_name: null, created_by_name: 'Asha Rao', ...extra,
});

export const todaysExpenses: ExpenseRow[] = [
  exp('ex-1', TODAY, 'Tea & snacks', 180, 'cash', 'Tea and biscuits for clients', { created_by_name: 'Kavya S', created_at: ist(TODAY, '11:30') }),
  exp('ex-2', TODAY, 'Products & supplies', 1240, 'cash', 'Shampoo 5 L, Ravi Stores', { created_by_name: 'Kavya S', created_at: ist(TODAY, '14:15') }),
  exp('ex-3', TODAY, 'Staff advance', 1000, 'cash', 'Festival advance', { staff_id: 'st-arjun', staff_name: 'Arjun Das', created_at: ist(TODAY, '17:00') }),
  exp('ex-4', TODAY, 'Electricity', 4350, 'upi', 'October bill (BESCOM)', { created_at: ist(TODAY, '18:05') }),
];

export const monthExpenses: ExpenseRow[] = [
  ...[...todaysExpenses].reverse(),
  exp('ex-5', '2026-10-26', 'Tea & snacks', 160, 'cash', null, { created_by_name: 'Kavya S' }),
  exp('ex-6', '2026-10-24', 'Repairs', 850, 'cash', 'AC service — front room'),
  exp('ex-7', '2026-10-22', 'Products & supplies', 3680, 'upi', 'Colour tubes ×24, L’Oréal distributor'),
  exp('ex-8', '2026-10-20', 'Marketing', 1200, 'upi', 'Diwali offer pamphlets ×1,000'),
  exp('ex-9', '2026-10-18', 'Tea & snacks', 210, 'cash', null, { created_by_name: 'Kavya S' }),
  exp('ex-10', '2026-10-15', 'Products & supplies', 960, 'cash', 'Towels and foils'),
  exp('ex-11', '2026-10-12', 'Staff advance', 2000, 'cash', null, { staff_id: 'st-sana', staff_name: 'Sana Sheikh' }),
  exp('ex-12', '2026-10-10', 'Other', 300, 'cash', 'Courier'),
  exp('ex-13', '2026-10-05', 'Tea & snacks', 240, 'cash', null, { created_by_name: 'Kavya S' }),
  exp('ex-14', '2026-10-01', 'Rent', 25000, 'bank', 'October rent'),
];

export const recentDays = [
  { date: '2026-10-21', closed: true, difference: 0 },
  { date: '2026-10-22', closed: true, difference: -120 },
  { date: '2026-10-23', closed: true, difference: 0 },
  { date: '2026-10-24', closed: true, difference: 40 },
  { date: '2026-10-25', closed: false, difference: null },
  { date: '2026-10-26', closed: true, difference: 0 },
  { date: '2026-10-27', closed: false, difference: null },
];

/** The same day after the front desk closed it: ₹80 short, Ngultrum matched, most cash handed to the owner. */
export const closedDay: DayClose = {
  id: 'dc-27', salon_id: salon.id, business_date: TODAY,
  opening_cash: 2000, opening_cash_nu: 0, counted_cash: 10300, counted_cash_nu: 1200, cash_out: 9000, cash_out_nu: 1200,
  expected_cash: 10380, expected_cash_nu: 1200, difference: -80, difference_nu: 0,
  by_method: daySummary.by_method, by_staff: daySummary.by_staff, totals: daySummary.totals,
  details: { opening: daySummary.opening, voids: daySummary.voids, discounts: daySummary.discounts, expenses: daySummary.expenses, uses_nu: true, closed_by_name: 'Kavya S' },
  notes: '₹80 short — Arjun paid the parking attendant from the drawer, not entered. Will add it tomorrow.',
  closed_by: 'u-kavya', closed_at: ist(TODAY, '21:12'),
};

export const expenseReport: ExpenseReport = {
  total: 41370, count: 14, staff_advances: 3000,
  by_category: { 'Rent': 25000, 'Electricity': 4350, 'Products & supplies': 5880, 'Staff advance': 3000, 'Tea & snacks': 790, 'Repairs': 850, 'Marketing': 1200, 'Other': 300 },
  by_paid_from: { bank: 25000, upi: 9230, cash: 7140 },
};
