'use client';
// Small pieces shared by the POS, bills list, bill detail and client profile.
import { Badge } from '@/components/ui/ui';
import type { IconName } from '@/components/ui/icons';
import type { InvoiceStatus, PayMethod } from '@/lib/types';
import { METHOD_LABEL } from '@/lib/types';

export const PAY_METHODS: PayMethod[] = ['cash', 'upi', 'card', 'wallet', 'other'];

export const METHOD_ICON: Record<PayMethod, IconName> = { cash: 'cash', upi: 'upi', card: 'card', wallet: 'wallet', other: 'more' };

export const REF_PLACEHOLDER: Record<PayMethod, string> = {
  cash: 'Note (optional)', upi: 'UPI ref no. (optional)', card: 'Last 4 digits (optional)', wallet: 'Wallet name (optional)', other: 'Details (optional)',
};

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = { paid: 'Paid', partial: 'Part paid', unpaid: 'Unpaid', void: 'Cancelled' };
const TONE = { paid: 'success', partial: 'marigold', unpaid: 'danger', void: 'outline' } as const;

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return <Badge tone={TONE[status]}>{INVOICE_STATUS_LABEL[status]}</Badge>;
}

/** "UPI", "Cash + UPI", or "—" when nothing has been paid. */
export function methodSummary(methods: PayMethod[]): string {
  const uniq = PAY_METHODS.filter((m) => methods.includes(m));
  return uniq.length ? uniq.map((m) => METHOD_LABEL[m]).join(' + ') : '—';
}

/** Parse a rupee amount typed by a person ("1,200", " 450.5 "). Bad input counts as 0. */
export function parseAmount(s: string | number): number {
  const v = typeof s === 'number' ? s : Number(String(s).replace(/[,\s₹]/g, ''));
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 0;
}
