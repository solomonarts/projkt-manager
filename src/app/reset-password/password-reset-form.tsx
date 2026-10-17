'use client';

import { FormEvent, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function PasswordResetForm() {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      const supabase = createClient();
      const { error: invokeError } = await supabase.functions.invoke('employee-auth', {
        body: { action: 'reset_password', user_id: String(form.get('user_id') ?? '') },
      });
      if (invokeError) throw invokeError;
      setMessage('If the employee ID matches an account, password reset instructions will be sent to its registered email.');
    } catch (cause) {
      const context = cause && typeof cause === 'object' && 'context' in cause
        ? (cause as { context?: unknown }).context
        : null;
      if (context instanceof Response) {
        const payload = await context.clone().json().catch(() => null) as { error?: unknown } | null;
        if (typeof payload?.error === 'string') {
          setError(payload.error);
        } else {
          setError('Password reset could not reach the recovery service. Check that the employee-auth function is deployed.');
        }
      } else {
        setError('Password reset could not reach the recovery service. Check your connection and try again.');
      }
    } finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="auth-form">
    <label>Employee ID<input name="user_id" type="text" autoComplete="username" autoCapitalize="characters" minLength={7} maxLength={7} pattern="[A-HJ-NP-Z2-9]{7}" required autoFocus /></label>
    {error && <p className="auth-error" role="alert">{error}</p>}{message && <p className="auth-success" role="status">{message}</p>}
    <button type="submit" disabled={busy}>{busy ? 'Requesting…' : 'Send reset instructions'}</button>
  </form>;
}
