import { TodayView } from '@/components/app/today';
import { getSalonContext } from '@/lib/context';
import { can } from '@/lib/permissions';
import { getDayAppointments, getMenu, getTeam } from '@/lib/queries';
import { addDays, localDate, zonedToUtc } from '@/lib/time';

export const metadata = { title: 'Today' };

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ welcome?: string; denied?: string }> }) {
  const ctx = await getSalonContext();
  const sp = await searchParams;
  const tz = ctx.salon.timezone;
  const now = new Date();
  const today = localDate(now, tz);
  const dayStart = zonedToUtc(today, '00:00', tz).toISOString();
  const dayEnd = zonedToUtc(addDays(today, 1), '00:00', tz).toISOString();
  const billing = can(ctx.role, 'bill');

  const [appointments, menu, staff, invoices, inbox, setup] = await Promise.all([
    getDayAppointments(ctx.supabase, ctx.salon.id, today, tz),
    getMenu(ctx.supabase, ctx.salon.id),
    getTeam(ctx.supabase, ctx.salon.id),
    billing
      ? ctx.supabase.from('invoices').select('total').eq('salon_id', ctx.salon.id).neq('status', 'void').gte('created_at', dayStart).lt('created_at', dayEnd)
      : Promise.resolve({ data: null }),
    can(ctx.role, 'inbox')
      ? ctx.supabase.from('wa_conversations').select('id', { count: 'exact', head: true }).eq('salon_id', ctx.salon.id).eq('needs_attention', true)
      : Promise.resolve({ count: 0 }),
    ctx.supabase.from('staff').select('id', { count: 'exact', head: true }).eq('salon_id', ctx.salon.id),
  ]);

  return (
    <TodayView
      salon={{ id: ctx.salon.id, name: ctx.salon.name, slug: ctx.salon.slug, waConnected: !!ctx.salon.wa_phone_number_id, gstin: ctx.salon.gstin }}
      userName={ctx.user.name.split(' ')[0]}
      today={today}
      nowIso={now.toISOString()}
      appointments={ctx.role === 'stylist' && ctx.staffId ? appointments.filter((a) => a.staff_id === ctx.staffId || a.status === 'waiting') : appointments}
      revenueToday={invoices.data ? invoices.data.reduce((s: number, i: { total: number }) => s + Number(i.total), 0) : null}
      needsAttention={inbox.count ?? 0}
      teamSize={setup.count ?? 0}
      menu={{ ...menu, staff, tz, intervalMin: ctx.salon.slot_interval_min }}
      canBill={billing}
      isOwner={ctx.role === 'owner'}
      welcome={sp.welcome === '1'}
      denied={sp.denied === '1'}
    />
  );
}
