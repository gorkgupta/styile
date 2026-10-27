import 'server-only';
import { headers } from 'next/headers';
import { SALON_HEADER, siteBase } from './tenant';

/** Slug of the salon whose subdomain served this request (set by the middleware), or null on the main site. */
export async function hostSalonSlug(): Promise<string | null> {
  return (await headers()).get(SALON_HEADER);
}

/** Link prefix for pages of the salon site `slug`: "" on its own subdomain, "/s/<slug>" otherwise. */
export async function salonSiteBase(slug: string): Promise<string> {
  return siteBase(slug, (await hostSalonSlug()) === slug);
}
