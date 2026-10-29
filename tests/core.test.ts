// Run with: npm test   (node --test via tsx; no extra test framework needed)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBill, amountInWords, money } from '../src/lib/billing';
import { computeSlots, qualifiedStaff, nearestSlots, groupSlots } from '../src/lib/availability';
import { zonedToUtc, localDate, localTime, addDays, dayKeyOf, fmtHhmm, relativeDay, isValidDateStr } from '../src/lib/time';
import { normalizePhone, formatPhone } from '../src/lib/phone';
import type { Hours } from '../src/lib/types';

const TZ = 'Asia/Kolkata';

test('GST-inclusive bill matches the database (same case as scripts/db-test)', () => {
  // Regular salon after 22 Sep 2025: the haircut is a service at 5% (the DB ignores the 18% the app sends for a
  // service line, so the POS passes the menu's override: null); the custom serum line keeps its 18%.
  const b = computeBill(
    [
      { kind: 'service', name: 'Haircut', qty: 1, unitPrice: 600, gstRate: null },
      { kind: 'custom', name: 'Hair serum', qty: 2, unitPrice: 349.5, discount: 50, gstRate: 18 },
    ],
    { gstMode: 'regular', pricesIncludeTax: true, serviceRate: 5 },
  );
  assert.equal(b.total, 1249);
  assert.equal(b.taxableTotal, 1121.43);
  assert.equal(b.taxTotal, 127.57);
  assert.equal(b.cgst, 63.79);
  assert.equal(b.sgst, 63.78);
  assert.deepEqual(b.lines.map((l) => [l.gstRate, l.taxable, l.tax]), [[5, 571.43, 28.57], [18, 550, 99]]);
  assert.equal(b.subtotal, 1299);
  assert.equal(b.discountTotal, 50);
  assert.equal(b.roundOff, 0);
  assert.equal(b.compositionTax, 0);
});

test('GST-exclusive bill adds tax and rounds to the rupee', () => {
  const b = computeBill([{ name: 'Facial', qty: 1, unitPrice: 999 }], { gstMode: 'regular', pricesIncludeTax: false, serviceRate: 5 });
  assert.equal(b.taxableTotal, 999);
  assert.equal(b.taxTotal, 49.95);
  assert.equal(b.total, 1049);
  assert.equal(b.roundOff, 0.05);
  const db = computeBill([{ kind: 'service', name: 'Haircut', qty: 1, unitPrice: 1000 }], { gstMode: 'regular', pricesIncludeTax: false, serviceRate: 5 });
  assert.deepEqual([db.total, db.cgst, db.sgst], [1050, 25, 25], 'same as the DB test: ₹1,000 + 5%');
});

test('amount in words uses lakh/crore', () => {
  assert.equal(amountInWords(1249), 'Rupees One Thousand Two Hundred Forty Nine Only');
  assert.equal(amountInWords(250000), 'Rupees Two Lakh Fifty Thousand Only');
  assert.equal(amountInWords(12500000.5), 'Rupees One Crore Twenty Five Lakh and Fifty Paise Only');
  assert.match(money(124500), /1,24,500/);
});

test('time zone conversion for IST', () => {
  const d = zonedToUtc('2026-11-02', '10:00', TZ);
  assert.equal(d.toISOString(), '2026-11-02T04:30:00.000Z');
  assert.equal(localDate(new Date('2026-11-01T20:00:00Z'), TZ), '2026-11-02');
  assert.equal(localTime(new Date('2026-11-01T20:00:00Z'), TZ), '01:30');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(dayKeyOf('2026-11-02'), 'mon');
  assert.equal(fmtHhmm('17:45'), '5:45 PM');
  assert.equal(relativeDay('2026-11-03', '2026-11-02'), 'Tomorrow');
  assert.ok(isValidDateStr('2026-02-28') && !isValidDateStr('2026-02-30'));
});

test('time zone conversion works across DST zones too', () => {
  // New York switches to EST on 2026-11-01
  assert.equal(zonedToUtc('2026-11-02', '09:00', 'America/New_York').toISOString(), '2026-11-02T14:00:00.000Z');
  assert.equal(zonedToUtc('2026-07-02', '09:00', 'America/New_York').toISOString(), '2026-07-02T13:00:00.000Z');
});

test('phone numbers normalise to WhatsApp format', () => {
  assert.equal(normalizePhone('98765 43210'), '919876543210');
  assert.equal(normalizePhone('+91-98765-43210'), '919876543210');
  assert.equal(normalizePhone('09876543210'), '919876543210');
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone('5876543210'), null); // not an Indian mobile
  assert.equal(formatPhone('919876543210'), '+91 98765 43210');
});

const hours: Hours = { mon: [['10:00', '20:00']], tue: [['10:00', '20:00']] };

test('slots respect hours, lead time, duration and existing bookings', () => {
  const now = new Date('2026-11-02T05:00:00Z'); // 10:30 IST Monday
  const slots = computeSlots({
    date: '2026-11-02', tz: TZ, now, intervalMin: 15, leadMin: 60, durationMin: 45, branchHours: hours,
    staff: [{ id: 'priya', hours: null }, { id: 'arjun', hours: { mon: [['14:00', '20:00']] } }],
    busy: [{ staffId: 'priya', start: zonedToUtc('2026-11-02', '12:00', TZ), end: zonedToUtc('2026-11-02', '13:00', TZ) }],
  });
  // 10:30 + 60 min lead = 11:30 earliest, but a 45 min service from 11:30 would run into the 12:00 booking
  assert.equal(slots[0].time, '13:00', 'first slot is after the lead time and clear of the booking');
  assert.ok(!slots.some((s) => s.time < '13:00'), 'nothing offered that overlaps 12:00-13:00');
  assert.deepEqual(slots[0].staffIds, ['priya'], 'arjun only starts at 14:00');
  assert.ok(slots.find((s) => s.time === '13:00')?.staffIds.includes('priya'), 'free again at 13:00');
  assert.equal(slots[slots.length - 1].time, '19:15', 'last start leaves room to finish by 20:00');
  const at1500 = slots.find((s) => s.time === '15:00')!;
  assert.deepEqual(at1500.staffIds, ['arjun', 'priya'], 'least-busy stylist first');
});

test('closed days and unqualified staff give no slots', () => {
  const now = new Date('2026-11-01T00:00:00Z');
  assert.equal(computeSlots({ date: '2026-11-04', tz: TZ, now, intervalMin: 15, leadMin: 0, durationMin: 30, branchHours: hours, staff: [{ id: 'a', hours: null }], busy: [] }).length, 0);
  const staff = [
    { id: 'a', bookable: true, active: true },
    { id: 'b', bookable: true, active: true },
    { id: 'c', bookable: false, active: true },
  ];
  const skills = new Map([['a', new Set(['cut'])]]);
  assert.deepEqual(qualifiedStaff(staff, skills, ['cut', 'colour']).map((s) => s.id), ['b']);
  assert.deepEqual(qualifiedStaff(staff, skills, ['cut']).map((s) => s.id), ['a', 'b']);
});

test('nearest slots and grouping', () => {
  const now = new Date('2026-11-01T00:00:00Z');
  const slots = computeSlots({ date: '2026-11-02', tz: TZ, now, intervalMin: 30, leadMin: 0, durationMin: 30, branchHours: hours, staff: [{ id: 'a', hours: null }], busy: [] });
  assert.deepEqual(nearestSlots(slots, '17:10', 3).map((s) => s.time), ['16:30', '17:00', '17:30']);
  assert.deepEqual(groupSlots(slots).map((g) => g.label), ['Morning', 'Afternoon', 'Evening']);
});

test('login redirects stay on this site', async () => {
  const { safeNextPath } = await import('../src/lib/safe-next');
  assert.equal(safeNextPath('/app/calendar?date=2026-11-02'), '/app/calendar?date=2026-11-02');
  assert.equal(safeNextPath('/me/bills/abc'), '/me/bills/abc');
  for (const bad of ['//evil.com', '/\\evil.com', '/\t/evil.com', '/\n/evil.com', 'https://evil.com', 'evil.com', '', null, undefined, 42]) {
    assert.equal(safeNextPath(bad), null, String(bad));
  }
});
