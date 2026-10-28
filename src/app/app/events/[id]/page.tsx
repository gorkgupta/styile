import { notFound } from 'next/navigation';
import { EventDetail, type EventPerson } from '@/components/app/events';
import { requirePermission } from '@/lib/context';
import { can } from '@/lib/permissions';
import { normalizeAdvance, normalizeEvent } from '@/lib/events';
import { localDate } from '@/lib/time';
import type { ApptStatus } from '@/lib/types';

export const metadata = { title: 'Event' };

type RawAppt = { id: string; guest_name: string | null; start_at: string; end_at: string; status: ApptStatus; staff: { name: string; color: string } | null; services: { name: string; price: number; sort: number }[] };
const person = (a: RawAppt): EventPerson => ({
  id: a.id, name: a.guest_name, start_at: a.start_at, end_at: a.end_at, status: a.status, staff: a.staff,
  services: [...(a.services ?? [])].sort((x, y) => x.sort - y.sort).map((s) => ({ name: s.name, price: Number(s.price) })),
});
const APPT = 'id, guest_name, start_at, end_at, status, staff:staff_id(name, color), services:appointment_services(name, price, sort)';

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission('events');
  const { id } = await params;
  const db = ctx.supabase;
  const { data: ev } = await db.from('events').select('*, customer:customers(id, name, phone)').eq('id', id).eq('salon_id', ctx.salon.id).maybeSingle();
  if (!ev) notFound();
  const e = normalizeEvent(ev);
  const [people, trial, advances, bill] = await Promise.all([
    db.from('appointments').select(APPT).eq('event_id', e.id).eq('salon_id', ctx.salon.id).order('start_at'),
    e.trial_appointment_id ? db.from('appointments').select(APPT).eq('id', e.trial_appointment_id).eq('salon_id', ctx.salon.id).maybeSingle() : Promise.resolve({ data: null }),
    db.from('advance_payments').select('*').eq('event_id', e.id).eq('salon_id', ctx.salon.id).order('received_at'),
    db.from('invoices').select('id, invoice_no, total, paid_total, status').eq('event_id', e.id).eq('salon_id', ctx.salon.id).neq('status', 'void').maybeSingle(),
  ]);
  const s = ctx.salon;
  const b = bill.data as { id: string; invoice_no: string; total: number; paid_total: number; status: string } | null;
  return (
    <EventDetail
      event={e}
      customer={(ev as unknown as { customer: { id: string; name: string; phone: string } }).customer}
      people={((people.data ?? []) as unknown as RawAppt[]).map(person)}
      trial={trial.data ? person(trial.data as unknown as RawAppt) : null}
      advances={(advances.data ?? []).map(normalizeAdvance)}
      bill={b ? { ...b, total: Number(b.total), paid_total: Number(b.paid_total) } : null}
      salon={{ name: s.name, gstMode: s.gst_mode, gstin: s.gstin, address: [s.address, s.city].filter(Boolean).join(', ') || null, phone: s.phone,
        policy: s.advance_policy ?? null, methods: s.payment_methods, waConnected: !!s.wa_phone_number_id }}
      today={localDate(new Date(), s.timezone)}
      tz={s.timezone}
      canEdit={can(ctx.role, 'events')}
      canRefund={can(ctx.role, 'refundAdvances')}
      canBill={can(ctx.role, 'bill')}
    />
  );
}
