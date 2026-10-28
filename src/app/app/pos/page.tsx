import { redirect } from 'next/navigation';
import { PosScreen, type PosProps } from '@/components/app/pos';
import { requirePermission } from '@/lib/context';
import { getClientBenefits, getMenu, getTeam } from '@/lib/queries';
import { fmtTime, localDate } from '@/lib/time';
import { serviceGstRate } from '@/lib/gst';
import { isValidVpa } from '@/lib/upi';
import type { ClientLite } from '@/actions/appointments';

export const metadata = { title: 'New bill' };

const CLIENT_COLS = 'id, name, phone, visit_count, last_visit_at, coin_balance';

export default async function PosPage({ searchParams }: { searchParams: Promise<{ appointment?: string; customer?: string; event?: string }> }) {
  const ctx = await requirePermission('bill');
  const sp = await searchParams;
  const db = ctx.supabase;
  const [menu, staff] = await Promise.all([getMenu(db, ctx.salon.id), getTeam(db, ctx.salon.id)]);
  const today = localDate(new Date(), ctx.salon.timezone);

  let prefill: PosProps['prefill'] = null;
  if (sp.event) {
    // Checking out a bridal / group event: everyone's services, the travel charge, and the advances.
    const { data: ev } = await db.from('events')
      .select(`id, title, event_at, status, location, travel_charge, customer:customers(${CLIENT_COLS}), appts:appointments(id, staff_id, start_at, status, guest_name, services:appointment_services(service_id, name, price, sort))`)
      .eq('id', sp.event).eq('salon_id', ctx.salon.id).maybeSingle();
    if (ev) {
      const e = ev as unknown as {
        id: string; title: string; event_at: string; status: string; location: string; travel_charge: number; customer: ClientLite | null;
        appts: { id: string; staff_id: string | null; start_at: string; status: string; guest_name: string | null; services: { service_id: string | null; name: string; price: number; sort: number }[] }[];
      };
      if (e.status === 'done') {
        const { data: inv } = await db.from('invoices').select('id').eq('event_id', e.id).neq('status', 'void').maybeSingle();
        if (inv) redirect(`/app/invoices/${(inv as { id: string }).id}`);
      }
      const people = [...(e.appts ?? [])].filter((a) => !['cancelled', 'no_show'].includes(a.status)).sort((a, b) => a.start_at.localeCompare(b.start_at));
      prefill = {
        appointmentId: null, eventId: e.id, customer: e.customer,
        context: `Checkout · ${e.title} · ${people.length} ${people.length === 1 ? 'person' : 'people'}`,
        lines: [
          ...people.flatMap((a) => [...(a.services ?? [])].sort((x, y) => x.sort - y.sort).map((sv) => ({
            serviceId: sv.service_id, name: a.guest_name ? `${sv.name} · ${a.guest_name}` : sv.name, price: Number(sv.price), staffId: a.staff_id,
            gstRate: menu.services.find((m) => m.id === sv.service_id)?.gst_rate ?? null,
          }))),
          ...(e.location === 'home' && Number(e.travel_charge) > 0 ? [{ serviceId: null, name: 'Home visit travel', price: Number(e.travel_charge), staffId: null, gstRate: null }] : []),
        ],
      };
    }
  } else if (sp.appointment) {
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
  // The client's package sessions and member discount, ready on the first render.
  if (prefill?.customer) prefill.benefits = await getClientBenefits(db, ctx.salon.id, prefill.customer.id, today);

  return (
    <PosScreen
      salon={{
        gstMode: ctx.salon.gst_mode,
        pricesIncludeTax: ctx.salon.prices_include_tax,
        serviceRate: serviceGstRate(today),
        today,
        timezone: ctx.salon.timezone,
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
