// Languages: t() fallback, placeholders and plurals; every dictionary matches the English keys and placeholders;
// dates in Hindi / Nepali / Bengali keep Latin digits; a coverage report per language is printed at the end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createT, interpolate, relDay, fmtDurationT, type Msg } from '../src/lib/i18n/core';
import { en, type MessageKey, type Messages } from '../src/lib/i18n/en';
import { hi } from '../src/lib/i18n/hi';
import { ne } from '../src/lib/i18n/ne';
import { bn } from '../src/lib/i18n/bn';
import { pickSiteLocale, toLocale, LOCALES } from '../src/lib/i18n/locales';
import { coinsT, countdownT, relativeAgoT } from '../src/lib/i18n/format';
import { dateParts, fmtDateLong, fmtDateShort, fmtDateTime, fmtTime, intlLocale, relativeDay } from '../src/lib/time';
import { fmtDateYear } from '../src/lib/periods';

const DICTS: Record<'hi' | 'ne' | 'bn', Messages> = { hi, ne, bn };
const placeholders = (m: Msg | undefined): Set<string> => {
  const texts = m === undefined ? [] : typeof m === 'string' ? [m] : Object.values(m).filter((x): x is string => typeof x === 'string');
  return new Set(texts.flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1])));
};

test('t() fills placeholders and falls back to English for keys a language leaves out', () => {
  const t = createT('hi', { 'common.cancel': 'रद्द', 'bk.callSalon': '{name} को कॉल करें' } as Messages);
  assert.equal(t('common.cancel'), 'रद्द');
  assert.equal(t('bk.callSalon', { name: 'Glow Studio' }), 'Glow Studio को कॉल करें');
  assert.equal(t('common.continue'), 'Continue'); // not in this dictionary -> English
  assert.equal(t('bk.openToday', { hours: '10:00 AM – 8:00 PM' }), 'Open today 10:00 AM – 8:00 PM');
  assert.equal(createT('en')('common.cancel'), 'Cancel');
  // English ignores any dictionary it is given
  assert.equal(createT('en', { 'common.cancel': 'X' } as Messages)('common.cancel'), 'Cancel');
});

test('interpolation leaves unknown placeholders visible and accepts numbers', () => {
  assert.equal(interpolate('Hi {name}, {count} left', { name: 'Asha', count: 3 }), 'Hi Asha, 3 left');
  assert.equal(interpolate('Hi {name}', {}), 'Hi {name}');
  assert.equal(interpolate('Hi {name}', { name: null }), 'Hi {name}');
  assert.equal(interpolate('No braces', { name: 'x' }), 'No braces');
});

test('plurals pick the one/other form with each language’s rules', () => {
  const t = createT('en');
  assert.equal(t('common.services', { count: 1 }), '1 service');
  assert.equal(t('common.services', { count: 3 }), '3 services');
  assert.equal(t('common.services', { count: 0 }), '0 services');
  assert.equal(coinsT(t, 1), '1 coin');
  assert.equal(coinsT(t, 5500), '5,500 coins');
  // Hindi plural rules: 0 and 1 are "one"; a dictionary may give a plain string for both.
  const th = createT('hi', { 'common.services': { one: '{count} सर्विस', other: '{count} सर्विसेज़' } } as Messages);
  assert.equal(th('common.services', { count: 1 }), '1 सर्विस');
  assert.equal(th('common.services', { count: 0 }), '0 सर्विस');
  assert.equal(th('common.services', { count: 4 }), '4 सर्विसेज़');
  const tn = createT('ne', { 'common.services': '{count} वटा सर्भिस' } as Messages);
  assert.equal(tn('common.services', { count: 1 }), '1 वटा सर्भिस');
  // A plural message without a count uses "other"
  assert.equal(createT('en')('bk.yearsExp'), '{count} yrs experience');
});

test('server messages in English are shown in the page’s language when the dictionary knows them', () => {
  const t = createT('bn', { 'err.taken': 'এই সময়টা এইমাত্র বুক হয়ে গেছে। অন্য সময় বাছুন।' } as Messages);
  assert.equal(t.err('That time was just taken. Please pick another slot.'), 'এই সময়টা এইমাত্র বুক হয়ে গেছে। অন্য সময় বাছুন।');
  assert.equal(t.err('That time was just taken. Please pick another slot'), 'এই সময়টা এইমাত্র বুক হয়ে গেছে। অন্য সময় বাছুন।'); // without the full stop
  assert.equal(t.err('Something new from the server'), 'Something new from the server');
  assert.equal(createT('en').err('That time was just taken. Please pick another slot.'), 'That time was just taken. Please pick another slot.');
});

test('every language uses only English keys, the same placeholders, and no empty strings', () => {
  const enKeys = new Set(Object.keys(en));
  for (const [lang, dict] of Object.entries(DICTS)) {
    for (const [key, msg] of Object.entries(dict) as [MessageKey, Msg][]) {
      assert.ok(enKeys.has(key), `${lang}: "${key}" is not an English key`);
      const want = placeholders(en[key] as Msg);
      const got = placeholders(msg);
      assert.deepEqual([...got].sort(), [...want].sort(), `${lang}: "${key}" placeholders ${[...got]} should be ${[...want]}`);
      const texts = typeof msg === 'string' ? [msg] : Object.values(msg);
      for (const text of texts) {
        assert.ok(typeof text === 'string' && text.trim().length > 0, `${lang}: "${key}" is empty`);
        assert.ok(!/[०-९০-৯]/.test(text), `${lang}: "${key}" uses Devanagari/Bengali digits; keep Latin digits`);
      }
      if (typeof msg !== 'string') assert.ok(typeof msg.other === 'string', `${lang}: "${key}" plural needs "other"`);
    }
  }
});

test('salon-site language: ?lang= beats the cookie, which beats the salon default', () => {
  assert.equal(pickSiteLocale({ query: 'bn', cookie: 'hi', salonDefault: 'ne' }), 'bn');
  assert.equal(pickSiteLocale({ query: 'xx', cookie: 'hi', salonDefault: 'ne' }), 'hi');
  assert.equal(pickSiteLocale({ query: undefined, cookie: undefined, salonDefault: 'ne' }), 'ne');
  assert.equal(pickSiteLocale({ query: ['HI'], cookie: null, salonDefault: null }), 'hi');
  assert.equal(pickSiteLocale({}), 'en');
  assert.equal(toLocale('fr'), 'en');
  assert.deepEqual([...LOCALES], ['en', 'hi', 'ne', 'bn']);
});

test('dates use the language’s month and weekday names but Latin digits; times stay "5:15 PM"', () => {
  const tz = 'Asia/Kolkata';
  // English output is unchanged
  assert.equal(fmtDateShort('2026-10-28'), 'Wed, 28 Oct');
  assert.equal(fmtDateLong('2026-10-28'), 'Wednesday, 28 October');
  assert.equal(fmtDateTime('2026-10-28T11:45:00Z', tz), 'Wed, 28 Oct, 5:15 PM');
  assert.equal(relativeDay('2026-10-28', '2026-10-28'), 'Today');
  assert.deepEqual(dateParts('2026-10-28'), { wd: 'Wed', day: '28', mon: 'Oct' });
  for (const lang of ['hi', 'ne', 'bn']) {
    assert.match(intlLocale(lang), /-u-nu-latn$/);
    const long = fmtDateLong('2026-10-28', lang);
    assert.match(long, /28/, `${lang}: ${long}`);
    assert.ok(!/[०-९০-৯]/.test(long + fmtDateShort('2026-10-28', lang) + fmtDateYear('2026-10-28T06:00:00Z', tz, lang)), `${lang}: Latin digits`);
    assert.ok(!/Wednesday|October/.test(long), `${lang}: ${long} should not be English`);
    assert.equal(fmtTime('2026-10-28T11:45:00Z', tz), '5:15 PM');
  }
  assert.match(fmtDateLong('2026-10-28', 'hi'), /बुधवार/);
  assert.match(fmtDateLong('2026-10-28', 'bn'), /বুধবার/);
  assert.match(fmtDateLong('2026-10-28', 'ne'), /बुधबार/);
});

test('relative days, durations and countdowns are translated', () => {
  const t = createT('hi', hi);
  assert.equal(relDay(createT('en'), '2026-10-29', '2026-10-28'), 'Tomorrow');
  assert.equal(relDay(t, '2026-10-28', '2026-10-28'), t('time.today'));
  assert.equal(fmtDurationT(createT('en'), 90), '1 hr 30 min');
  assert.equal(fmtDurationT(createT('en'), 45), '45 min');
  assert.equal(countdownT(createT('en'), '2026-11-09', '2026-10-28'), 'In 12 days');
  assert.equal(relativeAgoT(createT('en'), '2026-10-01T06:00:00Z', '2026-10-28', 'Asia/Kolkata'), '3 weeks ago');
  assert.equal(relativeAgoT(createT('en'), null, '2026-10-28', 'Asia/Kolkata'), 'Never');
});

test('coverage report', () => {
  const keys = Object.keys(en) as MessageKey[];
  const lines = [`English keys: ${keys.length}`];
  for (const [lang, dict] of Object.entries(DICTS)) {
    const missing = keys.filter((k) => dict[k] === undefined);
    const pct = ((keys.length - missing.length) / keys.length) * 100;
    lines.push(`${lang}: ${keys.length - missing.length}/${keys.length} translated (${pct.toFixed(1)}%)` +
      (missing.length ? ` — missing: ${missing.slice(0, 40).join(', ')}${missing.length > 40 ? ` … and ${missing.length - 40} more` : ''}` : ''));
  }
  console.log(`\n# i18n coverage\n# ${lines.join('\n# ')}\n`);
});
