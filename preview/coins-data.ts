// Sample coins data for the preview (Glow Studio sells packs: pay ₹2,000 → 2,100, ₹5,000 → 5,500, ₹10,000 → 11,500).
import type { CoinRow } from '../src/components/app/coin-history';
import type { CoinPack } from '../src/lib/types';
import { salon } from './data';

export const coinPacks: CoinPack[] = [{ pay: 2000, coins: 2100 }, { pay: 5000, coins: 5500 }, { pay: 10000, coins: 11500 }];
export const salonWithCoins = { ...salon, coins_enabled: true, coin_packs: coinPacks };

const ist = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, m) - 330 * 60000).toISOString();
};

/** Ananya Krishnan's coins: bought the ₹5,000 pack in July, spent on two bills, one bill cancelled, an owner goodwill top-up. */
export const ananyaCoinHistory: CoinRow[] = [
  { id: 'ct-8', kind: 'spend', coins: -3218, balance_after: 1250, amount_paid: null, method: null, reference: null, invoice_id: 'inv-1041', invoice_no: 'GS-01041', note: null, created_at: ist('2026-10-02', '15:10') },
  { id: 'ct-7', kind: 'adjust', coins: 200, balance_after: 4468, amount_paid: null, method: null, reference: null, invoice_id: null, invoice_no: null, note: 'Goodwill — appointment started 40 min late', created_at: ist('2026-09-07', '11:05') },
  { id: 'ct-6', kind: 'refund', coins: 900, balance_after: 4268, amount_paid: null, method: null, reference: null, invoice_id: 'inv-1029', invoice_no: 'GS-01029', note: 'Bill GS-01029 cancelled', created_at: ist('2026-08-20', '16:20') },
  { id: 'ct-5', kind: 'spend', coins: -900, balance_after: 3368, amount_paid: null, method: null, reference: null, invoice_id: 'inv-1029', invoice_no: 'GS-01029', note: null, created_at: ist('2026-08-20', '15:40') },
  { id: 'ct-4', kind: 'spend', coins: -1232, balance_after: 4268, amount_paid: null, method: null, reference: null, invoice_id: 'inv-1020', invoice_no: 'GS-01020', note: null, created_at: ist('2026-07-19', '15:00') },
  { id: 'ct-2', kind: 'bonus', coins: 500, balance_after: 5500, amount_paid: null, method: null, reference: null, invoice_id: null, invoice_no: null, note: 'Pack bonus', created_at: ist('2026-07-19', '14:58') },
  { id: 'ct-1', kind: 'load', coins: 5000, balance_after: 5000, amount_paid: 5000, method: 'upi', reference: 'UPI 6281 4410', invoice_id: null, invoice_no: null, note: null, created_at: ist('2026-07-19', '14:58') },
];
export const ananyaCoins = 1250;

export const coinReport = { coins_sold: 62000, coins_bonus: 5300, coins_redeemed: 48760, coins_outstanding: 84350 };
