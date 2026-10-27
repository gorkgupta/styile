import { CustomersScreen, type ClientRow } from '@/components/app/customers';
import { requirePermission } from '@/lib/context';
import { localDate } from '@/lib/time';

export const metadata = { title: 'Clients' };

const LIMIT = 2000;
const COLS = 'id, name, phone, email, gender, birthday, tags, visit_count, total_spent, last_visit_at, created_at, coin_balance';

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requirePermission('viewClients');
  const { q } = await searchParams;
  let req = ctx.supabase.from('customers').select(COLS).eq('salon_id', ctx.salon.id);
  // Most salons fit in one load and filter instantly in the browser; very large lists search here.
  const query = q?.trim().replace(/[%_,()]/g, '') ?? '';
  if (query) {
    const digits = query.replace(/\D/g, '');
    req = digits.length >= 3 ? req.like('phone', `%${digits}%`) : req.ilike('name', `%${query}%`);
  }
  const { data, error } = await req.order('last_visit_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(LIMIT);
  if (error) throw error;
  const clients = ((data ?? []) as ClientRow[]).map((c) => ({ ...c, tags: c.tags ?? [], total_spent: Number(c.total_spent), coin_balance: Number(c.coin_balance ?? 0) }));
  return (
    <CustomersScreen clients={clients} today={localDate(new Date(), ctx.salon.timezone)} tz={ctx.salon.timezone}
      truncated={clients.length >= LIMIT || !!query} initialQuery={query} />
  );
}
