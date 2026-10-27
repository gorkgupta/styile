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
import { parseBookingLink, shownOnline, toPublicStylist } from '@/lib/stylists';

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

export default async function Page({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  /** ?stylist=<staff id>&services=<id,id> pre-selects a stylist and services ("Book again with Priya"). */
  searchParams: Promise<{ stylist?: string | string[]; services?: string | string[] }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
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
  let customerId: string | null = null;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const phone = auth.user?.phone && auth.user.phone_confirmed_at ? normalizePhone(auth.user.phone) : null;
  if (auth.user && phone) {
    const { data: existing } = await db.from('customers').select('id, name').eq('salon_id', salon.id).eq('phone', phone).maybeSingle();
    const meta = (auth.user.user_metadata ?? {}) as { full_name?: string };
    me = { phone, name: (existing?.name && existing.name !== phone ? existing.name : meta.full_name) ?? '' };
    customerId = (existing?.id as string | undefined) ?? null;
  }

  const services = catalog.services.filter((s) => s.online_bookable);
  // Stylists clients can choose; hidden ones stay bookable by the front desk. Only public profile fields leave the server.
  const staff = catalog.staff.filter(shownOnline);
  const skills: Record<string, string[]> = {};
  for (const [id, set] of catalog.skills) if (staff.some((s) => s.id === id)) skills[id] = [...set];

  // Returning client: their usual stylist (most visits in the last year) is offered first and pre-selected.
  let usualStylistId: string | null = null;
  if (customerId) {
    const { data: usual } = await db.rpc('usual_stylist', { p_salon: salon.id, p_customer: customerId });
    usualStylistId = typeof usual === 'string' && staff.some((s) => s.id === usual) ? usual : null;
  }
  const link = parseBookingLink(query, { serviceIds: services.map((s) => s.id), staffIds: staff.map((s) => s.id), skills });

  return (
    <BookingFlow
      salon={{
        name: salon.name, slug: salon.slug, address: branch.address ?? salon.address, city: salon.city, phone: branch.phone ?? salon.phone,
        timezone: salon.timezone, brandColor: salon.brand_color || '#0F5257', bookingWindowDays: salon.booking_window_days,
      }}
      hours={branch.business_hours}
      categories={(categories ?? []) as { id: string; name: string }[]}
      services={services.map((s) => ({ id: s.id, category_id: s.category_id, name: s.name, description: s.description, duration_min: s.duration_min, price: Number(s.price), gender: s.gender }))}
      staff={staff.map(toPublicStylist)}
      skills={skills}
      usualStylistId={usualStylistId}
      initial={link.serviceIds.length || link.staffId
        ? { serviceIds: link.serviceIds, staffId: link.staffId, step: !link.serviceIds.length ? 1 : link.staffId ? 3 : 2 }
        : undefined}
      today={localDate(new Date(), salon.timezone)}
      me={me}
      base={await salonSiteBase(slug)}
    />
  );
}
