// Phone numbers are stored as digits with country code ("919876543210", "97517123456"), which is also
// the format WhatsApp uses for wa_id and Supabase uses for phone auth (Supabase wants "+" in front when signing in).
// India is the default country. Bhutan and the other neighbours of Jaigaon are first-class; any other country
// works when typed with its code ("+44 7700 900123").

export interface PhoneCountry {
  /** Calling code, digits only ("975"). */
  code: string;
  name: string;
  /** Used in copy: "Enter a valid Bhutan mobile number". */
  adjective: string;
  /** Digits in a mobile number after the country code. */
  nationalLength: number;
  /** A mobile number after the country code (no trunk 0). */
  mobile: RegExp;
  /** How the national number is grouped for display. */
  groups: number[];
  /** Placeholder for the national number. */
  example: string;
  /** Numbers are dialled with a leading 0 inside the country (09876543210), so a 0 in front is dropped. */
  trunk0: boolean;
}

export const PHONE_COUNTRIES: PhoneCountry[] = [
  { code: '91', name: 'India', adjective: 'Indian', nationalLength: 10, mobile: /^[6-9]\d{9}$/, groups: [5, 5], example: '98765 43210', trunk0: true },
  // B-Mobile 16/17, TashiCell 77. Accept any 8 digits starting 1 or 7 so a new range doesn't lock clients out (the OTP proves the number).
  { code: '975', name: 'Bhutan', adjective: 'Bhutan', nationalLength: 8, mobile: /^[17]\d{7}$/, groups: [2, 2, 2, 2], example: '17 12 34 56', trunk0: false },
  { code: '977', name: 'Nepal', adjective: 'Nepal', nationalLength: 10, mobile: /^9[678]\d{8}$/, groups: [3, 7], example: '984 1234567', trunk0: true },
  { code: '880', name: 'Bangladesh', adjective: 'Bangladesh', nationalLength: 10, mobile: /^1[3-9]\d{8}$/, groups: [4, 6], example: '1712 345678', trunk0: true },
];

/** Value of the country select for "a number with any other country code". */
export const OTHER_COUNTRY = 'other';
export const OTHER_EXAMPLE = '+44 7700 900123';

/** Shortest and longest stored number (country code included). Matches the customers.phone check in the database. */
const MIN_DIGITS = 10;
const MAX_DIGITS = 15; // E.164

const digitsOf = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

export function phoneCountry(code: string | null | undefined): PhoneCountry | null {
  return PHONE_COUNTRIES.find((c) => c.code === code) ?? null;
}

// ITU calling codes: +1 and +7 are one digit, these are two, every other code is three.
const TWO_DIGIT_CODES = new Set('20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98'.split(' '));

/** The country calling code at the start of an international number ("97517123456" → "975"). */
export function callingCodeOf(digits: string): string {
  const d = digitsOf(digits);
  if (/^[17]/.test(d)) return d.slice(0, 1);
  if (TWO_DIGIT_CODES.has(d.slice(0, 2))) return d.slice(0, 2);
  return d.slice(0, 3);
}

function nationalMobile(country: PhoneCountry, national: string): string | null {
  let n = national;
  if (country.trunk0 && n.length === country.nationalLength + 1 && n.startsWith('0')) n = n.slice(1);
  return country.mobile.test(n) ? n : null;
}

/** Digits that already include the country code. Known countries must be a mobile number; others only a sane length. */
function international(d: string): string | null {
  if (d.length < MIN_DIGITS || d.length > MAX_DIGITS + 1 || d.startsWith('0')) return null; // +1: "+91 0 98765 43210"
  const code = callingCodeOf(d);
  const country = phoneCountry(code);
  if (country) {
    const n = nationalMobile(country, d.slice(code.length));
    return n ? code + n : null;
  }
  return d.length <= MAX_DIGITS ? d : null;
}

/**
 * Any way people write a mobile number → digits with country code, or null if it isn't a valid number.
 * "98765 43210", "098765 43210", "+91 98765 43210" → "919876543210"; "+975 17 12 34 56", "00975 17123456",
 * "97517123456" → "97517123456"; "+44 7700 900123" → "447700900123". With defaultCountry '975', "17 12 34 56" works too.
 */
export function normalizePhone(input: string, defaultCountry = '91'): string | null {
  const raw = (input || '').trim();
  const d = digitsOf(raw);
  if (!d) return null;
  if (raw.startsWith('+')) return international(d);
  if (d.startsWith('00')) return international(d.slice(2));
  const home = phoneCountry(defaultCountry);
  if (home) {
    const n = nationalMobile(home, d);
    if (n) return home.code + n;
    // Too short to carry a country code, or dialled with a 0: a mistyped local number ("5876543210" isn't an Indian mobile).
    if (d.length <= home.nationalLength || d.startsWith('0')) return null;
    // Longer: typed with the country code but no "+" ("97517123456"), which is also how WhatsApp and Supabase hand numbers over.
    return international(d);
  }
  return international(d) ?? international(defaultCountry + d.replace(/^0/, ''));
}

/**
 * A verified Supabase auth phone ("97517123456", no "+") → stored digits. It already carries the country code, so a
 * country is never guessed, and the OTP proved the number, so only the length is checked. claim_customer_profiles()
 * matches the same digits in SQL.
 */
export function phoneFromAuth(authPhone: string | null | undefined): string | null {
  const d = digitsOf(authPhone);
  return d.length >= MIN_DIGITS && d.length <= MAX_DIGITS && !d.startsWith('0') ? d : null;
}

/** Stored digits → the parts shown on screen. */
export function splitPhone(value: string | null | undefined): { code: string; national: string; country: PhoneCountry | null } | null {
  const d = digitsOf(value);
  if (!d) return null;
  const code = callingCodeOf(d);
  return { code, national: d.slice(code.length), country: phoneCountry(code) };
}

function group(national: string, sizes: number[]): string {
  const out: string[] = [];
  let i = 0;
  for (const n of sizes) { if (i < national.length) out.push(national.slice(i, i + n)); i += n; }
  if (i < national.length) out.push(national.slice(i));
  return out.join(' ');
}

/** "+91 98765 43210", "+975 17 12 34 56", "+977 984 1234567", "+880 1712 345678"; any other country "+44 7700900123". */
export function formatPhone(value: string | null | undefined): string {
  const p = splitPhone(value);
  if (!p) return '';
  if (!p.national) return `+${p.code}`;
  const sizes = p.country?.groups;
  const national = sizes && p.national.length === sizes.reduce((a, b) => a + b, 0) ? group(p.national, sizes) : p.national;
  return `+${p.code} ${national}`;
}

/** E.164 for Supabase phone auth: "+97517123456". */
export function toE164(digits: string): string {
  return '+' + digitsOf(digits);
}

/** What to tell someone whose number didn't normalise, in terms of the country they typed. */
export function invalidPhoneMessage(input: string, defaultCountry = '91'): string {
  const generic = `Enter a valid mobile number with its country code, like ${OTHER_EXAMPLE}.`;
  const raw = (input || '').trim();
  const d = digitsOf(raw);
  let country = phoneCountry(defaultCountry);
  if (raw.startsWith('+') || d.startsWith('00')) {
    country = phoneCountry(callingCodeOf(raw.startsWith('+') ? d : d.slice(2)));
    if (!country) return generic;
  } else if (country && d.length > country.nationalLength + 1) {
    const typed = phoneCountry(callingCodeOf(d));
    if (typed) country = typed;
  }
  if (!country) return generic;
  return `Enter a valid ${country.adjective} mobile number (${country.nationalLength} digits).`;
}

// ----- PhoneInput state: a country select + the number box -----

export interface PhoneDraft {
  /** A PHONE_COUNTRIES code, or OTHER_COUNTRY (the box then holds the whole number with "+"). */
  code: string;
  /** What's in the number box, as typed. */
  national: string;
}

/** Skip `count` digits at the start of `s`, then any separators. */
function afterDigits(s: string, count: number): string {
  let i = 0;
  let seen = 0;
  while (i < s.length && seen < count) { if (/\d/.test(s[i])) seen++; i++; }
  return s.slice(i).replace(/^[\s\-.()]+/, '');
}

/** A PhoneInput value ("+975 17 12 34 56", "98765 43210", "+44 7700 900123", "") → country + box text. */
export function readPhoneDraft(value: string | null | undefined, fallbackCode = '91'): PhoneDraft {
  const raw = (value ?? '').trim();
  if (!raw) return { code: fallbackCode, national: '' };
  const intl = raw.startsWith('+') ? raw.slice(1) : /^0[\s\-.]*0/.test(raw) ? afterDigits(raw, 2) : null;
  if (intl !== null) {
    const d = digitsOf(intl);
    const country = phoneCountry(callingCodeOf(d));
    if (country && d.length >= country.code.length) return { code: country.code, national: afterDigits(intl, country.code.length) };
    return { code: OTHER_COUNTRY, national: '+' + intl.trimStart() };
  }
  // No "+": a number for the fallback country, unless it's too long for it and starts with a known code ("97517123456").
  return phoneDraftFromTyping(raw, { code: fallbackCode, national: '' });
}

/** Country + box text → the PhoneInput value: "+975 17 12 34 56", or "" while the box is empty. */
export function writePhoneDraft(draft: PhoneDraft): string {
  const n = draft.national.trim();
  if (!/\d/.test(n)) return '';
  if (draft.code === OTHER_COUNTRY) return '+' + n.replace(/^\+/, '').replace(/^00/, '').trim();
  return `+${draft.code} ${n}`;
}

/**
 * The user typed or pasted `text` into the number box. Switches the country when the text carries one:
 * "+975 17123456" or "0097517123456" or "97517123456" (too long for the selected country) → Bhutan, "17123456".
 */
export function phoneDraftFromTyping(text: string, current: PhoneDraft): PhoneDraft {
  if (/^\s*(\+|00)/.test(text)) return readPhoneDraft(text, current.code);
  if (current.code === OTHER_COUNTRY) {
    const t = text.trim();
    return t ? readPhoneDraft('+' + t.replace(/^\+/, ''), OTHER_COUNTRY) : { code: OTHER_COUNTRY, national: '' };
  }
  const country = phoneCountry(current.code);
  const d = digitsOf(text);
  if (country && d.length > country.nationalLength && !d.startsWith('0')) {
    const full = international(d);
    const p = full ? splitPhone(full) : null;
    if (p?.country) return { code: p.code, national: group(p.national, p.country.groups) };
  }
  return { code: current.code, national: text };
}

/** The user picked another country in the select. */
export function phoneDraftWithCountry(code: string, current: PhoneDraft): PhoneDraft {
  if (code === current.code) return current;
  if (code === OTHER_COUNTRY) {
    const n = current.national.trim();
    return { code, national: n ? `+${current.code} ${n}` : '' };
  }
  if (current.code === OTHER_COUNTRY) return { code, national: '' };
  return { code, national: current.national };
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
