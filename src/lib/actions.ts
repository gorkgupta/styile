import type { ActionResult } from './types';

/** Turn any thrown error / Supabase error into a message a salon owner can act on. */
export function errorMessage(e: unknown): string {
  const err = e as { message?: string; code?: string } | null;
  const msg = err?.message ?? '';
  if (err?.code === '23P01' || msg.includes('appointments_no_overlap')) return 'That stylist is already booked at this time. Pick another time or stylist.';
  if (err?.code === '23505' && msg.includes('customers_salon_id_phone')) return 'A client with this phone number already exists.';
  if (err?.code === '23505' && msg.includes('salons_slug')) return 'That booking link is taken. Try another.';
  if (err?.code === '42501' || msg.includes('row-level security')) return 'You do not have permission to do that.';
  if (msg && msg.length < 160 && !msg.includes('violates') && !msg.includes('syntax')) return msg;
  return 'Something went wrong. Please try again.';
}

export function fail(e: unknown): ActionResult<never> {
  return { ok: false, error: errorMessage(e) };
}

/**
 * Throw on a Supabase error so callers can use try/catch + fail().
 * Without an error, data is present for selects and .single(); writes without .select() return null, which callers ignore.
 */
export function must<R extends { data: unknown; error: unknown }>(res: R): NonNullable<R['data']> {
  if (res.error) throw res.error;
  return res.data as NonNullable<R['data']>;
}
