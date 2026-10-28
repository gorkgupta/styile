import { PackagesScreen } from '@/components/app/packages';
import { requirePermission } from '@/lib/context';
import { localDate } from '@/lib/time';
import type { MembershipPlan, Service, ServiceCategory, ServicePackage } from '@/lib/types';

export const metadata = { title: 'Packages & memberships' };

export default async function PackagesPage() {
  const ctx = await requirePermission('manageMenu');
  const db = ctx.supabase;
  const today = localDate(new Date(), ctx.salon.timezone);
  const [pkgs, plans, services, categories, held, cards] = await Promise.all([
    db.from('service_packages').select('*, items:service_package_items(service_id, sessions, sort)').eq('salon_id', ctx.salon.id).order('active', { ascending: false }).order('sort'),
    db.from('membership_plans').select('*').eq('salon_id', ctx.salon.id).order('active', { ascending: false }).order('sort').order('fee'),
    db.from('services').select('*').eq('salon_id', ctx.salon.id).order('sort').order('name'),
    db.from('service_categories').select('*').eq('salon_id', ctx.salon.id).order('sort').order('name'),
    // Who still has sessions to use, by package; who is a member today, by card.
    db.from('client_packages').select('package_id').eq('salon_id', ctx.salon.id).eq('status', 'active').gte('expires_on', today),
    db.from('client_memberships').select('plan_id').eq('salon_id', ctx.salon.id).eq('status', 'active').lte('starts_on', today).gte('ends_on', today),
  ]);
  const count = (rows: Record<string, string | null>[] | null, key: string) => {
    const out: Record<string, number> = {};
    for (const r of rows ?? []) if (r[key]) out[r[key]!] = (out[r[key]!] ?? 0) + 1;
    return out;
  };
  type RawPkg = Omit<ServicePackage, 'items'> & { items: { service_id: string; sessions: number; sort: number }[] };
  return (
    <PackagesScreen
      packages={((pkgs.data ?? []) as RawPkg[]).map((p) => ({ ...p, price: Number(p.price), items: [...p.items].sort((a, b) => a.sort - b.sort).map(({ service_id, sessions }) => ({ service_id, sessions })) }))}
      plans={((plans.data ?? []) as MembershipPlan[]).map((x) => ({ ...x, fee: Number(x.fee), service_discount_pct: Number(x.service_discount_pct), product_discount_pct: Number(x.product_discount_pct) }))}
      services={(services.data ?? []) as Service[]}
      categories={(categories.data ?? []) as ServiceCategory[]}
      holders={count(held.data as Record<string, string | null>[] | null, 'package_id')}
      members={count(cards.data as Record<string, string | null>[] | null, 'plan_id')}
      gstMode={ctx.salon.gst_mode}
    />
  );
}
