'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Notice } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { claimMyProfiles } from '@/actions/portal';
import { formatPhone } from '@/lib/phone';
import { safeNextPath } from '@/lib/safe-next';
import { usePhoneOtp } from '@/components/public/phone-otp';
import { PortalHeader } from './portal';

/** Client sign-in with a WhatsApp code. After verifying, links this number's client records across salons. */
export function PortalLogin({ next, base, salonName }: { next?: string; base: string; salonName: string }) {
  const otp = usePhoneOtp();
  const router = useRouter();
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (otp.stage === 'phone') { await otp.send(); return; }
    if (!(await otp.verify())) return;
    setFinishing(true);
    const r = await claimMyProfiles();
    if (!r.ok) { setFinishing(false); setError(r.error); return; }
    router.replace(safeNextPath(next) ?? `${base}/me`);
    router.refresh();
  }

  return (
    <div className="pt">
      <PortalHeader base={base} salonName={salonName} />
      <main className="pt-wrap pt-login">
        <div className="pt-login-card">
          <div className="pt-login-icon"><Icon name="whatsapp" size={26} /></div>
          <div className="stack-sm" style={{ textAlign: 'center' }}>
            <h1>See your bookings</h1>
            <p className="muted">Use the mobile number you book with. We’ll send a 6-digit code on WhatsApp.</p>
          </div>
          <form onSubmit={submit} className="stack" style={{ width: '100%' }}>
            {otp.stage === 'phone' ? (
              <div className="field">
                <label htmlFor="pt-phone">Mobile number</label>
                <div className="prefix-input">
                  <span>+91</span>
                  <input id="pt-phone" className="input" inputMode="numeric" autoComplete="tel-national" placeholder="98765 43210" maxLength={14}
                    value={otp.phoneInput} onChange={(e) => otp.setPhoneInput(e.target.value)} autoFocus aria-invalid={!!otp.error || undefined} />
                </div>
                {otp.error && <span className="error-text" role="alert">{otp.error}</span>}
              </div>
            ) : (
              <div className="field">
                <label htmlFor="pt-code">Code sent to {formatPhone(otp.digits)}</label>
                <input id="pt-code" className="input bk-code num" inputMode="numeric" autoComplete="one-time-code" placeholder="••••••" maxLength={6}
                  value={otp.code} onChange={(e) => otp.setCode(e.target.value)} autoFocus aria-invalid={!!otp.error || undefined} />
                {otp.error ? <span className="error-text" role="alert">{otp.error}</span> : <span className="hint">Check WhatsApp for a message from Styile.</span>}
                <div className="row-wrap" style={{ gap: 4, justifyContent: 'center' }}>
                  <Button size="sm" variant="ghost" onClick={otp.changeNumber}>Change number</Button>
                  <Button size="sm" variant="ghost" disabled={otp.resendIn > 0} onClick={() => otp.send()}>{otp.resendIn > 0 ? `Resend in ${otp.resendIn}s` : 'Resend code'}</Button>
                </div>
              </div>
            )}
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" variant="primary" size="lg" block loading={otp.busy || finishing}
              icon={otp.stage === 'phone' ? 'whatsapp' : undefined}
              disabled={otp.stage === 'phone' ? !otp.valid : otp.code.length !== 6}>
              {otp.stage === 'phone' ? 'Send code on WhatsApp' : 'Verify and continue'}
            </Button>
          </form>
        </div>
        <p className="small muted" style={{ textAlign: 'center' }}>Work at a salon? <Link href="/login">Staff log in</Link></p>
      </main>
    </div>
  );
}
