'use server';
import { revalidatePath } from 'next/cache';
import { getSalonContext } from '@/lib/context';
import { fail, must } from '@/lib/actions';
import { can } from '@/lib/permissions';
import { normalizePhone } from '@/lib/phone';
import { isValidDateStr } from '@/lib/time';
import type { ActionResult } from '@/lib/types';

export interface CustomerInput {
  id?: string | null;
  name: string;
  phone: string;
  email?: string | null;
  gender?: 'female' | 'male' | 'other' | null;
  birthday?: string | null;
  notes?: string | null;
  tags?: string[];
  marketing_opt_in?: boolean;
}

function refresh() { revalidatePath('/app', 'layout'); }

/** Add a client, or update one when `id` is given. */
export async function saveCustomer(input: CustomerInput): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase, salon } = await getSalonContext();
    const name = input.name?.trim();
    if (!name) return { ok: false, error: 'Enter the client’s name.' };
    const phone = normalizePhone(input.phone);
    if (!phone) return { ok: false, error: 'Enter a valid 10-digit mobile number.' };
    const email = input.email?.trim() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'That email address doesn’t look right.' };
    const birthday = input.birthday?.trim() || null;
    if (birthday && !isValidDateStr(birthday)) return { ok: false, error: 'Enter the birthday as a date.' };
    const gender = input.gender && ['female', 'male', 'other'].includes(input.gender) ? input.gender : null;
    const tags = [...new Set((input.tags ?? []).map((t) => t.trim()).filter(Boolean))].slice(0, 12);

    const row = {
      name, phone, email, gender, birthday, tags,
      notes: input.notes?.trim() || null,
      marketing_opt_in: input.marketing_opt_in ?? true,
    };

    // A clear message beats a constraint error when the number is already on file.
    let dupe = supabase.from('customers').select('id, name').eq('salon_id', salon.id).eq('phone', phone);
    if (input.id) dupe = dupe.neq('id', input.id);
    const { data: existing } = await dupe.maybeSingle();
    if (existing) return { ok: false, error: `This number already belongs to ${(existing as { name: string }).name}. Search for them instead.` };

    if (input.id) {
      must(await supabase.from('customers').update(row).eq('id', input.id).eq('salon_id', salon.id).select('id').single());
      refresh();
      return { ok: true, data: { id: input.id }, message: 'Client saved' };
    }
    const created = must(await supabase.from('customers').insert({ salon_id: salon.id, ...row }).select('id').single()) as { id: string };
    refresh();
    return { ok: true, data: { id: created.id }, message: 'Client added' };
  } catch (e) { return fail(e); }
}

/** Update only the notes (colour formulas, allergies) from the client profile. */
export async function saveCustomerNotes(id: string, notes: string): Promise<ActionResult> {
  try {
    const { supabase, salon } = await getSalonContext();
    must(await supabase.from('customers').update({ notes: notes.trim() || null }).eq('id', id).eq('salon_id', salon.id));
    refresh();
    return { ok: true, message: 'Notes saved' };
  } catch (e) { return fail(e); }
}

/** Delete a client with no history. Clients with visits or bills are kept for your records. */
export async function deleteCustomer(id: string): Promise<ActionResult> {
  try {
    const { supabase, salon, role } = await getSalonContext();
    if (!can(role, 'deleteClients')) return { ok: false, error: 'Only an owner or manager can delete clients.' };
    const [appts, bills, coins] = await Promise.all([
      supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('salon_id', salon.id).eq('customer_id', id),
      supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('salon_id', salon.id).eq('customer_id', id),
      supabase.from('coin_transactions').select('id', { count: 'exact', head: true }).eq('salon_id', salon.id).eq('customer_id', id),
    ]);
    const a = appts.count ?? 0, b = bills.count ?? 0, k = coins.count ?? 0;
    if (a || b || k) {
      const what = [a ? `${a} appointment${a > 1 ? 's' : ''}` : '', b ? `${b} bill${b > 1 ? 's' : ''}` : '', k ? 'coin history' : ''].filter(Boolean).join(' and ');
      return { ok: false, error: `This client has ${what}, so they can’t be deleted — their history is needed for your records and GST. You can edit their details instead.` };
    }
    must(await supabase.from('customers').delete().eq('id', id).eq('salon_id', salon.id));
    refresh();
    return { ok: true, message: 'Client deleted' };
  } catch (e) {
    const err = e as { code?: string } | null;
    if (err?.code === '23503') return { ok: false, error: 'This client has appointments on record, so they can’t be deleted. Edit their details instead.' };
    return fail(e);
  }
}
