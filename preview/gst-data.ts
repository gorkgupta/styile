// Sample bills for the three GST modes (0007). Totals come from computeBill, so they match what the database would store.
import { computeBill, type BillLineInput } from '../src/lib/billing';
import { billTypeFor, placeOfSupply, type GstMode } from '../src/lib/gst';
import type { Invoice, InvoiceItem, Payment, PayMethod, Salon, SalonReport } from '../src/lib/types';
import { salonWithCoins } from './coins-data';
import { report as baseReport } from './data';

const ist = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, m) - 330 * 60000).toISOString();
};

/** Glow Studio, Bengaluru: regular GST (tax invoices). */
export const regularSalon: Salon = { ...salonWithCoins, gst_mode: 'regular', default_gst_rate: 5 };

/** A small Jaigaon parlour under ₹20 lakh: not registered, plain bills. */
export const plainSalon: Salon = {
  ...salonWithCoins, id: 'salon-tashi', name: 'Tashi Beauty Parlour', slug: 'tashi-beauty', legal_name: null, gstin: null, gst_mode: 'unregistered',
  phone: '919733012345', email: null, address: 'NS Road, near Bhutan Gate', city: 'Jaigaon', state: 'West Bengal', pincode: '736182',
  invoice_prefix: 'TBP', next_invoice_no: 219, default_gst_rate: 5, wa_phone_number_id: null, wa_display_number: null,
};

/** A busier Jaigaon unisex salon on the composition scheme: bills of supply. */
export const bosSalon: Salon = {
  ...salonWithCoins, id: 'salon-dooars', name: 'Dooars Unisex Salon', slug: 'dooars-salon', legal_name: 'Dooars Unisex Salon', gstin: '19AKQPT4821M1Z6',
  gst_mode: 'composition', phone: '919832054321', email: 'dooarssalon@gmail.com', address: 'Main Road, Jaigaon Bazar', city: 'Jaigaon', state: 'West Bengal',
  pincode: '736182', invoice_prefix: 'DUS', next_invoice_no: 1408, default_gst_rate: 5,
};

export type SampleLine = BillLineInput & { id: string; kind: 'service' | 'product' | 'custom'; code: string | null; staff_id?: string | null; service_id?: string | null };

/** Build an invoice + lines the way create_invoice() would for this salon's GST mode. */
export function sampleBill(salon: Salon, no: string, at: string, customerId: string | null, lines: SampleLine[], pays: { method: PayMethod; amount: number; reference?: string }[],
  extra: Partial<Invoice> = {}): { invoice: Invoice; items: InvoiceItem[]; payments: Payment[] } {
  const mode: GstMode = salon.gst_mode;
  const b = computeBill(lines, { gstMode: mode, pricesIncludeTax: salon.prices_include_tax, serviceRate: 5 });
  const id = `inv-${no}`;
  const paid = pays.reduce((s, p) => s + p.amount, 0);
  const invoice: Invoice = {
    id, salon_id: salon.id, invoice_no: no, customer_id: customerId, appointment_id: null, prices_include_tax: salon.prices_include_tax,
    subtotal: b.subtotal, discount_total: b.discountTotal, taxable_total: b.taxableTotal, cgst: b.cgst, sgst: b.sgst, igst: 0,
    round_off: b.roundOff, total: b.total, paid_total: paid, status: paid >= b.total ? 'paid' : paid > 0 ? 'partial' : 'unpaid',
    notes: null, void_reason: null, created_at: at,
    gst_mode: mode, bill_type: billTypeFor(mode), seller_gstin: mode === 'unregistered' ? null : salon.gstin,
    place_of_supply: mode === 'regular' ? placeOfSupply(salon.state, salon.gstin) : null, client_gstin: null, client_address: null,
    composition_tax: b.compositionTax, ...extra,
  };
  const items: InvoiceItem[] = b.lines.map((l, i) => ({
    id: `${id}-${i + 1}`, invoice_id: id, kind: lines[i].kind, service_id: lines[i].service_id ?? null, staff_id: lines[i].staff_id ?? null,
    name: l.name, qty: l.qty, unit_price: l.unitPrice, discount: l.discount, gst_rate: l.gstRate, taxable: l.taxable, tax: l.tax, line_total: l.lineTotal,
    code: lines[i].code,
  }));
  const payments: Payment[] = pays.map((p, i) => ({ id: `${id}-p${i + 1}`, invoice_id: id, method: p.method, amount: p.amount, reference: p.reference ?? null, created_at: at }));
  return { invoice, items, payments };
}

/** x1 — Glow Studio tax invoice: two services at 5%, a 5% shampoo and an 18% serum. */
export const taxInvoice = sampleBill(regularSalon, 'GS-01041', '2026-10-27T06:42:00.000Z', 'cu-7', [
  { id: 'a', kind: 'service', service_id: 's-global', staff_id: 'st-meera', name: 'Global colour', qty: 1, unitPrice: 3800, discount: 380, gstRate: null, code: '999721' },
  { id: 'b', kind: 'service', service_id: 's-blow', staff_id: 'st-priya', name: 'Wash & blow-dry', qty: 1, unitPrice: 500, gstRate: null, code: '999721' },
  { id: 'c', kind: 'product', name: 'Colour-protect shampoo 250 ml', qty: 2, unitPrice: 649, gstRate: 5, code: '3305' },
  { id: 'd', kind: 'product', name: 'Hydrating face serum 30 ml', qty: 1, unitPrice: 1180, gstRate: 18, code: '3304' },
], [{ method: 'upi', amount: 5000, reference: 'UPI 6273 1842' }, { method: 'cash', amount: 1398 }]);

/** b2b — a tax invoice to a hotel with its GSTIN (bridal party make-up). */
export const b2bInvoice = sampleBill(regularSalon, 'GS-01039', '2026-10-25T11:10:00.000Z', 'cu-9', [
  { id: 'a', kind: 'service', staff_id: 'st-sana', name: 'Party make-up', qty: 4, unitPrice: 2500, gstRate: null, code: '999722' },
  { id: 'b', kind: 'service', staff_id: 'st-meera', name: 'Hair styling', qty: 4, unitPrice: 1200, gstRate: null, code: '999721' },
], [{ method: 'card', amount: 14800, reference: '4417' }], {
  client_gstin: '29AABCH1234K1ZP', client_address: 'Hotel Indigo Residency, 80 Feet Road, Koramangala, Bengaluru 560034',
});

/** bos — Dooars Unisex Salon bill of supply: no tax lines, composition declaration. */
export const bosInvoice = sampleBill(bosSalon, 'DUS-01407', ist('2026-10-27', '17:20'), 'cu-j1', [
  { id: 'a', kind: 'service', name: 'Facial (fruit)', qty: 1, unitPrice: 800, gstRate: null, code: '999722' },
  { id: 'b', kind: 'service', name: 'Threading (eyebrows)', qty: 1, unitPrice: 50, gstRate: null, code: '999729' },
  { id: 'c', kind: 'product', name: 'Kesh King hair oil 100 ml', qty: 1, unitPrice: 199, gstRate: 0, code: null },
], [{ method: 'upi', amount: 1049, reference: 'UPI 8812 0091' }]);

/** plain — Tashi Beauty Parlour, not registered: a plain bill, part paid in cash. */
export const plainInvoice = sampleBill(plainSalon, 'TBP-00218', ist('2026-10-27', '12:05'), 'cu-j2', [
  { id: 'a', kind: 'service', name: 'Haircut (ladies)', qty: 1, unitPrice: 250, gstRate: null, code: '999721' },
  { id: 'b', kind: 'service', name: 'Hair spa', qty: 1, unitPrice: 600, gstRate: null, code: '999721' },
  { id: 'c', kind: 'custom', name: 'Waxing (full arms)', qty: 1, unitPrice: 300, discount: 50, gstRate: null, code: '999729' },
], [{ method: 'cash', amount: 500 }]);

export const jaigaonClients = {
  'cu-j1': { id: 'cu-j1', name: 'Sonam Lhamo', phone: '919733055501', email: null, coin_balance: 0 },
  'cu-j2': { id: 'cu-j2', name: 'Rinku Sharma', phone: '919733055502', email: null, coin_balance: 0 },
};

/** Reports for each mode (on top of the shared sample report). */
export const gstReports: Record<GstMode, SalonReport> = {
  regular: { ...baseReport, tax: 18440, composition_tax: 0, fy_turnover: 2160000, fy_from: '2026-04-01' },
  composition: { ...baseReport, revenue: 214600, collected: 214600, tax: 0, composition_tax: 12876, fy_turnover: 2905000, fy_from: '2026-04-01' },
  unregistered: { ...baseReport, revenue: 61800, collected: 59400, bills: 214, avg_bill: 289, tax: 0, composition_tax: 0, fy_turnover: 1684000, fy_from: '2026-04-01' },
};
