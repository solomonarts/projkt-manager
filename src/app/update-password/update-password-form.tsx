'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import PasswordInput from '@/components/auth/password-input';

export default function UpdatePasswordForm() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = fragment.get('access_token');
    const refreshToken = fragment.get('refresh_token');
    const recoveryError = fragment.get('error_description');

    if (recoveryError) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      setError('This recovery link is invalid or has expired. Request a new password reset link.');
      return;
    }
    if (!accessToken || !refreshToken || fragment.get('type') !== 'recovery') return;

    let active = true;
    const supabase = createClient();
    void supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error: sessionError }) => {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
        if (active && sessionError) setError('This recovery link is invalid or has expired. Request a new password reset link.');
      })
      .catch(() => {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
        if (active) setError('This recovery link is invalid or has expired. Request a new password reset link.');
      });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    if (password !== String(form.get('password_confirm') ?? '')) { setError('Passwords do not match.'); setBusy(false); return; }
    try {
      const supabase = createClient();
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw new Error('This reset link is invalid or has expired. Request a new one.');
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      await supabase.auth.signOut();
      router.replace('/login?password_updated=1'); router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Password could not be updated.'); setBusy(false);
    }
  }
  return <form onSubmit={submit} className="auth-form">
    <label>New password<PasswordInput name="password" autoComplete="new-password" minLength={10} maxLength={128} autoFocus /></label>
    <label>Confirm new password<PasswordInput name="password_confirm" autoComplete="new-password" minLength={10} maxLength={128} /></label>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button>
  </form>;
}
