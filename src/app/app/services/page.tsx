import { ServicesScreen } from '@/components/app/services';
import { requirePermission } from '@/lib/context';
import { serviceGstRate } from '@/lib/gst';
import { localDate } from '@/lib/time';
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
      serviceRate={serviceGstRate(localDate(new Date(), ctx.salon.timezone))}
      pricesIncludeTax={ctx.salon.prices_include_tax}
      gstMode={ctx.salon.gst_mode}
    />
  );
}
