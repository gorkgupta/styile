'use client';
// Mobile number field: country code select (+91 India by default, +975 Bhutan, +977 Nepal, +880 Bangladesh, or any
// other code) and the number. Pasting "+975 17 12 34 56" or "0097517123456" switches the country by itself.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Field } from './ui';
import { Icon } from './icons';
import {
  OTHER_COUNTRY, OTHER_EXAMPLE, PHONE_COUNTRIES, normalizePhone, phoneCountry, phoneDraftFromTyping, phoneDraftWithCountry,
  readPhoneDraft, writePhoneDraft, type PhoneDraft,
} from '@/lib/phone';

export interface PhoneInputProps {
  label?: ReactNode;
  /** "+975 17 12 34 56", stored digits with a "+" ("+919876543210"), a bare Indian number, or "" — server actions normalise any of these. */
  value?: string;
  defaultValue?: string;
  /** `value` is "+<code> <number as typed>" ("" while empty); `digits` is the normalised number, or null while it isn't valid. */
  onChange?: (value: string, digits: string | null) => void;
  /** Adds a hidden form field with this name carrying "+<digits>" (or what was typed, so the server can say what's wrong). */
  name?: string;
  id?: string;
  hint?: ReactNode;
  error?: string | null;
  autoFocus?: boolean;
  required?: boolean;
  defaultCountry?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
}

export function PhoneInput({ label = 'Mobile number', value, defaultValue, onChange, name, id, hint, error, autoFocus, required, defaultCountry = '91', onKeyDown }: PhoneInputProps) {
  const auto = useId();
  const fid = id ?? auto;
  const [draft, setDraft] = useState<PhoneDraft>(() => readPhoneDraft(value ?? defaultValue ?? '', defaultCountry));
  // The parent's value round-trips through readPhoneDraft only when it changes from outside (form reset, prefill).
  const emitted = useRef(value ?? defaultValue ?? '');
  useEffect(() => {
    if (value === undefined || value === emitted.current) return;
    emitted.current = value;
    setDraft(readPhoneDraft(value, defaultCountry));
  }, [value, defaultCountry]);

  const current = writePhoneDraft(draft);
  const digits = normalizePhone(current);

  function update(next: PhoneDraft) {
    setDraft(next);
    const v = writePhoneDraft(next);
    emitted.current = v;
    onChange?.(v, normalizePhone(v));
  }

  const country = phoneCountry(draft.code);
  const other = draft.code === OTHER_COUNTRY;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={fid}>
      <div className="phone-input">
        <span className="phone-cc">
          <span aria-hidden>{other ? '+…' : `+${draft.code}`}</span>
          <Icon name="chevronDown" size={14} />
          <select aria-label="Country code" value={draft.code} onChange={(e) => update(phoneDraftWithCountry(e.target.value, draft))}>
            {PHONE_COUNTRIES.map((c) => <option key={c.code} value={c.code}>+{c.code} {c.name}</option>)}
            <option value={OTHER_COUNTRY}>Other country</option>
          </select>
        </span>
        <input id={fid} className="input num" type="tel" inputMode="tel" autoComplete="tel" autoFocus={autoFocus} required={required}
          placeholder={other ? OTHER_EXAMPLE : country?.example} value={draft.national} aria-invalid={!!error || undefined}
          onChange={(e) => update(phoneDraftFromTyping(e.target.value, draft))} onKeyDown={onKeyDown} />
      </div>
      {name && <input type="hidden" name={name} value={digits ? '+' + digits : current} />}
    </Field>
  );
}
