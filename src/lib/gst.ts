// GST rules for salon bills, mirroring supabase/migrations/0007_gst_modes.sql.
// This is the app's reading of the rules, not tax advice — salons should confirm with their CA.

export type GstMode = 'unregistered' | 'composition' | 'regular';
export type BillType = 'bill' | 'bill_of_supply' | 'tax_invoice';

/** GST slabs a line may carry. */
export const GST_SLABS = [0, 5, 12, 18, 28] as const;

/** Salon/beauty services moved from 18% to a mandatory 5% (no input tax credit) on this date. */
export const SERVICE_RATE_CHANGE = '2025-09-22';

/** Statutory GST on salon services on a salon-local date (YYYY-MM-DD). Same as public.service_gst_rate(). */
export function serviceGstRate(onDate: string): number {
  return onDate >= SERVICE_RATE_CHANGE ? 5 : 18;
}

/** Composition salons pay this share of their turnover themselves (they can't collect it from clients). */
export const COMPOSITION_RATE = 6;
/** Below this yearly turnover a salon doesn't have to register (services). */
export const REGISTRATION_THRESHOLD = 2000000;
/** Composition scheme limit for service providers. */
export const COMPOSITION_LIMIT = 5000000;
/** A tax invoice to an unregistered client at or above this needs their name and address. */
export const B2C_ADDRESS_LIMIT = 50000;

export const SAC_CODES = [
  { code: '999721', label: 'Hair & barber', hint: 'Haircut, colour, styling, shave' },
  { code: '999722', label: 'Beauty, manicure, pedicure', hint: 'Facial, clean-up, nails, make-up' },
  { code: '999723', label: 'Spa & massage', hint: 'Body massage, spa therapies' },
  { code: '999729', label: 'Other beauty', hint: 'Waxing, threading, piercing, mehendi' },
] as const;
export type SacCode = (typeof SAC_CODES)[number]['code'];
export const SAC_LABEL: Record<string, string> = Object.fromEntries(SAC_CODES.map((s) => [s.code, s.label]));
export const isSacCode = (c: unknown): c is SacCode => SAC_CODES.some((s) => s.code === c);

/** What a retail product is, in the words a front desk uses, and the GST it carries. */
export const PRODUCT_TAX_TYPES = [
  { key: 'hair', rate: 5, label: '5% · Hair care & soaps', short: 'Hair care & soaps', hint: 'Hair oil, shampoo (HSN 3305), soap (3401), talc, combs' },
  { key: 'cosmetic', rate: 18, label: '18% · Cosmetics & skincare', short: 'Cosmetics & skincare', hint: 'Make-up, creams, serums, conditioner, perfume (3304, 3303)' },
  { key: 'zero', rate: 0, label: '0% · No GST', short: 'No GST', hint: 'Only items your CA says are exempt' },
] as const;
export type ProductTaxKey = (typeof PRODUCT_TAX_TYPES)[number]['key'];

/** HSN for goods: 4, 6 or 8 digits. SAC for services: 6 digits starting 99. */
export const HSN_RE = /^[0-9]{4}([0-9]{2}){0,2}$/;

/** A salon's own GSTIN (as the salons table checks it). */
export const GSTIN_RE = /^[0-9]{2}[A-Z0-9]{13}$/;
/** A registered business client's GSTIN: state, PAN, entity, Z, check character. Same as valid_business_gstin(). */
export const BUSINESS_GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const cleanGstin = (s: string | null | undefined) => (s ?? '').replace(/\s/g, '').toUpperCase();

export const billTypeFor = (mode: GstMode): BillType =>
  mode === 'regular' ? 'tax_invoice' : mode === 'composition' ? 'bill_of_supply' : 'bill';

export interface BillDocument {
  type: BillType;
  /** Heading printed on the bill. */
  title: string;
  /** Lower-case, for sentences: "your tax invoice GS-01043". */
  noun: string;
  /** Required wording printed on the bill, if any. */
  declaration: string | null;
  /** Tax lines, SAC/HSN and rate columns. */
  showTax: boolean;
  /** Print the salon's GSTIN. */
  showGstin: boolean;
}

export const COMPOSITION_DECLARATION = 'Composition taxable person, not eligible to collect tax on supplies';

/** How a bill of this type looks: title, declaration, and what it may show. */
export function billDocument(type: BillType | null | undefined): BillDocument {
  if (type === 'tax_invoice') return { type, title: 'Tax Invoice', noun: 'tax invoice', declaration: null, showTax: true, showGstin: true };
  if (type === 'bill_of_supply') return { type, title: 'Bill of Supply', noun: 'bill of supply', declaration: COMPOSITION_DECLARATION, showTax: false, showGstin: true };
  return { type: 'bill', title: 'Bill', noun: 'bill', declaration: null, showTax: false, showGstin: false };
}

export const GST_MODE_LABEL: Record<GstMode, string> = { unregistered: 'Not registered', composition: 'Composition', regular: 'Regular GST' };

// ---------------------------------------------------------------------------
// States and GST state codes (same list as public.gst_states())
// ---------------------------------------------------------------------------
export const INDIAN_STATES: { code: string; name: string }[] = [
  { code: '35', name: 'Andaman and Nicobar Islands' }, { code: '37', name: 'Andhra Pradesh' }, { code: '12', name: 'Arunachal Pradesh' },
  { code: '18', name: 'Assam' }, { code: '10', name: 'Bihar' }, { code: '04', name: 'Chandigarh' }, { code: '22', name: 'Chhattisgarh' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' }, { code: '07', name: 'Delhi' }, { code: '30', name: 'Goa' },
  { code: '24', name: 'Gujarat' }, { code: '06', name: 'Haryana' }, { code: '02', name: 'Himachal Pradesh' }, { code: '01', name: 'Jammu and Kashmir' },
  { code: '20', name: 'Jharkhand' }, { code: '29', name: 'Karnataka' }, { code: '32', name: 'Kerala' }, { code: '38', name: 'Ladakh' },
  { code: '31', name: 'Lakshadweep' }, { code: '23', name: 'Madhya Pradesh' }, { code: '27', name: 'Maharashtra' }, { code: '14', name: 'Manipur' },
  { code: '17', name: 'Meghalaya' }, { code: '15', name: 'Mizoram' }, { code: '13', name: 'Nagaland' }, { code: '21', name: 'Odisha' },
  { code: '34', name: 'Puducherry' }, { code: '03', name: 'Punjab' }, { code: '08', name: 'Rajasthan' }, { code: '11', name: 'Sikkim' },
  { code: '33', name: 'Tamil Nadu' }, { code: '36', name: 'Telangana' }, { code: '16', name: 'Tripura' }, { code: '09', name: 'Uttar Pradesh' },
  { code: '05', name: 'Uttarakhand' }, { code: '19', name: 'West Bengal' },
];
/** First market: Jaigaon, West Bengal. */
export const DEFAULT_STATE = 'West Bengal';

const norm = (s: string) => s.trim().toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ');
export function stateByName(name: string | null | undefined) {
  return name ? INDIAN_STATES.find((s) => norm(s.name) === norm(name)) ?? null : null;
}
export function stateByCode(code: string | null | undefined) {
  return code ? INDIAN_STATES.find((s) => s.code === code) ?? null : null;
}
/** "West Bengal (19)": the GSTIN's state wins, then the salon's state. Same as public.gst_place_of_supply(). */
export function placeOfSupply(state: string | null | undefined, gstin: string | null | undefined): string | null {
  const s = stateByCode(gstin?.slice(0, 2)) ?? stateByName(state);
  if (s) return `${s.name} (${s.code})`;
  return state?.trim() || null;
}

/** Indian financial year (1 April – 31 March) containing a YYYY-MM-DD date. */
export function financialYear(day: string): { from: string; to: string; label: string } {
  const y = Number(day.slice(0, 4));
  const start = Number(day.slice(5, 7)) >= 4 ? y : y - 1;
  return { from: `${start}-04-01`, to: `${start + 1}-03-31`, label: `${start}–${String(start + 1).slice(2)}` };
}
