'use server';
import { revalidatePath } from 'next/cache';
import { getSalonContext } from '@/lib/context';
import { fail, must } from '@/lib/actions';
import { can } from '@/lib/permissions';
import { coinsText, matchesPack, MAX_COIN_SALE } from '@/lib/coins';
import { notifyCoinsAdded } from '@/lib/whatsapp/outbox';
import type { ActionResult, CoinTransaction, PayMethod } from '@/lib/types';

// Coins: a client's prepaid balance at this salon (1 coin = ₹1), sold at the desk and spent on bills here.
// Selling coins is an advance, not a sale — it never creates a GST invoice. All balance changes happen in the
// database functions load_coins / adjust_coins (and create_invoice / add_payment / void_invoice for bills).

const LOAD_METHODS: PayMethod[] = ['cash', 'upi', 'card', 'other', 'cash_nu', 'upi_bhutan'];
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refresh() { revalidatePath('/app', 'layout'); }
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export interface LoadCoinsInput {
  customerId: string;
  /** Rupees received. */
  pay: number;
  /** Coins to add; defaults to `pay`. More than `pay` is a bonus (a salon pack, or owner/manager only). */
  coins?: number | null;
  method: PayMethod;
  reference?: string | null;
  note?: string | null;
  /** Send the client a coins receipt on WhatsApp (default true). */
  sendOnWhatsApp?: boolean;
}

export interface CoinsResult { balance: number; coinsAdded: number; bonus: number; sentOnWhatsApp: boolean }

/** Sell coins at the desk (cash / UPI / card). */
export async function loadCoins(input: LoadCoinsInput): Promise<ActionResult<CoinsResult>> {
  try {
    const { supabase, salon, role } = await getSalonContext();
    if (!can(role, 'sellCoins')) return { ok: false, error: 'Your role can’t sell coins. Ask the front desk or a manager.' };
    if (!salon.coins_enabled) return { ok: false, error: 'Coins are turned off. The owner can turn them on in Settings → Coins.' };
    if (typeof input.customerId !== 'string' || !ID_RE.test(input.customerId)) return { ok: false, error: 'Choose a client first.' };
    const pay = finite(input.pay) ? Math.round(input.pay * 100) / 100 : NaN;
    if (!finite(pay) || pay < 1) return { ok: false, error: 'Enter the amount the client paid.' };
    if (pay > MAX_COIN_SALE) return { ok: false, error: 'That’s more than ₹10,00,000. Sell it in smaller parts.' };
    const coins = input.coins == null ? pay : Math.round(Number(input.coins) * 100) / 100;
    if (!finite(coins) || coins < pay) return { ok: false, error: 'Coins can’t be less than the amount paid (1 coin = ₹1).' };
    if (coins > pay * 2) return { ok: false, error: 'The bonus can’t be more than the amount paid.' };
    if (coins > pay && !matchesPack(salon.coin_packs, pay, coins) && !can(role, 'giveCoinBonus')) {
      return { ok: false, error: 'Only an owner or manager can give a custom bonus. Pick a coin pack or sell without a bonus.' };
    }
    if (!LOAD_METHODS.includes(input.method)) return { ok: false, error: 'Pick how the client paid: cash, UPI or card.' };

    const r = must(await supabase.rpc('load_coins', {
      p_salon: salon.id, p_customer: input.customerId, p_pay: pay, p_coins: coins, p_method: input.method,
      p_reference: input.reference?.trim().slice(0, 120) || null, p_note: input.note?.trim().slice(0, 300) || null,
    })) as { balance: number; coins: number; bonus: number };
    const balance = Number(r.balance), added = Number(r.coins);

    let message = `${coinsText(added)} added · balance ${coinsText(balance)}`;
    let sentOnWhatsApp = false;
    if (input.sendOnWhatsApp !== false) {
      const sent = await notifyCoinsAdded(salon.id, input.customerId, pay, added, balance);
      sentOnWhatsApp = sent.sent;
      if (sent.sent) message += ' · sent on WhatsApp';
      else if (sent.reason !== 'WhatsApp is not connected') message += ` · not sent on WhatsApp (${sent.reason ?? 'send failed'})`;
    }
    refresh();
    return { ok: true, data: { balance, coinsAdded: added, bonus: Number(r.bonus), sentOnWhatsApp }, message };
  } catch (e) { return fail(e); }
}

/** Owner correction: add (positive) or remove (negative) coins, with a note saying why. */
export async function adjustCoins(customerId: string, coins: number, note: string): Promise<ActionResult<{ balance: number }>> {
  try {
    const { supabase, salon, role } = await getSalonContext();
    if (!can(role, 'adjustCoins')) return { ok: false, error: 'Only the salon owner can adjust coin balances.' };
    if (typeof customerId !== 'string' || !ID_RE.test(customerId)) return { ok: false, error: 'Client not found.' };
    const n = finite(coins) ? Math.round(coins * 100) / 100 : NaN;
    if (!finite(n) || n === 0) return { ok: false, error: 'Enter the coins to add or remove.' };
    if (Math.abs(n) > MAX_COIN_SALE) return { ok: false, error: 'Adjust by up to 10,00,000 coins at a time.' };
    const why = (note ?? '').trim();
    if (!why) return { ok: false, error: 'Add a note saying why — it stays in the coin history.' };
    const r = must(await supabase.rpc('adjust_coins', { p_salon: salon.id, p_customer: customerId, p_coins: n, p_note: why.slice(0, 300) })) as { balance: number };
    refresh();
    return { ok: true, data: { balance: Number(r.balance) }, message: `${n > 0 ? 'Added' : 'Removed'} ${coinsText(Math.abs(n))} · balance ${coinsText(Number(r.balance))}` };
  } catch (e) { return fail(e); }
}

export interface CoinHistoryRow extends CoinTransaction { invoice_no: string | null }

/** A client's coin history at this salon, newest first, with the bill number for spends and refunds. */
export async function getCoinHistory(customerId: string): Promise<ActionResult<{ balance: number; rows: CoinHistoryRow[] }>> {
  try {
    const { supabase, salon, role } = await getSalonContext();
    if (!can(role, 'sellCoins')) return { ok: false, error: 'Your role can’t see coin history.' };
    if (typeof customerId !== 'string' || !ID_RE.test(customerId)) return { ok: false, error: 'Client not found.' };
    const [cust, tx] = await Promise.all([
      supabase.from('customers').select('coin_balance').eq('id', customerId).eq('salon_id', salon.id).single(),
      supabase.from('coin_transactions').select('*, invoice:invoices(invoice_no)')
        .eq('salon_id', salon.id).eq('customer_id', customerId).order('created_at', { ascending: false }).limit(500),
    ]);
    const c = must(cust) as { coin_balance: number };
    const rows = (must(tx) as (CoinTransaction & { invoice: { invoice_no: string } | null })[]).map(({ invoice, ...t }) => ({
      ...t, coins: Number(t.coins), balance_after: Number(t.balance_after), amount_paid: t.amount_paid == null ? null : Number(t.amount_paid),
      invoice_no: invoice?.invoice_no ?? null,
    }));
    return { ok: true, data: { balance: Number(c.coin_balance), rows } };
  } catch (e) { return fail(e); }
}
