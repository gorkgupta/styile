'use server';
import { revalidatePath } from 'next/cache';
import { getSalonContext } from '@/lib/context';
import { can } from '@/lib/permissions';
import { fail, must } from '@/lib/actions';
import { round2 } from '@/lib/billing';
import { isSacCode } from '@/lib/gst';
import type { ActionResult, Service } from '@/lib/types';

// Service menu: categories and services. Services are never deleted — past appointments and
// bills point at them — so "removing" one archives it (active = false).

// Salon services follow the statutory rate (5% since 22 Sep 2025). The only override offered is 0% (exempt, on a CA's
// advice); a rate the database still holds from before (e.g. 12%) may be kept unchanged but not newly chosen.
const SERVICE_GST_OVERRIDES = [0];
const GENDERS: Service['gender'][] = ['unisex', 'female', 'male'];
const NOT_ALLOWED = 'Only the owner or a manager can change the service menu.';

function refresh() { revalidatePath('/app', 'layout'); }

async function menuContext() {
  const ctx = await getSalonContext();
  return can(ctx.role, 'manageMenu') ? ctx : null;
}

export interface CategoryInput { id?: string; name: string }

export async function saveCategory(input: CategoryInput): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await menuContext();
    if (!ctx) return { ok: false, error: NOT_ALLOWED };
    const name = (input.name ?? '').trim().replace(/\s+/g, ' ');
    if (!name) return { ok: false, error: 'Enter a category name.' };
    if (name.length > 40) return { ok: false, error: 'Keep the category name under 40 characters.' };

    const existing = must(await ctx.supabase.from('service_categories').select('id, name, sort').eq('salon_id', ctx.salon.id)) as { id: string; name: string; sort: number }[];
    if (existing.some((c) => c.name.toLowerCase() === name.toLowerCase() && c.id !== input.id)) {
      return { ok: false, error: `You already have a category called “${name}”.` };
    }
    if (input.id) {
      must(await ctx.supabase.from('service_categories').update({ name }).eq('id', input.id).eq('salon_id', ctx.salon.id));
      refresh();
      return { ok: true, data: { id: input.id }, message: 'Category renamed' };
    }
    const sort = existing.reduce((m, c) => Math.max(m, c.sort), 0) + 1;
    const row = must(await ctx.supabase.from('service_categories').insert({ salon_id: ctx.salon.id, name, sort }).select('id').single()) as { id: string };
    refresh();
    return { ok: true, data: { id: row.id }, message: 'Category added' };
  } catch (e) { return fail(e); }
}

/** Deletes a category; its services stay on the menu under "Uncategorised". */
export async function deleteCategory(id: string): Promise<ActionResult> {
  try {
    const ctx = await menuContext();
    if (!ctx) return { ok: false, error: NOT_ALLOWED };
    const moved = must(await ctx.supabase.from('services').update({ category_id: null })
      .eq('salon_id', ctx.salon.id).eq('category_id', id).select('id')) as { id: string }[];
    must(await ctx.supabase.from('service_categories').delete().eq('id', id).eq('salon_id', ctx.salon.id));
    refresh();
    return { ok: true, message: moved.length ? `Category deleted. ${moved.length} service${moved.length === 1 ? ' is' : 's are'} now uncategorised.` : 'Category deleted' };
  } catch (e) { return fail(e); }
}

export interface ServiceInput {
  id?: string;
  name: string;
  categoryId: string | null;
  durationMin: number;
  price: number;
  /** null = the statutory rate for salon services (5% since 22 Sep 2025); 0 = exempt */
  gstRate: number | null;
  /** SAC: 999721 hair, 999722 cosmetic treatments, 999723 spa & massage, 999729 other beauty */
  sacCode?: string;
  gender: Service['gender'];
  description?: string | null;
  onlineBookable: boolean;
  active?: boolean;
}

export async function saveService(input: ServiceInput): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await menuContext();
    if (!ctx) return { ok: false, error: NOT_ALLOWED };
    const name = (input.name ?? '').trim().replace(/\s+/g, ' ');
    const duration = Math.round(Number(input.durationMin));
    const price = round2(Number(input.price));
    if (!name) return { ok: false, error: 'Enter the service name.' };
    if (name.length > 80) return { ok: false, error: 'Keep the service name under 80 characters.' };
    if (!Number.isFinite(duration) || duration < 5 || duration > 600) return { ok: false, error: 'Duration must be between 5 minutes and 10 hours.' };
    if (!Number.isFinite(price) || price < 0 || price > 1000000) return { ok: false, error: 'Enter a price between ₹0 and ₹10,00,000.' };
    const sacCode = input.sacCode ?? '999721';
    if (!isSacCode(sacCode)) return { ok: false, error: 'Choose the kind of service (hair, beauty, spa or other) for the GST code.' };
    let keepOldRate = false;
    if (input.gstRate !== null && !SERVICE_GST_OVERRIDES.includes(Number(input.gstRate))) {
      const old = input.id ? await ctx.supabase.from('services').select('gst_rate').eq('id', input.id).eq('salon_id', ctx.salon.id).maybeSingle() : null;
      keepOldRate = old?.data?.gst_rate != null && Number(old.data.gst_rate) === Number(input.gstRate);
      if (!keepOldRate) return { ok: false, error: 'Salon services are taxed at the standard rate (5% since 22 September 2025). Choose “Standard rate” unless your CA says the service is exempt.' };
    }
    if (!GENDERS.includes(input.gender)) return { ok: false, error: 'Choose who this service is for.' };
    const description = (input.description ?? '').trim();
    if (description.length > 500) return { ok: false, error: 'Keep the description under 500 characters.' };

    if (input.categoryId) {
      const cat = await ctx.supabase.from('service_categories').select('id').eq('id', input.categoryId).eq('salon_id', ctx.salon.id).maybeSingle();
      if (!cat.data) return { ok: false, error: 'That category was deleted. Pick another.' };
    }
    const same = must(await ctx.supabase.from('services').select('id').eq('salon_id', ctx.salon.id).eq('active', true).ilike('name', name.replace(/[%_\\]/g, '\\$&'))) as { id: string }[];
    if (same.some((s) => s.id !== input.id)) return { ok: false, error: `“${name}” is already on your menu. Use a different name.` };

    const row = {
      name, category_id: input.categoryId || null, duration_min: duration, price,
      gst_rate: input.gstRate === null ? null : Number(input.gstRate), sac_code: sacCode, gender: input.gender,
      description: description || null, online_bookable: !!input.onlineBookable, active: input.active ?? true,
    };
    if (input.id) {
      must(await ctx.supabase.from('services').update(row).eq('id', input.id).eq('salon_id', ctx.salon.id));
      refresh();
      return { ok: true, data: { id: input.id }, message: 'Service saved' };
    }
    const last = await ctx.supabase.from('services').select('sort').eq('salon_id', ctx.salon.id).order('sort', { ascending: false }).limit(1).maybeSingle();
    const created = must(await ctx.supabase.from('services').insert({ ...row, salon_id: ctx.salon.id, sort: (last.data?.sort ?? 0) + 1 }).select('id').single()) as { id: string };
    refresh();
    return { ok: true, data: { id: created.id }, message: 'Service added' };
  } catch (e) { return fail(e); }
}

/** Quick price change from the menu list. */
export async function updateServicePrice(id: string, price: number): Promise<ActionResult> {
  try {
    const ctx = await menuContext();
    if (!ctx) return { ok: false, error: NOT_ALLOWED };
    const p = round2(Number(price));
    if (!Number.isFinite(p) || p < 0 || p > 1000000) return { ok: false, error: 'Enter a price between ₹0 and ₹10,00,000.' };
    must(await ctx.supabase.from('services').update({ price: p }).eq('id', id).eq('salon_id', ctx.salon.id));
    refresh();
    return { ok: true, message: 'Price updated' };
  } catch (e) { return fail(e); }
}

/** Archive (hide from booking and billing) or restore a service. History keeps pointing at it. */
export async function archiveService(id: string, archived = true): Promise<ActionResult> {
  try {
    const ctx = await menuContext();
    if (!ctx) return { ok: false, error: NOT_ALLOWED };
    must(await ctx.supabase.from('services').update({ active: !archived }).eq('id', id).eq('salon_id', ctx.salon.id));
    refresh();
    return { ok: true, message: archived ? 'Service archived. Past bills and appointments are unchanged.' : 'Service restored to the menu' };
  } catch (e) { return fail(e); }
}
