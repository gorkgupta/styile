'use client';
// Small pieces shared by the POS, bills list, bill detail and client profile.
import { Badge } from '@/components/ui/ui';
import type { IconName } from '@/components/ui/icons';
import type { InvoiceStatus, PayMethod } from '@/lib/types';
import { ALL_PAY_METHODS, DEFAULT_PAY_METHODS, METHOD_LABEL } from '@/lib/types';

export const PAY_METHODS: PayMethod[] = ALL_PAY_METHODS;

export const METHOD_ICON: Record<PayMethod, IconName> = {
  cash: 'cash', upi: 'upi', card: 'card', wallet: 'coins', other: 'more', cash_nu: 'cash', upi_bhutan: 'upi', package: 'box', advance: 'heart',
};

export const REF_PLACEHOLDER: Record<PayMethod, string> = {
  cash: 'Note (optional)', upi: 'UPI ref no. (optional)', card: 'Last 4 digits (optional)', wallet: 'Note (optional)', other: 'Details (optional)',
  cash_nu: 'Note (optional)', upi_bhutan: 'Bank app ref no. (optional)', package: 'Added from the package', advance: 'Advance receipt no. (optional)',
};

/** UPI-type payments that can be collected with the salon's QR (Bhutanese apps scan the same Indian QR). */
export const isUpiMethod = (m: PayMethod) => m === 'upi' || m === 'upi_bhutan';

/**
 * Payment types to offer at the desk: the salon's choice (Settings), in the usual order. Coins are always offered
 * when the client has some, even if the salon has hidden them, so a balance can never get stuck.
 */
export function deskMethods(enabled: PayMethod[] | null | undefined, opts: { clientHasCoins?: boolean; keep?: PayMethod[] } = {}): PayMethod[] {
  const on = new Set<PayMethod>(enabled?.length ? enabled : DEFAULT_PAY_METHODS);
  if (opts.clientHasCoins) on.add('wallet');
  for (const m of opts.keep ?? []) on.add(m);
  return PAY_METHODS.filter((m) => on.has(m));
}

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = { paid: 'Paid', partial: 'Part paid', unpaid: 'Unpaid', void: 'Cancelled' };
const TONE = { paid: 'success', partial: 'marigold', unpaid: 'danger', void: 'outline' } as const;

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return <Badge tone={TONE[status]}>{INVOICE_STATUS_LABEL[status]}</Badge>;
}

/** "UPI", "Cash + UPI", "Package", or "—" when nothing has been paid. */
export function methodSummary(methods: PayMethod[]): string {
  const uniq = [...PAY_METHODS, 'package' as const, 'advance' as const].filter((m) => methods.includes(m));
  return uniq.length ? uniq.map((m) => METHOD_LABEL[m]).join(' + ') : '—';
}

/** Parse a rupee amount typed by a person ("1,200", " 450.5 "). Bad input counts as 0. */
export function parseAmount(s: string | number): number {
  const v = typeof s === 'number' ? s : Number(String(s).replace(/[,\s₹]/g, ''));
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 0;
}
