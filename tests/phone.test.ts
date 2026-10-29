// Phone numbers: India by default, Bhutan (+975) and the other neighbours of Jaigaon first-class, any country with its code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePhone, formatPhone, splitPhone, phoneFromAuth, toE164, invalidPhoneMessage, callingCodeOf, phoneCountry,
  readPhoneDraft, writePhoneDraft, phoneDraftFromTyping, phoneDraftWithCountry, OTHER_COUNTRY, PHONE_COUNTRIES,
} from '../src/lib/phone';

test('Indian numbers keep working as before', () => {
  for (const s of ['98765 43210', '+91-98765-43210', '09876543210', '919876543210', '+91 98765 43210', '0091 98765 43210', '+91 (0) 98765 43210']) {
    assert.equal(normalizePhone(s), '919876543210', s);
  }
  assert.equal(normalizePhone('6000000000'), '916000000000');
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone('5876543210'), null); // not an Indian mobile
  assert.equal(normalizePhone('+91 5876543210'), null);
  assert.equal(normalizePhone('+91 98765 4321'), null); // 9 digits
  assert.equal(normalizePhone('+91 98765 432100'), null); // 11 digits
});

test('Bhutan (+975) numbers in every common form', () => {
  for (const s of ['+975 17 12 34 56', '+97517123456', '00975 17123456', '0097517123456', '97517123456', '975-17-123456']) {
    assert.equal(normalizePhone(s), '97517123456', s);
  }
  assert.equal(normalizePhone('+975 77 12 34 56'), '97577123456'); // TashiCell
  assert.equal(normalizePhone('+975 16 12 34 56'), '97516123456'); // B-Mobile
  assert.equal(normalizePhone('17 12 34 56', '975'), '97517123456'); // national, with Bhutan as the default
  assert.equal(normalizePhone('17123456'), null); // 8 digits alone aren't an Indian number
  assert.equal(normalizePhone('+975 1712345'), null); // 7 digits
  assert.equal(normalizePhone('+975 171234567'), null); // 9 digits
  assert.equal(normalizePhone('+975 27 12 34 56'), null); // not a mobile range
  assert.equal(normalizePhone('+975 02 123456'), null);
});

test('Nepal, Bangladesh and other countries', () => {
  assert.equal(normalizePhone('+977 984 1234567'), '9779841234567');
  assert.equal(normalizePhone('9779841234567'), '9779841234567');
  assert.equal(normalizePhone('+977 123 4567890'), null);
  assert.equal(normalizePhone('+880 1712 345678'), '8801712345678');
  assert.equal(normalizePhone('+880 01712 345678'), '8801712345678'); // trunk 0 after the code
  assert.equal(normalizePhone('+880 1212 345678'), null);
  assert.equal(normalizePhone('+44 7700 900123'), '447700900123');
  assert.equal(normalizePhone('+1 (415) 555-2671'), '14155552671');
  assert.equal(normalizePhone('14155552671'), '14155552671'); // too long for India, so it carries a code
  assert.equal(normalizePhone('+971 50 123 4567'), '971501234567');
  assert.equal(normalizePhone('+44 7700'), null); // too short
  assert.equal(normalizePhone('+1234567890123456'), null); // longer than E.164
  assert.equal(normalizePhone('+0 12345 67890'), null); // no country code starts with 0
  for (const d of ['919876543210', '97517123456', '9779841234567', '8801712345678', '447700900123', '14155552671']) {
    assert.match(d, /^[0-9]{10,15}$/, 'fits the customers.phone check');
  }
});

test('calling codes and country list', () => {
  assert.equal(callingCodeOf('919876543210'), '91');
  assert.equal(callingCodeOf('97517123456'), '975');
  assert.equal(callingCodeOf('14155552671'), '1');
  assert.equal(callingCodeOf('447700900123'), '44');
  assert.equal(callingCodeOf('8801712345678'), '880');
  assert.deepEqual(PHONE_COUNTRIES.map((c) => `+${c.code} ${c.name}`), ['+91 India', '+975 Bhutan', '+977 Nepal', '+880 Bangladesh']);
  assert.equal(phoneCountry('975')?.nationalLength, 8);
  assert.equal(phoneCountry('44'), null);
});

test('split and format for display', () => {
  assert.deepEqual({ ...splitPhone('97517123456'), country: splitPhone('97517123456')?.country?.name }, { code: '975', national: '17123456', country: 'Bhutan' });
  assert.equal(splitPhone('447700900123')?.country, null);
  assert.equal(splitPhone(''), null);
  assert.equal(formatPhone('919876543210'), '+91 98765 43210');
  assert.equal(formatPhone('97517123456'), '+975 17 12 34 56');
  assert.equal(formatPhone('9779841234567'), '+977 984 1234567');
  assert.equal(formatPhone('8801712345678'), '+880 1712 345678');
  assert.equal(formatPhone('447700900123'), '+44 7700900123');
  assert.equal(formatPhone('14155552671'), '+1 4155552671');
  assert.equal(formatPhone(null), '');
  assert.equal(formatPhone('+975 17123456'), '+975 17 12 34 56'); // tolerates formatted input
  // Display → normalise round-trips
  for (const d of ['919876543210', '97517123456', '9779841234567', '8801712345678', '447700900123']) assert.equal(normalizePhone(formatPhone(d)), d);
});

test('auth phones and E.164', () => {
  assert.equal(phoneFromAuth('97517123456'), '97517123456'); // Supabase stores digits without "+"
  assert.equal(phoneFromAuth('+97517123456'), '97517123456');
  assert.equal(phoneFromAuth('919876543210'), '919876543210');
  assert.equal(phoneFromAuth('6771234567'), '6771234567'); // never mistaken for an Indian national number
  assert.equal(phoneFromAuth(''), null);
  assert.equal(phoneFromAuth(null), null);
  assert.equal(toE164('97517123456'), '+97517123456');
});

test('error messages name the country that was typed', () => {
  assert.equal(invalidPhoneMessage('98765'), 'Enter a valid Indian mobile number (10 digits).');
  assert.equal(invalidPhoneMessage('+975 17 12 34'), 'Enter a valid Bhutan mobile number (8 digits).');
  assert.equal(invalidPhoneMessage('00975 1712'), 'Enter a valid Bhutan mobile number (8 digits).');
  assert.equal(invalidPhoneMessage('+977 12'), 'Enter a valid Nepal mobile number (10 digits).');
  assert.equal(invalidPhoneMessage('+44 77'), 'Enter a valid mobile number with its country code, like +44 7700 900123.');
  assert.equal(invalidPhoneMessage('17 12 34', '975'), 'Enter a valid Bhutan mobile number (8 digits).');
});

test('PhoneInput state: reading values', () => {
  assert.deepEqual(readPhoneDraft(''), { code: '91', national: '' });
  assert.deepEqual(readPhoneDraft('', '975'), { code: '975', national: '' });
  assert.deepEqual(readPhoneDraft('98765 43210'), { code: '91', national: '98765 43210' });
  assert.deepEqual(readPhoneDraft('+975 17 12 34 56'), { code: '975', national: '17 12 34 56' });
  assert.deepEqual(readPhoneDraft('+97517123456'), { code: '975', national: '17123456' });
  assert.deepEqual(readPhoneDraft(formatPhone('919876543210')), { code: '91', national: '98765 43210' });
  assert.deepEqual(readPhoneDraft('0097517123456'), { code: '975', national: '17123456' });
  assert.deepEqual(readPhoneDraft('97517123456'), { code: '975', national: '17 12 34 56' }); // pasted without "+"
  assert.deepEqual(readPhoneDraft('+44 7700 900123'), { code: OTHER_COUNTRY, national: '+44 7700 900123' });
  assert.deepEqual(readPhoneDraft('+'), { code: OTHER_COUNTRY, national: '+' });
});

test('PhoneInput state: writing values', () => {
  assert.equal(writePhoneDraft({ code: '91', national: '98765 43210' }), '+91 98765 43210');
  assert.equal(writePhoneDraft({ code: '975', national: '17 12 34 56' }), '+975 17 12 34 56');
  assert.equal(writePhoneDraft({ code: '975', national: '' }), '');
  assert.equal(writePhoneDraft({ code: OTHER_COUNTRY, national: '+44 7700 900123' }), '+44 7700 900123');
  assert.equal(writePhoneDraft({ code: OTHER_COUNTRY, national: '+' }), '');
  // What the input hands to server actions always normalises
  assert.equal(normalizePhone(writePhoneDraft({ code: '975', national: '17 12 34 56' })), '97517123456');
  assert.equal(normalizePhone(writePhoneDraft({ code: '91', national: '098765 43210' })), '919876543210');
  assert.equal(normalizePhone(writePhoneDraft({ code: OTHER_COUNTRY, national: '+44 7700 900123' })), '447700900123');
});

test('PhoneInput state: typing and pasting switch the country', () => {
  const india = { code: '91', national: '' };
  assert.deepEqual(phoneDraftFromTyping('98765', india), { code: '91', national: '98765' });
  assert.deepEqual(phoneDraftFromTyping('+975 17 12 34 56', india), { code: '975', national: '17 12 34 56' });
  assert.deepEqual(phoneDraftFromTyping('0097517123456', india), { code: '975', national: '17123456' });
  assert.deepEqual(phoneDraftFromTyping('97517123456', india), { code: '975', national: '17 12 34 56' });
  assert.deepEqual(phoneDraftFromTyping('919876543210', india), { code: '91', national: '98765 43210' });
  assert.deepEqual(phoneDraftFromTyping('09876543210', india), { code: '91', national: '09876543210' }); // trunk 0 stays as typed
  assert.deepEqual(phoneDraftFromTyping('+', india), { code: OTHER_COUNTRY, national: '+' });
  assert.deepEqual(phoneDraftFromTyping('+9', india), { code: OTHER_COUNTRY, national: '+9' });
  assert.deepEqual(phoneDraftFromTyping('+975', india), { code: '975', national: '' });
  assert.deepEqual(phoneDraftFromTyping('+44 7700', india), { code: OTHER_COUNTRY, national: '+44 7700' });
  const bhutan = { code: '975', national: '' };
  assert.deepEqual(phoneDraftFromTyping('17123456', bhutan), { code: '975', national: '17123456' });
  assert.deepEqual(phoneDraftFromTyping('+91 98765 43210', bhutan), { code: '91', national: '98765 43210' });
  assert.deepEqual(phoneDraftFromTyping('919876543210', bhutan), { code: '91', national: '98765 43210' });
  const other = { code: OTHER_COUNTRY, national: '' };
  assert.deepEqual(phoneDraftFromTyping('4', other), { code: OTHER_COUNTRY, national: '+4' });
  assert.deepEqual(phoneDraftFromTyping('+975 17', other), { code: '975', national: '17' });
  assert.deepEqual(phoneDraftFromTyping('', other), { code: OTHER_COUNTRY, national: '' });
});

test('PhoneInput state: picking a country', () => {
  assert.deepEqual(phoneDraftWithCountry('975', { code: '91', national: '17 12 34 56' }), { code: '975', national: '17 12 34 56' });
  assert.deepEqual(phoneDraftWithCountry(OTHER_COUNTRY, { code: '91', national: '98765' }), { code: OTHER_COUNTRY, national: '+91 98765' });
  assert.deepEqual(phoneDraftWithCountry(OTHER_COUNTRY, { code: '91', national: '' }), { code: OTHER_COUNTRY, national: '' });
  assert.deepEqual(phoneDraftWithCountry('975', { code: OTHER_COUNTRY, national: '+44 7700' }), { code: '975', national: '' });
});
