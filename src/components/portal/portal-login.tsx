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
import { PhoneInput } from '@/components/ui/phone-input';
import { PortalHeader } from './portal';
import { useT } from '@/lib/i18n/react';

/** Client sign-in with a WhatsApp code. After verifying, links this number's client records across salons. */
export function PortalLogin({ next, base, salonName }: { next?: string; base: string; salonName: string }) {
  const otp = usePhoneOtp();
  const t = useT();
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
    if (!r.ok) { setFinishing(false); setError(t.err(r.error)); return; }
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
            <h1>{t('pt.loginTitle')}</h1>
            <p className="muted">{t('pt.loginBody')}</p>
          </div>
          <form onSubmit={submit} className="stack" style={{ width: '100%' }}>
            {otp.stage === 'phone' ? (
              <PhoneInput id="pt-phone" label={t('common.mobileNumber')} value={otp.phoneInput} onChange={otp.setPhoneInput} error={otp.error} autoFocus />
            ) : (
              <div className="field">
                <label htmlFor="pt-code">{t('otp.codeSentTo', { phone: formatPhone(otp.digits) })}</label>
                <input id="pt-code" className="input bk-code num" inputMode="numeric" autoComplete="one-time-code" placeholder="••••••" maxLength={6}
                  value={otp.code} onChange={(e) => otp.setCode(e.target.value)} autoFocus aria-invalid={!!otp.error || undefined} />
                {otp.error ? <span className="error-text" role="alert">{otp.error}</span> : <span className="hint">{t('otp.checkWa')}</span>}
                <div className="row-wrap" style={{ gap: 4, justifyContent: 'center' }}>
                  <Button size="sm" variant="ghost" onClick={otp.changeNumber}>{t('otp.changeNumber')}</Button>
                  <Button size="sm" variant="ghost" disabled={otp.resendIn > 0} onClick={() => otp.send()}>{otp.resendIn > 0 ? t('otp.resendIn', { s: otp.resendIn }) : t('otp.resend')}</Button>
                </div>
              </div>
            )}
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" variant="primary" size="lg" block loading={otp.busy || finishing}
              icon={otp.stage === 'phone' ? 'whatsapp' : undefined}
              disabled={otp.stage === 'phone' ? !otp.valid : otp.code.length !== 6}>
              {otp.stage === 'phone' ? t('otp.send') : t('otp.verify')}
            </Button>
          </form>
        </div>
        <p className="small muted" style={{ textAlign: 'center' }}>{t('pt.workHere')} <Link href="/login">{t('pt.staffLogin')}</Link></p>
      </main>
    </div>
  );
}
