'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import PasswordInput from '@/components/auth/password-input';

export default function SignupForm() {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setMessage(''); setBusy(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      if (String(form.get('password') ?? '') !== String(form.get('password_confirm') ?? '')) throw new Error('Passwords do not match.');
      const supabase = createClient();
      const { data, error: invokeError } = await supabase.functions.invoke('employee-auth', {
        body: { action: 'register', user_id: String(form.get('user_id') ?? ''), password: String(form.get('password') ?? '') },
      });
      if (invokeError || !data?.registered) throw new Error(data?.error ?? 'Registration could not be completed. Check the ID or contact your administrator.');
      if (!data.session) {
        setMessage('Your account was created. Sign in with your employee ID and password.');
        formElement.reset();
        return;
      }
      const { error: sessionError } = await supabase.auth.setSession(data.session);
      if (sessionError) throw sessionError;
      router.replace('/'); router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Registration could not be completed.');
    } finally { setBusy(false); }
  }

  return <form onSubmit={submit} className="auth-form">
    <label>Employee ID<input name="user_id" type="text" autoComplete="username" autoCapitalize="characters" minLength={7} maxLength={7} pattern="[A-HJ-NP-Z2-9]{7}" required autoFocus /></label>
    <label>Password<PasswordInput name="password" autoComplete="new-password" minLength={10} maxLength={128} /><small>Use at least 10 characters.</small></label>
    <label>Confirm password<PasswordInput name="password_confirm" autoComplete="new-password" minLength={10} maxLength={128} /></label>
    {error && <p className="auth-error" role="alert">{error}</p>}{message && <p className="auth-success" role="status">{message}</p>}
    <button type="submit" disabled={busy}>{busy ? 'Registering…' : 'Create account'}</button>
  </form>;
}
