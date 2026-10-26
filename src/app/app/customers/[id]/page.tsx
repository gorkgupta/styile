import { notFound } from 'next/navigation';
import { CustomerProfile, type ProfileAppointment, type ProfileInvoice } from '@/components/app/customer-profile';
import { requirePermission } from '@/lib/context';
import { can } from '@/lib/permissions';
import { getTeam } from '@/lib/queries';
import { localDate } from '@/lib/time';
import type { Customer } from '@/lib/types';

export const metadata = { title: 'Client' };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission('viewClients');
  const { id } = await params;
  const db = ctx.supabase;
  const canBill = can(ctx.role, 'bill');

  const { data: customer } = await db.from('customers').select('*').eq('id', id).eq('salon_id', ctx.salon.id).maybeSingle();
  if (!customer) notFound();

  const [appts, bills, staff] = await Promise.all([
    db.from('appointments')
      .select('id, start_at, status, source, staff_id, invoice_id, services:appointment_services(name, price, sort)')
      .eq('salon_id', ctx.salon.id).eq('customer_id', id)
      .order('start_at', { ascending: false }).limit(100),
    canBill
      ? db.from('invoices').select('id, invoice_no, created_at, total, paid_total, status')
        .eq('salon_id', ctx.salon.id).eq('customer_id', id).order('created_at', { ascending: false }).limit(100)
      : Promise.resolve({ data: null }),
    getTeam(db, ctx.salon.id, true),
  ]);

  type RawAppt = Omit<ProfileAppointment, 'services'> & { services: { name: string; price: number; sort: number }[] | null };
  const appointments: ProfileAppointment[] = ((appts.data ?? []) as unknown as RawAppt[]).map((a) => ({
    ...a, services: [...(a.services ?? [])].sort((x, y) => x.sort - y.sort).map((s) => ({ name: s.name, price: Number(s.price) })),
  }));
  const invoices: ProfileInvoice[] | null = bills.data
    ? (bills.data as ProfileInvoice[]).map((b) => ({ ...b, total: Number(b.total), paid_total: Number(b.paid_total) }))
    : null;
  const c = customer as Customer;

  return (
    <CustomerProfile
      customer={{ ...c, tags: c.tags ?? [], total_spent: Number(c.total_spent) }}
      appointments={appointments}
      invoices={invoices}
      staff={staff.map((s) => ({ id: s.id, name: s.name, color: s.color }))}
      today={localDate(new Date(), ctx.salon.timezone)}
      nowIso={new Date().toISOString()}
      tz={ctx.salon.timezone}
      canDelete={can(ctx.role, 'deleteClients')}
      canBill={canBill}
    />
  );
}
