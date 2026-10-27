import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizePhone } from '@/lib/phone';
import { BillView, type CustomerBill } from '@/components/portal/bill-view';
import { findSiteSalon } from '@/lib/salon-site';
import { salonSiteBase } from '@/lib/site';
import type { InvoiceStatus, PayMethod } from '@/lib/types';

export const metadata: Metadata = { title: 'Your bill' };
export const dynamic = 'force-dynamic';

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const site = await findSiteSalon(slug);
  if (!site) notFound();
  const base = await salonSiteBase(slug);
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect(`${base}/me/login?next=${encodeURIComponent(`${base}/me/bills/${id}`)}`);
  if (!ID_RE.test(id)) notFound();

  // The bill link arrives on WhatsApp; link this number's client records first so a first-time visitor can see it.
  if (auth.user.phone) await supabase.rpc('claim_customer_profiles');

  // RLS: a client can read their own invoices, their lines, and the salon. Anything else returns nothing -> 404.
  const { data: inv } = await supabase.from('invoices')
    .select('id, salon_id, invoice_no, created_at, status, prices_include_tax, subtotal, discount_total, taxable_total, cgst, sgst, igst, round_off, total, paid_total, customer:customers(name, phone), salon:salons(name, legal_name, gstin, address, city, state, pincode, phone, slug, timezone)')
    .eq('id', id).eq('salon_id', site.id).maybeSingle();
  if (!inv) notFound();
  const row = inv as unknown as {
    id: string; salon_id: string; invoice_no: string; created_at: string; status: InvoiceStatus; prices_include_tax: boolean;
    subtotal: number; discount_total: number; taxable_total: number; cgst: number; sgst: number; igst: number; round_off: number; total: number; paid_total: number;
    customer: { name: string; phone: string } | null;
    salon: { name: string; legal_name: string | null; gstin: string | null; address: string | null; city: string | null; state: string | null; pincode: string | null; phone: string | null; slug: string; timezone: string } | null;
  };
  if (!row.salon) notFound();

  const [{ data: items }, { data: pays }] = await Promise.all([
    supabase.from('invoice_items').select('id, name, qty, unit_price, discount, gst_rate, line_total, staff_id').eq('invoice_id', id).order('sort'),
    // Clients have no RLS access to payments; the invoice read above already proved this bill is theirs.
    createAdminClient().from('payments').select('method, amount').eq('invoice_id', id).order('created_at'),
  ]);
  // Nor to staff rows: stylist names for this bill's lines come from the service role, limited to the bill's salon.
  type ItemRow = { id: string; name: string; qty: number; unit_price: number; discount: number; gst_rate: number; line_total: number; staff_id: string | null };
  const itemRows = (items ?? []) as ItemRow[];
  const staffIds = [...new Set(itemRows.map((i) => i.staff_id).filter((x): x is string => !!x))];
  const stylists = new Map<string, string>();
  if (staffIds.length) {
    const { data: staffRows } = await createAdminClient().from('staff').select('id, name').in('id', staffIds).eq('salon_id', row.salon_id);
    for (const s of (staffRows ?? []) as { id: string; name: string }[]) stylists.set(s.id, s.name);
  }

  const bill: CustomerBill = {
    salon: {
      name: row.salon.name, legalName: row.salon.legal_name, gstin: row.salon.gstin, address: row.salon.address, city: row.salon.city,
      state: row.salon.state, pincode: row.salon.pincode, phone: row.salon.phone, slug: row.salon.slug, timezone: row.salon.timezone,
    },
    invoice: {
      invoice_no: row.invoice_no, created_at: row.created_at, status: row.status, prices_include_tax: row.prices_include_tax,
      subtotal: Number(row.subtotal), discount_total: Number(row.discount_total), taxable_total: Number(row.taxable_total), cgst: Number(row.cgst),
      sgst: Number(row.sgst), igst: Number(row.igst), round_off: Number(row.round_off), total: Number(row.total), paid_total: Number(row.paid_total),
    },
    customer: row.customer,
    items: itemRows
      .map((i) => ({ id: i.id, name: i.name, qty: Number(i.qty), unit_price: Number(i.unit_price), discount: Number(i.discount), gst_rate: Number(i.gst_rate), line_total: Number(i.line_total), stylist: (i.staff_id && stylists.get(i.staff_id)) || null })),
    payments: ((pays ?? []) as { method: PayMethod; amount: number }[]).map((p) => ({ method: p.method, amount: Number(p.amount) })),
  };
  const phone = auth.user.phone ? normalizePhone(auth.user.phone) ?? undefined : undefined;
  return <BillView bill={bill} phone={phone} base={base} />;
}
