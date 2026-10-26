import { notFound } from 'next/navigation';
import { InvoiceDetail } from '@/components/app/invoice-detail';
import { requirePermission } from '@/lib/context';
import { can } from '@/lib/permissions';
import type { Invoice, InvoiceItem, Payment } from '@/lib/types';

export const metadata = { title: 'Bill' };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission('bill');
  const { id } = await params;
  const db = ctx.supabase;

  const { data: inv } = await db.from('invoices').select('*').eq('id', id).eq('salon_id', ctx.salon.id).maybeSingle();
  if (!inv) notFound();
  const invoice = inv as Invoice;

  const [items, payments, customer, staff] = await Promise.all([
    db.from('invoice_items').select('*').eq('invoice_id', invoice.id).order('sort'),
    db.from('payments').select('*').eq('invoice_id', invoice.id).order('created_at'),
    invoice.customer_id
      ? db.from('customers').select('id, name, phone, email').eq('id', invoice.customer_id).eq('salon_id', ctx.salon.id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('staff').select('id, name').eq('salon_id', ctx.salon.id),
  ]);

  const staffNames: Record<string, string> = {};
  for (const s of (staff.data ?? []) as { id: string; name: string }[]) staffNames[s.id] = s.name;
  const s = ctx.salon;

  return (
    <InvoiceDetail
      invoice={invoice}
      items={(items.data ?? []) as InvoiceItem[]}
      payments={(payments.data ?? []) as Payment[]}
      customer={(customer.data ?? null) as { id: string; name: string; phone: string; email: string | null } | null}
      salon={{
        name: s.name, legal_name: s.legal_name, gstin: s.gstin, phone: s.phone, email: s.email,
        address: s.address, city: s.city, state: s.state, pincode: s.pincode, waConnected: !!s.wa_phone_number_id,
      }}
      staffNames={staffNames}
      tz={s.timezone}
      canVoid={can(ctx.role, 'voidBill')}
    />
  );
}
