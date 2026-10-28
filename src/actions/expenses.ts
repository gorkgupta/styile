'use server';
import { revalidatePath } from 'next/cache';
import { getSalonContext } from '@/lib/context';
import { fail, must } from '@/lib/actions';
import { can } from '@/lib/permissions';
import { isExpenseCategory, isPaidFrom, MAX_EXPENSE, type ExpenseCategory, type PaidFrom } from '@/lib/dayclose';
import { money } from '@/lib/billing';
import { addDays, isValidDateStr, localDate } from '@/lib/time';
import type { ActionResult } from '@/lib/types';

// Expense log. Owner/manager add, edit and delete; the front desk can add today's and yesterday's.
// A closed day's expenses are frozen by the database until the day is reopened.

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ExpenseInput {
  id?: string | null;
  spentOn: string;
  category: ExpenseCategory;
  amount: number;
  paidFrom: PaidFrom;
  note?: string | null;
  /** The staff member who got a "Staff advance". */
  staffId?: string | null;
}

export async function saveExpense(input: ExpenseInput): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase, salon, role } = await getSalonContext();
    const editing = !!input.id;
    if (editing ? !can(role, 'manageExpenses') : !can(role, 'addExpense')) {
      return { ok: false, error: editing ? 'Only an owner or manager can change expenses.' : 'Your role can’t add expenses.' };
    }
    if (editing && !ID_RE.test(String(input.id))) return { ok: false, error: 'Expense not found. Refresh the page.' };
    const today = localDate(new Date(), salon.timezone);
    if (!isValidDateStr(input.spentOn)) return { ok: false, error: 'Pick the date the money was spent.' };
    if (input.spentOn > today) return { ok: false, error: 'An expense date can’t be in the future.' };
    if (!can(role, 'manageExpenses') && input.spentOn < addDays(today, -1)) {
      return { ok: false, error: 'The front desk can add expenses for today or yesterday. Ask the owner to add older ones.' };
    }
    if (!isExpenseCategory(input.category)) return { ok: false, error: 'Pick a category.' };
    if (!isPaidFrom(input.paidFrom)) return { ok: false, error: 'Pick how it was paid.' };
    const amount = typeof input.amount === 'number' && Number.isFinite(input.amount) ? Math.round(input.amount * 100) / 100 : NaN;
    if (!(amount > 0)) return { ok: false, error: 'Enter the amount spent.' };
    if (amount > MAX_EXPENSE) return { ok: false, error: 'That’s more than ₹1,00,00,000. Check the amount.' };
    const advance = input.category === 'Staff advance';
    const staffId = advance ? input.staffId || null : null;
    if (advance && !staffId) return { ok: false, error: 'Choose who got the advance.' };
    if (staffId && !ID_RE.test(staffId)) return { ok: false, error: 'Choose who got the advance.' };
    const note = (input.note ?? '').trim().slice(0, 300) || null;

    const row = { spent_on: input.spentOn, category: input.category, amount, paid_from: input.paidFrom, note, staff_id: staffId };
    let id: string;
    if (editing) {
      const rows = must(await supabase.from('expenses').update(row).eq('id', input.id!).eq('salon_id', salon.id).select('id')) as { id: string }[];
      if (!rows.length) return { ok: false, error: 'Expense not found. It may have been deleted — refresh the page.' };
      id = rows[0].id;
    } else {
      const r = must(await supabase.from('expenses').insert({ ...row, salon_id: salon.id }).select('id').single()) as { id: string };
      id = r.id;
    }
    revalidatePath('/app', 'layout');
    return { ok: true, data: { id }, message: editing ? 'Expense updated' : `${money(amount)} ${input.category.toLowerCase()} added` };
  } catch (e) { return fail(e); }
}

export async function deleteExpense(id: string): Promise<ActionResult> {
  try {
    const { supabase, salon, role } = await getSalonContext();
    if (!can(role, 'manageExpenses')) return { ok: false, error: 'Only an owner or manager can delete expenses.' };
    if (typeof id !== 'string' || !ID_RE.test(id)) return { ok: false, error: 'Expense not found.' };
    const rows = must(await supabase.from('expenses').delete().eq('id', id).eq('salon_id', salon.id).select('id')) as { id: string }[];
    if (!rows.length) return { ok: false, error: 'Expense not found. It may have been deleted already — refresh the page.' };
    revalidatePath('/app', 'layout');
    return { ok: true, message: 'Expense deleted' };
  } catch (e) { return fail(e); }
}
