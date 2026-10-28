'use client';
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { invalidPhoneCountry, normalizePhone, toE164 } from '@/lib/phone';
import { useT } from '@/lib/i18n/react';
import type { Translator } from '@/lib/i18n/core';

/** "Enter a valid Indian mobile number (10 digits)." in the page's language. */
export function phoneError(t: Translator, input: string): string {
  const c = invalidPhoneCountry(input);
  if (!c) return t('phone.invalidAny');
  return t('phone.invalid', { adj: t(`phone.adj.${c.code as '91' | '975' | '977' | '880'}`), n: c.nationalLength });
}

// Phone sign-in for clients: Supabase phone OTP. The project's SMS hook (api/auth/sms-hook) delivers the
// code on WhatsApp from the platform number, so the UI says "WhatsApp".

export type OtpStage = 'phone' | 'code';

export function usePhoneOtp() {
  const t = useT();
  const [phoneInput, setPhoneInput] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<OtpStage>('phone');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  // phoneInput is a PhoneInput value ("+975 17 12 34 56"); any country works, Supabase gets E.164.
  const digits = normalizePhone(phoneInput);
  const valid = !!digits;

  function startCountdown() {
    setResendIn(30);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => setResendIn((s) => {
      if (s <= 1 && timer.current) { clearInterval(timer.current); timer.current = null; }
      return Math.max(0, s - 1);
    }), 1000);
  }

  async function send(): Promise<boolean> {
    if (!valid || !digits) { setError(phoneError(t, phoneInput)); return false; }
    setBusy(true); setError(null);
    const { error: err } = await createClient().auth.signInWithOtp({ phone: toE164(digits) });
    setBusy(false);
    if (err) {
      setError(/rate|seconds/i.test(err.message ?? '') ? t('otp.wait') : t('otp.sendFailed'));
      return false;
    }
    setStage('code'); setCode(''); startCountdown();
    return true;
  }

  async function verify(): Promise<boolean> {
    const token = code.replace(/\D/g, '');
    if (token.length !== 6 || !digits) { setError(t('otp.enterCode')); return false; }
    setBusy(true); setError(null);
    const { error: err } = await createClient().auth.verifyOtp({ phone: toE164(digits), token, type: 'sms' });
    setBusy(false);
    if (err) { setError(/expired/i.test(err.message ?? '') ? t('otp.expired') : t('otp.wrongCode')); return false; }
    return true;
  }

  function changeNumber() { setStage('phone'); setCode(''); setError(null); }

  return { phoneInput, setPhoneInput: (v: string) => { setPhoneInput(v); setError(null); }, code, setCode: (v: string) => setCode(v.replace(/\D/g, '').slice(0, 6)), stage, busy, error, setError, resendIn, valid, digits, send, verify, changeNumber };
}

export type PhoneOtp = ReturnType<typeof usePhoneOtp>;
