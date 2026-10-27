// Coins helpers: pack validation mirrors salons_coin_packs_valid in 0005_coins.sql.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCoinPacks, coinsText, DEFAULT_COIN_PACKS, fmtCoins, matchesPack, packBonusPct, usableCoins } from '../src/lib/coins';
import { METHOD_LABEL } from '../src/lib/types';

test('coin amounts use Indian grouping', () => {
  assert.equal(fmtCoins(115000), '1,15,000');
  assert.equal(coinsText(5500), '5,500 coins');
  assert.equal(coinsText(1), '1 coin');
  assert.equal(METHOD_LABEL.wallet, 'Coins');
});

test('coin packs are validated like the database', () => {
  const ok = checkCoinPacks([{ pay: 5000, coins: 5500 }, { pay: 2000, coins: 2100 }]);
  assert.ok(ok.ok);
  assert.deepEqual(ok.ok && ok.packs.map((p) => p.pay), [2000, 5000], 'sorted by price');
  assert.equal(checkCoinPacks(DEFAULT_COIN_PACKS).ok, true);
  assert.equal(checkCoinPacks([{ pay: 1000, coins: 900 }]).ok, false, 'fewer coins than paid');
  assert.equal(checkCoinPacks([{ pay: 1000, coins: 2500 }]).ok, false, 'bonus over 100%');
  assert.equal(checkCoinPacks([{ pay: 0, coins: 0 }]).ok, false, 'free pack');
  assert.equal(checkCoinPacks([{ pay: 999.5, coins: 1000 }]).ok, false, 'whole rupees');
  assert.equal(checkCoinPacks([{ pay: 1000, coins: 1100 }, { pay: 1000, coins: 1200 }]).ok, false, 'duplicate price');
  assert.equal(checkCoinPacks(Array.from({ length: 9 }, (_, i) => ({ pay: (i + 1) * 1000, coins: (i + 1) * 1000 }))).ok, false, 'max 8');
  assert.equal(checkCoinPacks([]).ok, true, 'no packs is fine');
});

test('pack matching, bonus and how many coins fit on a bill', () => {
  assert.ok(matchesPack(DEFAULT_COIN_PACKS, 5000, 5500));
  assert.ok(!matchesPack(DEFAULT_COIN_PACKS, 5000, 6000));
  assert.equal(packBonusPct({ pay: 10000, coins: 11500 }), 15);
  assert.equal(usableCoins(1250, 708), 708);
  assert.equal(usableCoins(400, 708), 400);
  assert.equal(usableCoins(0, 708), 0);
  assert.equal(usableCoins(500, -10), 0);
});
