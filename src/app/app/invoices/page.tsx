import { InvoicesScreen, type InvoiceListRow } from '@/components/app/invoices';
import { requirePermission } from '@/lib/context';
import { resolveRange } from '@/lib/periods';
import { addDays, localDate, zonedToUtc } from '@/lib/time';
import type { InvoiceStatus, PayMethod } from '@/lib/types';

export const metadata = { title: 'Bills' };

const LIMIT = 500;

export default async function InvoicesPage({ searchParams }: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; status?: string; q?: string }>;
}) {
  const ctx = await requirePermission('bill');
  const sp = await searchParams;
  const tz = ctx.salon.timezone;
  const today = localDate(new Date(), tz);
  const range = resolveRange(sp.range, today, sp.from, sp.to);

  const { data, error } = await ctx.supabase.from('invoices')
    .select('id, invoice_no, created_at, total, paid_total, cgst, sgst, igst, composition_tax, status, customer:customers(id, name, phone), payments(method)')
    .eq('salon_id', ctx.salon.id)
    .gte('created_at', zonedToUtc(range.from, '00:00', tz).toISOString())
    .lt('created_at', zonedToUtc(addDays(range.to, 1), '00:00', tz).toISOString())
    .order('created_at', { ascending: false })
    .limit(LIMIT);
  if (error) throw error;

  type Raw = {
    id: string; invoice_no: string; created_at: string; total: number; paid_total: number; cgst: number; sgst: number; igst: number; composition_tax: number;
    status: InvoiceStatus; customer: { id: string; name: string; phone: string } | null; payments: { method: PayMethod }[] | null;
  };
  const rows: InvoiceListRow[] = ((data ?? []) as unknown as Raw[]).map((r) => ({
    id: r.id, invoice_no: r.invoice_no, created_at: r.created_at, status: r.status, customer: r.customer,
    total: Number(r.total), paid_total: Number(r.paid_total),
    tax: Number(r.cgst) + Number(r.sgst) + Number(r.igst), composition_tax: Number(r.composition_tax ?? 0),
    methods: (r.payments ?? []).map((p) => p.method),
  }));

  return (
    <InvoicesScreen rows={rows} range={range} today={today} tz={tz} truncated={rows.length >= LIMIT}
      initialStatus={sp.status} initialQuery={sp.q} gstMode={ctx.salon.gst_mode} />
  );
}
