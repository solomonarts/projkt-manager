'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import PasswordInput from '@/components/auth/password-input';

export default function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [administratorEmail, setAdministratorEmail] = useState(false);
  const [idleNotice, setIdleNotice] = useState(false);

  useEffect(() => {
    setIdleNotice(new URLSearchParams(window.location.search).get('reason') === 'idle');
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = new FormData(event.currentTarget);
      const supabase = createClient();
      const { data: result, error: signInError } = await supabase.functions.invoke('employee-auth', {
        body: { action: 'login', user_id: String(data.get('user_id') ?? ''), password: String(data.get('password') ?? '') },
      });
      if (signInError || !result?.session) throw new Error('Employee ID or password is incorrect.');
      const { error: sessionError } = await supabase.auth.setSession(result.session);
      if (sessionError) throw sessionError;
      router.replace('/');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign in failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-shell">
    <section className="auth-card" aria-labelledby="login-title">
      <a className="auth-brand" href="/" aria-label="VAI Project Manager home"><span className="auth-brand-mark">VAI</span><span className="auth-brand-name">Project Manager</span></a>
      <p className="auth-kicker">VAI PROJECT MANAGER · ORGANIZATION WORKSPACE</p>
      <h1 id="login-title">Sign in</h1>
      <p className="auth-intro">Employees sign in with the 7-character ID issued by their administrator.</p>
      {idleNotice && <p className="auth-notice" role="status">You were signed out after an hour without activity. Sign in to continue.</p>}
      <form onSubmit={submit} className="auth-form">
        <label>{administratorEmail ? 'Administrator email' : 'Employee ID'}<input name="user_id" type={administratorEmail ? 'email' : 'text'} autoComplete="username" autoCapitalize={administratorEmail ? undefined : 'characters'} minLength={administratorEmail ? undefined : 7} maxLength={administratorEmail ? 254 : 7} pattern={administratorEmail ? undefined : '[A-HJ-NP-Z2-9]{7}'} required autoFocus /></label>
        <label>Password<PasswordInput name="password" autoComplete="current-password" /></label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Continue securely'}</button>
      </form>
      <nav className="auth-links" aria-label="Account options"><a href="/reset-password">Forgot password?</a><a href="/signup">Apply for an employee account</a></nav>
      <button type="button" className="auth-mode-toggle" onClick={() => { setAdministratorEmail(!administratorEmail); setError(''); }}>{administratorEmail ? 'Use employee ID' : 'Administrator first-time setup'}</button>
    </section>
  </main>;
}
