// UPI pay-by-QR to the salon's own UPI ID. Styile only draws the QR: the client's app pays the salon directly and
// the front desk records the payment as usual (no money passes through Styile — RBI payment-aggregator rules).

/** A UPI ID (VPA): handle@bank, e.g. glowstudio@okicici, 9876543210@ybl. Same rule as public.valid_upi_vpa(). */
export const VPA_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,254}@[A-Za-z][A-Za-z0-9]{1,63}$/;
export const isValidVpa = (v: string | null | undefined): v is string => !!v && VPA_RE.test(v);

/** Cross-border UPI from Bhutanese bank apps (Phase II, Sep 2026). */
export const BHUTAN_UPI_LIMITS = { perPayment: 10000, perDay: 25000, perYear: 50000 } as const;

const enc = (s: string) => encodeURIComponent(s).replace(/%40/g, '@');

export interface UpiPayment {
  vpa: string;
  /** Shown to the payer in their app ("Glow Studio"). */
  name: string;
  /** Rupees; omitted (payer types it) when not positive. */
  amount?: number | null;
  /** Transaction note, e.g. the bill number. */
  note?: string | null;
}

/** upi://pay?pa=glowstudio@okicici&pn=Glow%20Studio&am=1049.00&cu=INR&tn=Bill%20DUS-01407 */
export function upiPayUrl({ vpa, name, amount, note }: UpiPayment): string {
  const parts = [`pa=${enc(vpa.trim())}`, `pn=${enc(name.trim().slice(0, 50))}`];
  if (amount != null && Number.isFinite(amount) && amount > 0) parts.push(`am=${(Math.round(amount * 100) / 100).toFixed(2)}`);
  parts.push('cu=INR');
  if (note && note.trim()) parts.push(`tn=${enc(note.trim().slice(0, 80))}`);
  return `upi://pay?${parts.join('&')}`;
}
