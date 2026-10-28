// Bridal and event bookings with advances: helpers (the money rules themselves are tested in scripts/db-test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceLeft, byMonth, checkEvent, countdown, daysTo, eventMoney, type EventInput } from '../src/lib/events';
import { isPrepaidMethod } from '../src/lib/types';
import { isPrepaid, methodLabel, normalizeSummary, sortMethods } from '../src/lib/dayclose';

const adv = (amount: number, applied = 0, refund: number | null = null) => ({ amount, applied_amount: applied, refund_amount: refund });

test('what is left of an advance: received − used − handed back', () => {
  assert.equal(advanceLeft(adv(3000)), 3000);
  assert.equal(advanceLeft(adv(3000, 3000)), 0);
  assert.equal(advanceLeft(adv(2000, 0, 1500)), 500);
  assert.equal(advanceLeft(adv(2000, 500, 1500)), 0);
});

test('event money: quote with travel, advances, balance due', () => {
  const ev = { quoted_price: 9000, travel_charge: 500, location: 'home' as const };
  const m = eventMoney(ev, [adv(3000), adv(2000, 0, 1500)]);
  assert.deepEqual(m, { quoted: 9500, received: 5000, applied: 0, refunded: 1500, left: 3500, balanceDue: 6000 });
  assert.equal(eventMoney({ ...ev, location: 'salon' }, []).quoted, 9000, 'no travel charge at the salon');
  assert.equal(eventMoney({ quoted_price: 1000, travel_charge: 0, location: 'salon' }, [adv(3000)]).balanceDue, 0, 'never below zero');
  assert.equal(eventMoney({ quoted_price: null, travel_charge: 0, location: 'salon' }, []).quoted, 0);
});

test('countdown and months for the events list', () => {
  assert.equal(daysTo('2026-11-17', '2026-10-28'), 20);
  assert.equal(countdown('2026-10-28', '2026-10-28'), 'Today');
  assert.equal(countdown('2026-10-29', '2026-10-28'), 'Tomorrow');
  assert.equal(countdown('2026-11-17', '2026-10-28'), 'In 20 days');
  assert.equal(countdown('2026-10-25', '2026-10-28'), '3 days ago');
  assert.deepEqual(byMonth(['2026-11-02', '2026-11-20', '2026-12-01'], (d) => d).map((g) => [g.month, g.rows.length]), [['2026-11', 2], ['2026-12', 1]]);
});

const base: EventInput = {
  customerId: 'c', type: 'bridal', title: 'Deki’s wedding', eventAt: '2026-11-17T00:30:00Z', location: 'home', address: 'Ward 4, Jaigaon', travelCharge: 500,
  people: [{ name: 'Bride', serviceIds: ['s'], staffId: 'st', start: '2026-11-16T21:30:00Z' }],
  trial: { start: '2026-11-02T05:30:00Z', staffId: 'st', serviceIds: ['s'] },
  advance: { amount: 3000, method: 'upi' },
};
const err = (i: EventInput) => { const r = checkEvent(i); return r.ok ? '' : r.error; };

test('checking a new event before it is sent', () => {
  assert.ok(checkEvent(base).ok);
  assert.match(err({ ...base, customerId: '' }), /client/);
  assert.match(err({ ...base, address: ' ' }), /address/);
  assert.match(err({ ...base, people: [] }), /at least one person/);
  assert.match(err({ ...base, people: [{ ...base.people[0], serviceIds: [] }] }), /services for Bride/);
  assert.match(err({ ...base, trial: { ...base.trial!, start: '2026-11-20T05:30:00Z' } }), /before the event/);
  assert.match(err({ ...base, advance: { amount: 100, method: 'wallet' } }), /cash, UPI or card/);
  assert.match(err({ ...base, travelCharge: -1 }), /Travel/);
  assert.ok(checkEvent({ ...base, location: 'salon', address: null, trial: null, advance: null }).ok);
});

test('advances are prepaid like coins and packages: not money on the day of the bill', () => {
  assert.ok(isPrepaidMethod('advance') && isPrepaidMethod('package') && isPrepaidMethod('wallet') && !isPrepaidMethod('cash_nu'));
  assert.ok(isPrepaid('advance'));
  assert.equal(methodLabel('advance'), 'Advance');
  assert.deepEqual(sortMethods(['advance', 'upi', 'wallet']), ['upi', 'wallet', 'advance']);
  const s = normalizeSummary({ totals: { advances_received: '5000', advance_used: 5000 }, by_method: { upi: { bills: 0, advances: '3000', refunds: 0, net: 3000 } } });
  assert.equal(s.totals.advances_received, 5000);
  assert.equal(s.by_method.upi.advances, 3000);
});
