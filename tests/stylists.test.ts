// Stylist profiles: validation, photo URL safety, "next free" times and book-again links.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bookAgainHref, cleanBio, cleanSpecialties, cleanYears, earliestByStylist, experienceLabel, fmtNextFree,
  isStaffPhotoUrl, parseBookingLink, shownOnline, staffPhotoPath, toPublicStylist,
} from '../src/lib/stylists';
import { computeSlots } from '../src/lib/availability';
import { zonedToUtc } from '../src/lib/time';
import type { Hours } from '../src/lib/types';

const SB = 'https://abcd.supabase.co';
const SALON = '6f1c2a3b-1111-4222-8333-444455556666';
const OTHER = '7a7a7a7a-1111-4222-8333-444455556666';
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('specialties are trimmed, de-duplicated and limited', () => {
  assert.deepEqual(cleanSpecialties(['  Balayage ', 'balayage', 'Global   colour', '']), { ok: true, value: ['Balayage', 'Global colour'] });
  assert.equal(cleanSpecialties(Array.from({ length: 9 }, (_, i) => `s${i}`)).ok, false);
  assert.equal(cleanSpecialties(['x'.repeat(31)]).ok, false);
  assert.equal(cleanSpecialties('balayage').ok, false);
  assert.deepEqual(cleanSpecialties(undefined), { ok: true, value: [] });
});

test('bio and years of experience are validated', () => {
  assert.deepEqual(cleanBio('  Loves   curls \r\n\r\n\r\n Ask her  '), { ok: true, value: 'Loves curls \n\n Ask her' });
  assert.deepEqual(cleanBio('   '), { ok: true, value: null });
  assert.equal(cleanBio('a'.repeat(281)).ok, false);
  assert.deepEqual(cleanYears('12'), { ok: true, value: 12 });
  assert.deepEqual(cleanYears(''), { ok: true, value: null });
  for (const bad of [-1, 61, 2.5, 'ten']) assert.equal(cleanYears(bad).ok, false, String(bad));
});

test('only photos in this salon’s folder of our bucket are accepted', () => {
  const good = `${SB}/storage/v1/object/public/staff-photos/${SALON}/${ID(1)}-1730000000000.jpg`;
  assert.ok(isStaffPhotoUrl(good, SB, SALON));
  assert.ok(isStaffPhotoUrl(good, `${SB}/`, SALON), 'trailing slash on the env value is fine');
  assert.ok(!isStaffPhotoUrl(good, SB, OTHER), 'another salon’s folder');
  assert.ok(!isStaffPhotoUrl('https://evil.example/x.jpg', SB, SALON));
  assert.ok(!isStaffPhotoUrl(`${SB}/storage/v1/object/public/staff-photos/${SALON}/../${OTHER}/x.jpg`, SB, SALON), 'no path tricks');
  assert.ok(!isStaffPhotoUrl(`${SB}/storage/v1/object/public/staff-photos/${SALON}/x.jpg" onerror="x`, SB, SALON));
  assert.ok(!isStaffPhotoUrl((good as string).replace('https:', 'http:'), SB.replace('https:', 'http:'), SALON), 'https only');
  assert.equal(staffPhotoPath(good, SB), `${SALON}/${ID(1)}-1730000000000.jpg`);
  assert.equal(staffPhotoPath('https://evil.example/x.jpg', SB), null);
});

test('public stylist fields never include phone or commission', () => {
  const pub = toPublicStylist({ id: 'a', name: 'Priya', title: null, color: '#7A3FB8', photo_url: null, bio: 'Hi', specialties: ['Bobs'], years_experience: 9,
    // extra private fields on the row must not leak through
    ...({ phone: '919900011111', commission_pct: 12 } as object) });
  assert.deepEqual(Object.keys(pub).sort(), ['bio', 'color', 'id', 'name', 'photoUrl', 'specialties', 'title', 'yearsExperience']);
  assert.ok(shownOnline({ active: true, bookable: true, show_on_booking: true }));
  assert.ok(!shownOnline({ active: true, bookable: true, show_on_booking: false }), 'desk-only stylist');
  assert.ok(!shownOnline({ active: true, bookable: false, show_on_booking: true }));
});

test('next free time per stylist comes from one slot run per day', () => {
  const TZ = 'Asia/Kolkata';
  const hours: Hours = { tue: [['10:00', '13:00']], wed: [['10:00', '13:00']] };
  const now = new Date('2026-10-27T05:50:00Z'); // Tue 11:20 IST
  const day = (date: string) => computeSlots({
    date, tz: TZ, now, intervalMin: 30, leadMin: 30, durationMin: 60, branchHours: hours,
    staff: [{ id: 'priya', hours: null }, { id: 'meera', hours: null }, { id: 'arjun', hours: { wed: [['12:00', '13:00']] } }],
    busy: [{ staffId: 'priya', start: zonedToUtc(date, '10:00', TZ), end: zonedToUtc(date, '13:00', TZ) }], // Priya is fully booked both days
  });
  const r = earliestByStylist([{ date: '2026-10-28', slots: day('2026-10-28') }, { date: '2026-10-27', slots: day('2026-10-27') }], ['priya', 'meera', 'arjun']);
  assert.deepEqual(r.byStaff.meera, { date: '2026-10-27', time: '12:00', start: zonedToUtc('2026-10-27', '12:00', TZ).toISOString() });
  assert.equal(r.byStaff.arjun.date, '2026-10-28');
  assert.equal(r.byStaff.arjun.time, '12:00');
  assert.equal(r.byStaff.priya, undefined, 'no time found -> no entry');
  assert.equal(r.any?.time, '12:00');
  assert.equal(r.any?.date, '2026-10-27');
});

test('next free labels read naturally', () => {
  const today = '2026-10-27'; // Tuesday
  assert.equal(fmtNextFree({ date: today, time: '16:30' }, today), 'Today 4:30 PM');
  assert.equal(fmtNextFree({ date: '2026-10-28', time: '11:00' }, today), 'Tomorrow 11:00 AM');
  assert.equal(fmtNextFree({ date: '2026-10-29', time: '10:00' }, today), 'Thu 10:00 AM');
  assert.equal(fmtNextFree({ date: '2026-11-05', time: '10:00' }, today), 'Thu, 5 Nov 10:00 AM');
  assert.equal(experienceLabel(1), '1 yr experience');
  assert.equal(experienceLabel(12), '12 yrs experience');
  assert.equal(experienceLabel(0), 'New to the team');
  assert.equal(experienceLabel(null), null);
});

test('book-again links and their validation on the booking page', () => {
  assert.equal(bookAgainHref('', ID(1), [ID(2), ID(3)]), `/?stylist=${ID(1)}&services=${ID(2)},${ID(3)}`);
  assert.equal(bookAgainHref('/s/glow', ID(1), []), `/s/glow?stylist=${ID(1)}`);
  assert.equal(bookAgainHref('/s/glow', null, []), '/s/glow');

  const offered = { serviceIds: [ID(2), ID(3), ID(4)], staffIds: [ID(1), ID(9)], skills: { [ID(9)]: [ID(4)] } };
  assert.deepEqual(parseBookingLink({ stylist: ID(1), services: `${ID(2)},${ID(3)},${ID(3)}` }, offered), { serviceIds: [ID(2), ID(3)], staffId: ID(1) });
  assert.deepEqual(parseBookingLink({ stylist: 'nope', services: `${ID(2)},junk,${ID(7)}` }, offered), { serviceIds: [ID(2)], staffId: null }, 'unknown ids dropped');
  assert.deepEqual(parseBookingLink({ stylist: ID(9), services: ID(2) }, offered), { serviceIds: [ID(2)], staffId: null }, 'stylist who doesn’t do the service is dropped');
  assert.deepEqual(parseBookingLink({ stylist: ID(9), services: ID(4) }, offered), { serviceIds: [ID(4)], staffId: ID(9) });
  assert.deepEqual(parseBookingLink({ stylist: ID(5) }, offered), { serviceIds: [], staffId: null }, 'hidden / unknown stylist dropped');
  assert.deepEqual(parseBookingLink({ stylist: [ID(1), ID(9)] }, offered), { serviceIds: [], staffId: ID(1) });
  assert.equal(parseBookingLink({ services: Array.from({ length: 15 }, () => ID(2)).join(',') }, offered).serviceIds.length, 1);
});
