// Day-end close and expenses: types and pure helpers shared by the actions, pages and screens.
// The database (0009_day_close.sql) does the maths in day_summary() / close_day(); this file only shapes and labels it.
import { addDays, isValidDateStr } from './time';
import { isPrepaidMethod, METHOD_LABEL, type PayMethod } from './types';

// ---------- Expenses ----------
export const EXPENSE_CATEGORIES = ['Rent', 'Electricity', 'Products & supplies', 'Staff advance', 'Tea & snacks', 'Repairs', 'Marketing', 'Other'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const PAID_FROM = ['cash', 'upi', 'card', 'bank', 'other'] as const;
export type PaidFrom = (typeof PAID_FROM)[number];
export const PAID_FROM_LABEL: Record<PaidFrom, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', bank: 'Bank', other: 'Other' };
/** Longer form for the add-expense sheet. */
export const PAID_FROM_HINT: Record<PaidFrom, string> = {
  cash: 'Taken from the cash drawer — lowers the cash expected at closing',
  upi: 'Paid from the salon’s UPI', card: 'Paid by card', bank: 'Bank transfer or cheque', other: 'Paid some other way',
};

export interface Expense {
  id: string; salon_id: string; spent_on: string; category: ExpenseCategory; amount: number; paid_from: PaidFrom;
  note: string | null; staff_id: string | null; created_by: string | null; created_at: string;
}

/** An expense as the screens show it (names joined on the server). */
export interface ExpenseRow extends Expense { staff_name: string | null; created_by_name: string | null }

/** Largest single expense (same limit as the database check). */
export const MAX_EXPENSE = 10000000;

export const isExpenseCategory = (c: unknown): c is ExpenseCategory => typeof c === 'string' && (EXPENSE_CATEGORIES as readonly string[]).includes(c);
export const isPaidFrom = (p: unknown): p is PaidFrom => typeof p === 'string' && (PAID_FROM as readonly string[]).includes(p);

// ---------- Months (expenses list) ----------
export function isValidMonth(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}
/** First and last date of a "YYYY-MM" month. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { from: `${month}-01`, to: addDays(next, -1) };
}
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

// ---------- Payment methods ----------
// Labels for methods this build may not know yet (the pay_method enum grows over time). Anything else is title-cased.
const EXTRA_METHOD_LABEL: Record<string, string> = { cash_nu: 'Cash (Nu)', upi_bhutan: 'UPI (Bhutan)' };

export function methodLabel(method: string): string {
  return METHOD_LABEL[method as PayMethod] ?? EXTRA_METHOD_LABEL[method]
    ?? method.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
/** Physical cash in the drawer: 'cash' (rupees) or any 'cash_…' method (e.g. Ngultrum). */
export const isCashMethod = (m: string) => m === 'cash' || m.startsWith('cash_');
/** Cash counted separately from rupees (Bhutanese Ngultrum). */
export const isNuCash = (m: string) => m.startsWith('cash_');
/** Coins: paid from a prepaid balance — not money received today. */
export const isCoins = (m: string) => m === 'wallet';
/** Paid from something bought earlier (coins, package sessions) — not money received today. */
export const isPrepaid = (m: string) => isPrepaidMethod(m);

const METHOD_ORDER = ['cash', 'cash_nu', 'upi', 'upi_bhutan', 'card', 'other', 'wallet', 'package', 'advance'];
export function sortMethods(methods: string[]): string[] {
  // Unknown methods go after 'other', before coins.
  const rank = (m: string) => { const i = METHOD_ORDER.indexOf(m); return i < 0 ? METHOD_ORDER.indexOf('wallet') - 0.5 : i; };
  return [...methods].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
/** "Nu 1,250" — Bhutanese Ngultrum (pegged 1:1 to the rupee). */
export function fmtNu(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return `${v < 0 ? '−' : ''}Nu ${nf.format(Math.abs(v))}`;
}

// ---------- Day summary ----------
export interface DayTotals {
  bills: number; sales: number; taxable: number; tax: number; discounts: number; discounted_bills: number; due: number;
  voids: number; voids_total: number;
  /** Money in (not coins) − handed back on cancelled bills. */
  received: number; refunds: number; collected: number;
  coins_sold: number; coins_bonus: number; coins_used: number;
  /** Money taken for packages sold (an advance), handed back on cancelled packages, and package sessions used on bills. */
  packages_sold: number; packages_sold_count: number; package_refunds: number; package_used: number;
  /** Advances taken for bridal / event bookings (money, by method), handed back, and applied on bills (not money). */
  advances_received: number; advances_received_count: number; advance_refunds: number; advance_used: number;
  expenses: number; expenses_cash: number;
  opening_cash: number; cash_in: number; cash_refunds: number; expected_cash: number;
  opening_cash_nu: number; cash_in_nu: number; cash_refunds_nu: number; expected_cash_nu: number;
}
/** Money by payment method: on bills, for coins sold, for packages sold, advances taken, handed back; net = in − back. */
export interface MethodRow { bills: number; coins: number; packages: number; advances: number; refunds: number; net: number }
export interface DayStaffRow {
  staff_id: string | null; user_id: string | null; name: string; color: string | null;
  services: number; sales: number; collected: number; collected_by_method: Record<string, number>;
}
export interface DayVoid {
  id: string; invoice_no: string; total: number; paid: number; paid_by_method: Record<string, number>; reason: string | null;
  created_at: string; voided_at: string; voided_by: string | null; billed_by: string | null; customer: string | null;
}
export interface DayDiscount {
  id: string; invoice_no: string; discount: number; subtotal: number; total: number; billed_by: string | null; customer: string | null; created_at: string;
}
export interface DaySummary {
  date: string; timezone: string;
  opening: { cash: number; cash_nu: number; from_date: string | null };
  totals: DayTotals;
  by_method: Record<string, MethodRow>;
  by_staff: DayStaffRow[];
  voids: DayVoid[];
  discounts: DayDiscount[];
  expenses: { count: number; by_paid_from: Partial<Record<PaidFrom, number>>; by_category: Partial<Record<ExpenseCategory, number>> };
  uses_nu: boolean;
}

/** A row of day_closes. */
export interface DayClose {
  id: string; salon_id: string; business_date: string;
  opening_cash: number; opening_cash_nu: number; counted_cash: number; counted_cash_nu: number | null;
  cash_out: number; cash_out_nu: number | null; expected_cash: number; expected_cash_nu: number;
  difference: number; difference_nu: number | null;
  by_method: Record<string, MethodRow>; by_staff: DayStaffRow[]; totals: DayTotals;
  details: Partial<Pick<DaySummary, 'opening' | 'voids' | 'discounts' | 'expenses' | 'uses_nu'>> & { closed_by_name?: string | null };
  notes: string | null; closed_by: string | null; closed_at: string;
}

const num = (v: unknown) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
const numMap = (o: unknown): Record<string, number> =>
  Object.fromEntries(Object.entries((o ?? {}) as Record<string, unknown>).map(([k, v]) => [k, num(v)]));

const TOTAL_KEYS: (keyof DayTotals)[] = ['bills', 'sales', 'taxable', 'tax', 'discounts', 'discounted_bills', 'due', 'voids', 'voids_total',
  'received', 'refunds', 'collected', 'coins_sold', 'coins_bonus', 'coins_used',
  'packages_sold', 'packages_sold_count', 'package_refunds', 'package_used',
  'advances_received', 'advances_received_count', 'advance_refunds', 'advance_used', 'expenses', 'expenses_cash',
  'opening_cash', 'cash_in', 'cash_refunds', 'expected_cash', 'opening_cash_nu', 'cash_in_nu', 'cash_refunds_nu', 'expected_cash_nu'];

/** Coerce the JSON from day_summary() (or a stored snapshot) into a DaySummary with real numbers and safe defaults. */
export function normalizeSummary(raw: unknown, date = ''): DaySummary {
  const r = (raw ?? {}) as Record<string, any>;
  const totals = Object.fromEntries(TOTAL_KEYS.map((k) => [k, num(r.totals?.[k])])) as unknown as DayTotals;
  const byMethod: Record<string, MethodRow> = {};
  for (const [m, v] of Object.entries((r.by_method ?? {}) as Record<string, any>)) {
    byMethod[m] = { bills: num(v?.bills), coins: num(v?.coins), packages: num(v?.packages), advances: num(v?.advances), refunds: num(v?.refunds), net: num(v?.net) };
  }
  return {
    date: r.date ?? date,
    timezone: r.timezone ?? 'Asia/Kolkata',
    opening: { cash: num(r.opening?.cash), cash_nu: num(r.opening?.cash_nu), from_date: r.opening?.from_date ?? null },
    totals,
    by_method: byMethod,
    by_staff: ((r.by_staff ?? []) as any[]).map((s) => ({
      staff_id: s.staff_id ?? null, user_id: s.user_id ?? null, name: s.name ?? 'Team member', color: s.color ?? null,
      services: num(s.services), sales: num(s.sales), collected: num(s.collected), collected_by_method: numMap(s.collected_by_method),
    })),
    voids: ((r.voids ?? []) as any[]).map((v) => ({ ...v, total: num(v.total), paid: num(v.paid), paid_by_method: numMap(v.paid_by_method) })),
    discounts: ((r.discounts ?? []) as any[]).map((d) => ({ ...d, discount: num(d.discount), subtotal: num(d.subtotal), total: num(d.total) })),
    expenses: { count: num(r.expenses?.count), by_paid_from: numMap(r.expenses?.by_paid_from), by_category: numMap(r.expenses?.by_category) },
    uses_nu: !!r.uses_nu,
  };
}

/** The frozen summary stored with a close. */
export function summaryFromClose(c: DayClose): DaySummary {
  return normalizeSummary({ ...c.details, date: c.business_date, totals: c.totals, by_method: c.by_method, by_staff: c.by_staff }, c.business_date);
}

export type CashCheck = { amount: number; kind: 'balanced' | 'excess' | 'short' };
/** Counted − expected, to the paisa. */
export function cashDifference(counted: number, expected: number): CashCheck {
  const amount = Math.round((counted - expected) * 100) / 100;
  return { amount, kind: Math.abs(amount) < 0.005 ? 'balanced' : amount > 0 ? 'excess' : 'short' };
}

/** Methods present in a summary, money first, coins last; zero rows dropped. */
export function methodRows(byMethod: Record<string, MethodRow>): { method: string; row: MethodRow }[] {
  return sortMethods(Object.keys(byMethod))
    .map((method) => ({ method, row: byMethod[method] }))
    .filter(({ row }) => row.bills || row.coins || row.packages || row.advances || row.refunds);
}

/** True when the Ngultrum count should be asked for. */
export function showsNu(s: DaySummary): boolean {
  return s.uses_nu || s.totals.cash_in_nu !== 0 || s.totals.expected_cash_nu !== 0 || s.opening.cash_nu !== 0;
}

/** A day that can be closed: a real date, not after the salon's today. */
export function isClosableDate(date: unknown, today: string): date is string {
  return isValidDateStr(date) && date <= today;
}

/** A day_closes row with its numeric columns as numbers. */
export function normalizeClose(raw: unknown): DayClose {
  const r = raw as DayClose;
  const n = (v: unknown) => (v == null ? null : num(v));
  return {
    ...r,
    opening_cash: num(r.opening_cash), opening_cash_nu: num(r.opening_cash_nu), counted_cash: num(r.counted_cash),
    counted_cash_nu: n(r.counted_cash_nu), cash_out: num(r.cash_out), cash_out_nu: n(r.cash_out_nu),
    expected_cash: num(r.expected_cash), expected_cash_nu: num(r.expected_cash_nu), difference: num(r.difference), difference_nu: n(r.difference_nu),
    details: r.details ?? {},
  };
}

// ---------- Reports ----------
export interface ExpenseReport {
  total: number; count: number; staff_advances: number;
  by_category: Partial<Record<ExpenseCategory, number>>; by_paid_from: Partial<Record<PaidFrom, number>>;
}
export const EMPTY_EXPENSE_REPORT: ExpenseReport = { total: 0, count: 0, staff_advances: 0, by_category: {}, by_paid_from: {} };

export function normalizeExpenseReport(raw: unknown): ExpenseReport {
  const r = (raw ?? {}) as Record<string, unknown>;
  return { total: num(r.total), count: num(r.count), staff_advances: num(r.staff_advances), by_category: numMap(r.by_category), by_paid_from: numMap(r.by_paid_from) };
}

/**
 * Profit after expenses, before staff pay: sales before GST minus running expenses. Staff advances are part of
 * staff pay (recovered from salaries), so they are left out here.
 */
export function profitAfterExpenses(revenue: number, tax: number, e: ExpenseReport): { netSales: number; expenses: number; profit: number } {
  const netSales = Math.round((revenue - tax) * 100) / 100;
  const expenses = Math.round((e.total - e.staff_advances) * 100) / 100;
  return { netSales, expenses, profit: Math.round((netSales - expenses) * 100) / 100 };
}
