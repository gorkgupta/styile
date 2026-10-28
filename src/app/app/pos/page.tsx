import { redirect } from 'next/navigation';
import { PosScreen, type PosProps } from '@/components/app/pos';
import { requirePermission } from '@/lib/context';
import { getMenu, getTeam } from '@/lib/queries';
import { fmtTime, localDate } from '@/lib/time';
import { serviceGstRate } from '@/lib/gst';
import { isValidVpa } from '@/lib/upi';
import type { ClientLite } from '@/actions/appointments';

export const metadata = { title: 'New bill' };

const CLIENT_COLS = 'id, name, phone, visit_count, last_visit_at, coin_balance';

export default async function PosPage({ searchParams }: { searchParams: Promise<{ appointment?: string; customer?: string }> }) {
  const ctx = await requirePermission('bill');
  const sp = await searchParams;
  const db = ctx.supabase;
  const [menu, staff] = await Promise.all([getMenu(db, ctx.salon.id), getTeam(db, ctx.salon.id)]);

  let prefill: PosProps['prefill'] = null;
  if (sp.appointment) {
    const { data: appt } = await db.from('appointments')
      .select(`id, staff_id, start_at, status, invoice_id, customer:customers(${CLIENT_COLS}), services:appointment_services(service_id, name, price, sort)`)
      .eq('id', sp.appointment).eq('salon_id', ctx.salon.id).maybeSingle();
    if (appt) {
      const a = appt as unknown as {
        id: string; staff_id: string | null; start_at: string; status: string; invoice_id: string | null;
        customer: ClientLite | null; services: { service_id: string | null; name: string; price: number; sort: number }[];
      };
      // Already checked out: show that bill instead of billing twice.
      if (a.invoice_id) redirect(`/app/invoices/${a.invoice_id}`);
      const stylist = staff.find((s) => s.id === a.staff_id);
      prefill = {
        appointmentId: a.id,
        customer: a.customer,
        context: `Checkout · ${a.customer?.name ?? 'Client'} · ${fmtTime(a.start_at, ctx.salon.timezone)}${stylist ? ` with ${stylist.name}` : ''}`,
        lines: [...(a.services ?? [])].sort((x, y) => x.sort - y.sort).map((s) => ({
          serviceId: s.service_id, name: s.name, price: Number(s.price), staffId: a.staff_id,
          gstRate: menu.services.find((m) => m.id === s.service_id)?.gst_rate ?? null,
        })),
      };
    }
  } else if (sp.customer) {
    const { data: c } = await db.from('customers').select(CLIENT_COLS).eq('id', sp.customer).eq('salon_id', ctx.salon.id).maybeSingle();
    if (c) prefill = { appointmentId: null, customer: c as ClientLite, lines: [] };
  }

  return (
    <PosScreen
      salon={{
        gstMode: ctx.salon.gst_mode,
        pricesIncludeTax: ctx.salon.prices_include_tax,
        serviceRate: serviceGstRate(localDate(new Date(), ctx.salon.timezone)),
        payMethods: ctx.salon.payment_methods,
        upi: isValidVpa(ctx.salon.upi_vpa) ? { vpa: ctx.salon.upi_vpa, name: ctx.salon.upi_payee_name || ctx.salon.name } : null,
        receiptSize: ctx.salon.receipt_size ?? '80',
        waConnected: !!ctx.salon.wa_phone_number_id,
        nextInvoiceNo: `${ctx.salon.invoice_prefix}-${String(ctx.salon.next_invoice_no).padStart(5, '0')}`,
      }}
      services={menu.services}
      categories={menu.categories}
      staff={staff}
      prefill={prefill}
    />
  );
}
