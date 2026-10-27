import { ServicesScreen } from '@/components/app/services';
import { requirePermission } from '@/lib/context';
import type { Service, ServiceCategory } from '@/lib/types';

export const metadata = { title: 'Services' };

export default async function ServicesPage() {
  const ctx = await requirePermission('manageMenu');
  const [services, categories] = await Promise.all([
    ctx.supabase.from('services').select('*').eq('salon_id', ctx.salon.id).order('sort').order('name'),
    ctx.supabase.from('service_categories').select('*').eq('salon_id', ctx.salon.id).order('sort').order('name'),
  ]);
  return (
    <ServicesScreen
      services={(services.data ?? []) as Service[]}
      categories={(categories.data ?? []) as ServiceCategory[]}
      defaultGstRate={Number(ctx.salon.default_gst_rate)}
      pricesIncludeTax={ctx.salon.prices_include_tax}
    />
  );
}
