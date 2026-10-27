// Coins: a client's prepaid balance at one salon (1 coin = ₹1). Pure helpers shared by the database rules'
// mirror in server actions, the staff screens and the client portal. The database (0005_coins.sql) has the
// final say on every rule here.
import type { CoinPack } from './types';

export const DEFAULT_COIN_PACKS: CoinPack[] = [{ pay: 2000, coins: 2100 }, { pay: 5000, coins: 5500 }, { pay: 10000, coins: 11500 }];
export const MAX_COIN_PACKS = 8;
/** Largest single sale of coins, in rupees (same limit as load_coins). */
export const MAX_COIN_SALE = 1000000;

const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

/** "5,500" — Indian digit grouping, paise only when present. */
export function fmtCoins(n: number | string | null | undefined): string {
  return nf.format(Number(n ?? 0));
}

/** "5,500 coins", "1 coin". */
export function coinsText(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return `${fmtCoins(v)} coin${Math.abs(v) === 1 ? '' : 's'}`;
}

/** Extra coins a pack gives over what is paid. */
export function packBonus(p: CoinPack): number {
  return Math.max(0, Number(p.coins) - Number(p.pay));
}

/** Bonus as a whole percentage of the price ("10% extra"). */
export function packBonusPct(p: CoinPack): number {
  return p.pay > 0 ? Math.round((packBonus(p) / p.pay) * 100) : 0;
}

export function matchesPack(packs: CoinPack[] | null | undefined, pay: number, coins: number): boolean {
  return (packs ?? []).some((p) => Number(p.pay) === pay && Number(p.coins) === coins);
}

/** Coins that can go on a bill: never more than the client has or than is due. */
export function usableCoins(balance: number, due: number): number {
  return Math.max(0, Math.floor(Math.min(Number(balance) || 0, Number(due) || 0) * 100) / 100);
}

/**
 * Validate and tidy coin packs typed in Settings, with the same rules as the database:
 * up to 8 packs, whole rupees, price ₹1–₹10,00,000, coins at least the price and at most double it.
 */
export function checkCoinPacks(input: unknown): { ok: true; packs: CoinPack[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: 'Coin packs are missing. Refresh and try again.' };
  if (input.length > MAX_COIN_PACKS) return { ok: false, error: `Keep it to ${MAX_COIN_PACKS} coin packs or fewer.` };
  const packs: CoinPack[] = [];
  for (const raw of input) {
    const pay = Number((raw as CoinPack | null)?.pay);
    const coins = Number((raw as CoinPack | null)?.coins);
    if (!Number.isInteger(pay) || pay < 1 || pay > MAX_COIN_SALE) return { ok: false, error: 'Each pack needs a price in whole rupees, up to ₹10,00,000.' };
    if (!Number.isInteger(coins)) return { ok: false, error: `Enter the coins for the ₹${fmtCoins(pay)} pack as a whole number.` };
    if (coins < pay) return { ok: false, error: `The ₹${fmtCoins(pay)} pack must give at least ${coinsText(pay)} (1 coin = ₹1).` };
    if (coins > pay * 2) return { ok: false, error: `The ₹${fmtCoins(pay)} pack gives more than double. Keep the bonus at or under 100%.` };
    if (packs.some((p) => p.pay === pay)) return { ok: false, error: `There are two packs at ₹${fmtCoins(pay)}. Keep one.` };
    packs.push({ pay, coins });
  }
  return { ok: true, packs: packs.sort((a, b) => a.pay - b.pay) };
}
