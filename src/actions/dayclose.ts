'use server';
import { revalidatePath } from 'next/cache';
import { getSalonContext } from '@/lib/context';
import { fail, must } from '@/lib/actions';
import { can } from '@/lib/permissions';
import { cashDifference, fmtNu, isClosableDate } from '@/lib/dayclose';
import { money } from '@/lib/billing';
import { fmtDateShort, localDate } from '@/lib/time';
import type { ActionResult } from '@/lib/types';

// Day-end close: close_day() in the database works out the day's summary and stores it with the cash counted.
// Reopening (owner/manager) deletes the close so the day can be corrected and closed again.

const MAX_CASH = 100000000;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface CloseDayInput {
  date: string;
  /** Rupee cash counted in the drawer. */
  countedCash: number;
  /** Ngultrum counted (null when the salon doesn't take Nu). */
  countedCashNu?: number | null;
  /** Rupees taken out of the drawer after counting (handed to the owner / banked). The rest opens tomorrow. */
  cashOut?: number | null;
  cashOutNu?: number | null;
  notes?: string | null;
}

export interface CloseDayResult { id: string; difference: number; differenceNu: number | null }

export async function closeDay(input: CloseDayInput): Promise<ActionResult<CloseDayResult>> {
  try {
    const { supabase, salon, role } = await getSalonContext();
    if (!can(role, 'closeDay')) return { ok: false, error: 'Your role can’t close the day. Ask the front desk or a manager.' };
    const today = localDate(new Date(), salon.timezone);
    if (!isClosableDate(input.date, today)) return { ok: false, error: 'Pick today or an earlier day to close.' };
    if (!finite(input.countedCash) || input.countedCash < 0 || input.countedCash > MAX_CASH) {
      return { ok: false, error: 'Enter the rupee cash you counted in the drawer (0 if it’s empty).' };
    }
    const nu = input.countedCashNu == null ? null : input.countedCashNu;
    if (nu !== null && (!finite(nu) || nu < 0 || nu > MAX_CASH)) return { ok: false, error: 'Enter the Ngultrum you counted, or leave it empty.' };
    const out = input.cashOut ?? 0;
    if (!finite(out) || out < 0) return { ok: false, error: 'Cash taken out can’t be negative.' };
    if (out > input.countedCash) return { ok: false, error: 'Cash taken out can’t be more than the cash counted.' };
    const outNu = input.cashOutNu ?? null;
    if (outNu !== null && (!finite(outNu) || outNu < 0 || outNu > (nu ?? 0))) {
      return { ok: false, error: 'Ngultrum taken out can’t be more than the Ngultrum counted.' };
    }
    const notes = (input.notes ?? '').trim().slice(0, 500) || null;

    const row = must(await supabase.rpc('close_day', {
      p_salon: salon.id, p_date: input.date, p_counted_cash: r2(input.countedCash), p_counted_cash_nu: nu === null ? null : r2(nu),
      p_notes: notes, p_cash_out: r2(out), p_cash_out_nu: outNu === null ? null : r2(outNu),
    })) as { id: string; difference: number; difference_nu: number | null };

    const d = cashDifference(Number(row.difference), 0);
    let message = `${fmtDateShort(input.date)} closed · ${d.kind === 'balanced' ? 'cash matches' : `${money(Math.abs(d.amount))} ${d.kind}`}`;
    if (row.difference_nu != null && Math.abs(Number(row.difference_nu)) >= 0.005) {
      message += ` · ${fmtNu(Math.abs(Number(row.difference_nu)))} ${Number(row.difference_nu) > 0 ? 'excess' : 'short'}`;
    }
    revalidatePath('/app', 'layout');
    return { ok: true, data: { id: row.id, difference: Number(row.difference), differenceNu: row.difference_nu == null ? null : Number(row.difference_nu) }, message };
  } catch (e) { return fail(e); }
}

/** Reopen a closed day (owner/manager): removes the snapshot so bills and expenses can be corrected and the day closed again. */
export async function reopenDay(date: string): Promise<ActionResult> {
  try {
    const { supabase, salon, role } = await getSalonContext();
    if (!can(role, 'reopenDay')) return { ok: false, error: 'Only an owner or manager can reopen a closed day.' };
    if (!isClosableDate(date, localDate(new Date(), salon.timezone))) return { ok: false, error: 'That day isn’t closed.' };
    const rows = must(await supabase.from('day_closes').delete().eq('salon_id', salon.id).eq('business_date', date).select('id')) as { id: string }[];
    if (!rows.length) return { ok: false, error: 'That day isn’t closed (or was already reopened). Refresh the page.' };
    revalidatePath('/app', 'layout');
    return { ok: true, message: `${fmtDateShort(date)} reopened — close it again when you’re done` };
  } catch (e) { return fail(e); }
}
