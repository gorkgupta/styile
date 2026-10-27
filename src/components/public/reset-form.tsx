'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Notice, TextField } from '@/components/ui/ui';
import { createClient } from '@/lib/supabase/client';
import { AuthLayout } from './auth-forms';

type Mode = 'request' | 'sent' | 'checking' | 'update';

/**
 * Forgot password. Step 1 emails a Supabase reset link that returns to /reset?code=…;
 * step 2 exchanges the code for a session and lets the person choose a new password.
 */
export function ResetPasswordForm({ code }: { code?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(code ? 'checking' : 'request');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!code) return;
    // @supabase/ssr uses the PKCE flow: the reset email links back to /reset?code=…. The browser client may already
    // have exchanged it on load (detectSessionInUrl), so check for a session before exchanging.
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      if (cancelled) return;
      if (s.session) { setMode('update'); return; }
      const { error: err } = await supabase.auth.exchangeCodeForSession(code);
      if (cancelled) return;
      if (err) { setError('This reset link has expired or was already used. Ask for a new one below.'); setMode('request'); }
      else setMode('update');
    })();
    return () => { cancelled = true; };
  }, [code]);

  async function request(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error: err } = await createClient().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset` });
    setBusy(false);
    if (err) setError(err.message || 'Could not send the email. Check the address and try again.');
    else setMode('sent');
  }

  async function update(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setError('Use at least 8 characters for the password.'); return; }
    setBusy(true); setError(null);
    const { error: err } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (err) { setError(err.message || 'Could not change the password. Try again.'); return; }
    router.replace('/app');
  }

  return (
    <AuthLayout aside={
      <div className="auth-aside-inner">
        <h2>Locked out?</h2>
        <p>We’ll email you a link to set a new password. Your salon’s bookings and bills are not affected.</p>
      </div>
    }>
      {mode === 'update' ? (
        <>
          <div className="stack-sm"><h1>Choose a new password</h1><p className="muted">You’ll be logged in straight after.</p></div>
          <form onSubmit={update} className="stack">
            <TextField label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} hint="At least 8 characters." autoFocus required />
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" variant="primary" size="lg" block loading={busy}>Save password</Button>
          </form>
        </>
      ) : mode === 'checking' ? (
        <div className="row muted"><span className="spinner" aria-hidden /> Checking your reset link…</div>
      ) : mode === 'sent' ? (
        <div className="stack">
          <h1>Check your email</h1>
          <Notice tone="success">If {email} has a Styile account, a reset link is on its way. Open it on this device.</Notice>
          <Button variant="ghost" onClick={() => setMode('request')}>Use a different email</Button>
        </div>
      ) : (
        <>
          <div className="stack-sm"><h1>Reset your password</h1><p className="muted">Enter the email you log in with.</p></div>
          <form onSubmit={request} className="stack">
            <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" variant="primary" size="lg" block loading={busy}>Email me a reset link</Button>
          </form>
        </>
      )}
      <p className="small muted"><Link href="/login">Back to log in</Link></p>
    </AuthLayout>
  );
}
