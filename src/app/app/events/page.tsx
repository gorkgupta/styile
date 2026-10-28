import { EventsScreen, type EventListRow } from '@/components/app/events';
import { requirePermission } from '@/lib/context';
import { can } from '@/lib/permissions';
import { getMenu, getTeam } from '@/lib/queries';
import { normalizeAdvance, normalizeEvent } from '@/lib/events';
import { localDate } from '@/lib/time';

export const metadata = { title: 'Bridal & events' };

export default async function EventsPage() {
  const ctx = await requirePermission('events');
  const db = ctx.supabase;
  const today = localDate(new Date(), ctx.salon.timezone);
  const since = new Date(Date.now() - 120 * 86400000).toISOString();
  const [evs, menu, staff] = await Promise.all([
    db.from('events').select('*, customer:customers(id, name, phone), advances:advance_payments(amount, applied_amount, refund_amount), bills:invoices(id, invoice_no, total, paid_total, status)')
      .eq('salon_id', ctx.salon.id).gte('event_at', since).order('event_at').limit(300),
    getMenu(db, ctx.salon.id),
    getTeam(db, ctx.salon.id),
  ]);
  type Raw = EventListRow & { bills: { id: string; invoice_no: string; total: number; paid_total: number; status: string }[] | null };
  const events: EventListRow[] = ((evs.data ?? []) as unknown as Raw[]).map(({ bills, ...e }) => {
    const bill = (bills ?? []).find((b) => b.status !== 'void');
    return {
      ...normalizeEvent(e), customer: e.customer, advances: (e.advances ?? []).map(normalizeAdvance),
      bill: bill ? { id: bill.id, invoice_no: bill.invoice_no, total: Number(bill.total), paid_total: Number(bill.paid_total) } : null,
    };
  });
  return (
    <EventsScreen events={events} today={today} tz={ctx.salon.timezone} canCreate={can(ctx.role, 'events')}
      newEvent={{ menu: { ...menu, staff, tz: ctx.salon.timezone, intervalMin: ctx.salon.slot_interval_min }, today, methods: ctx.salon.payment_methods, waConnected: !!ctx.salon.wa_phone_number_id }} />
  );
}
