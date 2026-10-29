// Mirrors public.create_invoice() exactly so the POS screen can show the bill before it is saved.
// The database recomputes everything on save; tests/core.test.ts keeps the two in step (same numbers as scripts/db-test).
import { COMPOSITION_RATE, type GstMode } from './gst';

export interface BillLineInput {
  name: string;
  qty: number;
  unitPrice: number;
  discount?: number;  // rupees off this line
  /** Services: the menu's override (null = statutory rate). Products: the rate chosen. Custom: optional. */
  gstRate?: number | null;
  kind?: 'service' | 'product' | 'custom';
}

export interface BillLine extends BillLineInput {
  gross: number; taxable: number; tax: number; lineTotal: number; gstRate: number; discount: number;
}

export interface Bill {
  lines: BillLine[];
  subtotal: number; discountTotal: number; taxableTotal: number;
  cgst: number; sgst: number; taxTotal: number; roundOff: number; total: number;
  /** Composition salons: the 6% they pay themselves (an estimate; never shown to the client). */
  compositionTax: number;
}

export interface BillOptions {
  /** Unregistered and composition salons never charge GST: every line is 0%. */
  gstMode: GstMode;
  pricesIncludeTax: boolean;
  /** Statutory GST on services on the bill date (serviceGstRate(today)). */
  serviceRate: number;
}

/** Round half away from zero to 2 decimals, matching Postgres numeric round(). */
export function round2(n: number): number {
  const s = Math.sign(n) || 1;
  return (s * Math.round(Math.abs(n) * 100 + 1e-9)) / 100;
}
export function round0(n: number): number {
  const s = Math.sign(n) || 1;
  return s * Math.round(Math.abs(n) + 1e-9);
}

export function computeBill(items: BillLineInput[], opts: BillOptions): Bill {
  let subtotal = 0, discountTotal = 0, taxableTotal = 0, taxTotal = 0, lines = 0;
  const out: BillLine[] = items.map((it) => {
    const rate = opts.gstMode === 'regular' ? it.gstRate ?? opts.serviceRate : 0;
    const discount = round2(it.discount ?? 0);
    const base = round2(it.qty * it.unitPrice);
    const gross = round2(Math.max(base - discount, 0));
    let taxable: number, tax: number, lineTotal: number;
    if (opts.pricesIncludeTax) {
      taxable = round2((gross * 100) / (100 + rate));
      tax = round2(gross - taxable);
      lineTotal = gross;
    } else {
      taxable = gross;
      tax = round2((gross * rate) / 100);
      lineTotal = round2(gross + tax);
    }
    subtotal += base; discountTotal += discount; taxableTotal += taxable; taxTotal += tax; lines += lineTotal;
    return { ...it, gstRate: rate, discount, gross, taxable, tax, lineTotal };
  });
  subtotal = round2(subtotal); discountTotal = round2(discountTotal); taxableTotal = round2(taxableTotal);
  taxTotal = round2(taxTotal); lines = round2(lines);
  const total = round0(lines);
  const cgst = round2(taxTotal / 2);
  return {
    lines: out, subtotal, discountTotal, taxableTotal,
    cgst, sgst: round2(taxTotal - cgst), taxTotal, roundOff: round2(total - lines), total,
    compositionTax: opts.gstMode === 'composition' ? round2((total * COMPOSITION_RATE) / 100) : 0,
  };
}

/** GST per rate for a tax invoice's summary ("5% on ₹571.43 = ₹28.57"), highest rate last. */
export function taxByRate(lines: { gst_rate: number | string; taxable: number | string; tax: number | string }[]) {
  const by = new Map<number, { rate: number; taxable: number; tax: number }>();
  for (const l of lines) {
    const rate = Number(l.gst_rate);
    const row = by.get(rate) ?? { rate, taxable: 0, tax: 0 };
    row.taxable = round2(row.taxable + Number(l.taxable));
    row.tax = round2(row.tax + Number(l.tax));
    by.set(rate, row);
  }
  return [...by.values()].sort((a, b) => a.rate - b.rate);
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 2 });

/** ₹1,24,500 — Indian digit grouping; paise shown only when present. */
export function money(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return Number.isInteger(v) ? inr.format(v) : inr2.format(v);
}
/** Always two decimals — for invoices. */
export function money2(n: number | string | null | undefined): string {
  return inr2.format(Number(n ?? 0));
}

/** Amount in words for invoices: "Rupees One Thousand Two Hundred Forty Nine Only" (Indian system). */
export function amountInWords(n: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
    'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x: number) => (x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? ' ' + ones[x % 10] : ''}`);
  const three = (x: number) => {
    const h = Math.floor(x / 100), r = x % 100;
    return [h ? `${ones[h]} Hundred` : '', r ? two(r) : ''].filter(Boolean).join(' ');
  };
  let rupees = Math.floor(Math.abs(n));
  const paise = Math.round((Math.abs(n) - rupees) * 100);
  if (rupees === 0 && paise === 0) return 'Rupees Zero Only';
  const parts: string[] = [];
  const crore = Math.floor(rupees / 1e7); rupees %= 1e7;
  const lakh = Math.floor(rupees / 1e5); rupees %= 1e5;
  const thousand = Math.floor(rupees / 1000); rupees %= 1000;
  if (crore) parts.push(`${crore >= 100 ? three(crore) : two(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (rupees) parts.push(three(rupees));
  let s = parts.length ? `Rupees ${parts.join(' ')}` : 'Rupees Zero';
  if (paise) s += ` and ${two(paise)} Paise`;
  return `${s} Only`;
}
