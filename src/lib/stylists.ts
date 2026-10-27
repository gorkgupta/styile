// Stylist profiles as clients see them: the public fields of a staff row, validation of what the owner types in,
// "next free" times for the stylist picker and "book again" links. Pure and client-safe (no server imports).

import type { Slot } from './availability';
import { addDays, fmtDateShort, fmtHhmm } from './time';
import type { Staff } from './types';

export const BIO_MAX = 280;
export const SPECIALTIES_MAX = 8;
export const SPECIALTY_MAX_LEN = 30;
export const STAFF_PHOTO_BUCKET = 'staff-photos';

/** Only what a client may see about a stylist — never phone, commission or login. */
export interface PublicStylist {
  id: string; name: string; title: string | null; color: string;
  photoUrl: string | null; bio: string | null; specialties: string[]; yearsExperience: number | null;
}

export function toPublicStylist(s: Pick<Staff, 'id' | 'name' | 'title' | 'color'> & Partial<Pick<Staff, 'photo_url' | 'bio' | 'specialties' | 'years_experience'>>): PublicStylist {
  return {
    id: s.id, name: s.name, title: s.title, color: s.color,
    photoUrl: s.photo_url ?? null, bio: s.bio ?? null, specialties: s.specialties ?? [], yearsExperience: s.years_experience ?? null,
  };
}

/** Offered to clients online: takes appointments and isn't hidden from the booking page. */
export function shownOnline(s: Pick<Staff, 'active' | 'bookable'> & Partial<Pick<Staff, 'show_on_booking'>>): boolean {
  return s.active && s.bookable && s.show_on_booking !== false;
}

/** "balayage " -> "balayage", collapses inner spaces. */
export function cleanSpecialty(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

export function cleanSpecialties(input: unknown): Checked<string[]> {
  if (input == null) return { ok: true, value: [] };
  if (!Array.isArray(input) || !input.every((x) => typeof x === 'string')) return { ok: false, error: 'Specialties should be a list of short words.' };
  const out: string[] = [];
  for (const raw of input as string[]) {
    const s = cleanSpecialty(raw);
    if (!s) continue;
    if (s.length > SPECIALTY_MAX_LEN) return { ok: false, error: `Keep each specialty under ${SPECIALTY_MAX_LEN} characters (“${s.slice(0, 20)}…” is too long).` };
    if (!out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  if (out.length > SPECIALTIES_MAX) return { ok: false, error: `Add up to ${SPECIALTIES_MAX} specialties. Remove a few and try again.` };
  return { ok: true, value: out };
}

export function cleanBio(input: unknown): Checked<string | null> {
  if (input == null) return { ok: true, value: null };
  if (typeof input !== 'string') return { ok: false, error: 'Write the bio as plain text.' };
  const bio = input.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (bio.length > BIO_MAX) return { ok: false, error: `Keep the bio under ${BIO_MAX} characters (it’s ${bio.length} now).` };
  return { ok: true, value: bio || null };
}

export function cleanYears(input: unknown): Checked<number | null> {
  if (input == null || input === '') return { ok: true, value: null };
  const n = typeof input === 'number' ? input : Number(String(input).trim());
  if (!Number.isInteger(n) || n < 0 || n > 60) return { ok: false, error: 'Years of experience should be a whole number from 0 to 60, or blank.' };
  return { ok: true, value: n };
}

/** Where a salon's stylist photos live: <supabase>/storage/v1/object/public/staff-photos/<salon id>/ */
export function staffPhotoPrefix(supabaseUrl: string, salonId: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${STAFF_PHOTO_BUCKET}/${salonId}/`;
}

/** True only for a photo uploaded to this salon's folder of our own bucket (never an arbitrary URL). */
export function isStaffPhotoUrl(url: unknown, supabaseUrl: string, salonId: string): url is string {
  if (typeof url !== 'string' || !supabaseUrl || !salonId) return false;
  const prefix = staffPhotoPrefix(supabaseUrl, salonId);
  if (!prefix.startsWith('https://') || !url.startsWith(prefix)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(url.slice(prefix.length));
}

/** Storage path ("<salon>/<file>") of one of our photo URLs, for removing it; null for anything else. */
export function staffPhotoPath(url: string | null | undefined, supabaseUrl: string): string | null {
  if (!url || !supabaseUrl) return null;
  const marker = `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${STAFF_PHOTO_BUCKET}/`;
  if (!url.startsWith(marker)) return null;
  const path = url.slice(marker.length);
  return /^[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/i.test(path) ? path : null;
}

// ---------- Next free time ----------

export interface NextFree { date: string; time: string; start: string }
export interface NextFreeResult { byStaff: Record<string, NextFree>; any: NextFree | null }

/**
 * Earliest free start per stylist (and with anyone) from slots computed day by day, in date order.
 * Slots list the free stylists at each time, so one availability run per day covers the whole team.
 */
export function earliestByStylist(days: { date: string; slots: Slot[] }[], staffIds: string[]): NextFreeResult {
  const wanted = new Set(staffIds);
  const byStaff: Record<string, NextFree> = {};
  let any: NextFree | null = null;
  for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const slot of [...day.slots].sort((a, b) => a.start.localeCompare(b.start))) {
      const hit = { date: day.date, time: slot.time, start: slot.start };
      for (const id of slot.staffIds) {
        if (!wanted.has(id) || byStaff[id]) continue;
        byStaff[id] = hit;
        any ??= hit;
      }
    }
  }
  return { byStaff, any };
}

/** "Today 4:30 PM", "Tomorrow 11:00 AM", "Thu 10:00 AM" (this week), else "Thu, 5 Nov 10:00 AM". */
export function fmtNextFree(n: Pick<NextFree, 'date' | 'time'>, today: string): string {
  const time = fmtHhmm(n.time);
  if (n.date === today) return `Today ${time}`;
  if (n.date === addDays(today, 1)) return `Tomorrow ${time}`;
  const short = fmtDateShort(n.date); // "Thu, 5 Nov"
  return n.date < addDays(today, 7) ? `${short.split(',')[0]} ${time}` : `${short} ${time}`;
}

export function experienceLabel(years: number | null | undefined): string | null {
  if (years == null) return null;
  if (years < 1) return 'New to the team';
  return `${years} yr${years === 1 ? '' : 's'} experience`;
}

// ---------- Links into the booking page ----------

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Booking page link with a stylist and services already chosen ("Book again with Priya"). */
export function bookAgainHref(base: string, staffId: string | null, serviceIds: string[]): string {
  const q = new URLSearchParams();
  if (staffId) q.set('stylist', staffId);
  if (serviceIds.length) q.set('services', serviceIds.join(','));
  const qs = q.toString().replace(/%2C/g, ',');
  const path = base || '/';
  return qs ? `${path}?${qs}` : path;
}

/**
 * Validate ?stylist=&services= from a booking link against what this salon offers online.
 * Unknown or malformed ids are dropped; a stylist who doesn't do every chosen service is dropped too.
 */
export function parseBookingLink(
  params: { stylist?: string | string[]; services?: string | string[] },
  offered: { serviceIds: string[]; staffIds: string[]; skills: Record<string, string[]> },
): { serviceIds: string[]; staffId: string | null } {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const known = new Set(offered.serviceIds);
  const serviceIds = [...new Set(one(params.services).split(',').map((x) => x.trim()))]
    .filter((id) => ID_RE.test(id) && known.has(id))
    .slice(0, 10);
  const wanted = one(params.stylist).trim();
  let staffId = ID_RE.test(wanted) && offered.staffIds.includes(wanted) ? wanted : null;
  const limited = staffId ? offered.skills[staffId] : undefined;
  if (staffId && limited?.length && !serviceIds.every((id) => limited.includes(id))) staffId = null;
  return { serviceIds, staffId };
}
