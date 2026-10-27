import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { loadCatalog } from '@/lib/booking';
import { localDate } from '@/lib/time';
import { normalizePhone } from '@/lib/phone';
import { BookingFlow } from '@/components/public/booking-flow';
import { salonSiteBase } from '@/lib/site';
import { isReservedSlug } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/;

/** The salon behind a booking link, or null when the link is wrong or the salon isn't taking online bookings. */
const findSalon = cache(async (slug: string) => {
  if (!SLUG_RE.test(slug) || isReservedSlug(slug)) return null;
  const { data } = await createAdminClient().from('salons')
    .select('id, name, city').eq('slug', slug).eq('booking_enabled', true)
    .not('plan_status', 'in', '(suspended,cancelled)').maybeSingle();
  return (data as { id: string; name: string; city: string | null } | null) ?? null;
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const salon = await findSalon((await params).slug);
  if (!salon) return { title: 'Booking page not found' };
  return {
    title: { absolute: `Book at ${salon.name}` },
    description: `Book an appointment at ${salon.name}${salon.city ? `, ${salon.city}` : ''}. Pick a service, stylist and time.`,
  };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const found = await findSalon(slug);
  if (!found) notFound();

  const db = createAdminClient();
  const [catalog, { data: categories }] = await Promise.all([
    loadCatalog(db, found.id),
    db.from('service_categories').select('id, name').eq('salon_id', found.id).order('sort').order('name'),
  ]);
  const { salon, branch } = catalog;

  // Already signed in with a verified phone (a returning client)? Then the OTP step is skipped.
  let me: { phone: string; name: string } | null = null;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const phone = auth.user?.phone && auth.user.phone_confirmed_at ? normalizePhone(auth.user.phone) : null;
  if (auth.user && phone) {
    const { data: existing } = await db.from('customers').select('name').eq('salon_id', salon.id).eq('phone', phone).maybeSingle();
    const meta = (auth.user.user_metadata ?? {}) as { full_name?: string };
    me = { phone, name: (existing?.name && existing.name !== phone ? existing.name : meta.full_name) ?? '' };
  }

  const services = catalog.services.filter((s) => s.online_bookable);
  const staff = catalog.staff.filter((s) => s.bookable);
  const skills: Record<string, string[]> = {};
  for (const [id, set] of catalog.skills) skills[id] = [...set];

  return (
    <BookingFlow
      salon={{
        name: salon.name, slug: salon.slug, address: branch.address ?? salon.address, city: salon.city, phone: branch.phone ?? salon.phone,
        timezone: salon.timezone, brandColor: salon.brand_color || '#0F5257', bookingWindowDays: salon.booking_window_days,
      }}
      hours={branch.business_hours}
      categories={(categories ?? []) as { id: string; name: string }[]}
      services={services.map((s) => ({ id: s.id, category_id: s.category_id, name: s.name, description: s.description, duration_min: s.duration_min, price: Number(s.price), gender: s.gender }))}
      staff={staff.map((s) => ({ id: s.id, name: s.name, title: s.title, color: s.color }))}
      skills={skills}
      today={localDate(new Date(), salon.timezone)}
      me={me}
      base={await salonSiteBase(slug)}
    />
  );
}
