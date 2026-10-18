'use client';

import { FormEvent, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import PasswordInput from '@/components/auth/password-input';

type RegistrationTeam = { id: string; name: string; project_id: string; project_name: string; project_code: string };

export default function SignupForm() {
  const [teams, setTeams] = useState<RegistrationTeam[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [optionsError, setOptionsError] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    createClient().functions.invoke('employee-auth', { body: { action: 'registration_options' } })
      .then(({ data, error: invokeError }) => {
        if (!active) return;
        if (invokeError || !data?.teams) setOptionsError(data?.error ?? 'Available teams could not be loaded. You can still apply without choosing a team.');
        else setTeams(data.teams as RegistrationTeam[]);
        setLoadingOptions(false);
      })
      .catch(() => {
        if (active) {
          setOptionsError('Could not load available teams. Try again later.');
          setLoadingOptions(false);
        }
      });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setMessage(''); setBusy(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const selectedTeam = teams.find(team => team.id === String(form.get('team_id') ?? ''));
    try {
      if (String(form.get('password') ?? '') !== String(form.get('password_confirm') ?? '')) throw new Error('Passwords do not match.');
      const supabase = createClient();
      const { data, error: invokeError } = await supabase.functions.invoke('employee-auth', {
        body: {
          action: 'register',
          email: String(form.get('email') ?? ''),
          full_name: String(form.get('full_name') ?? ''),
          password: String(form.get('password') ?? ''),
          team_id: selectedTeam?.id ?? '',
          project_id: selectedTeam?.project_id ?? '',
        },
      });
      if (invokeError || !data?.registered) throw new Error(data?.error ?? 'Registration could not be submitted. Try again later.');
      setMessage(selectedTeam
        ? 'Application submitted. Your team lead and project manager must approve it. Your employee ID will be sent to this email after both approvals.'
        : 'Application submitted without a team. A team leader or project manager will assign a team and project before the approval steps. Your employee ID will be emailed after approval.');
      formElement.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Registration could not be submitted.');
    } finally { setBusy(false); }
  }

  return <form onSubmit={submit} className="auth-form">
    <label>Full name<input name="full_name" type="text" autoComplete="name" minLength={1} maxLength={160} required autoFocus /></label>
    <label>Work email<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
    <label>Team and project <span>(optional)</span><select name="team_id" disabled={loadingOptions} defaultValue="">
      <option value="">No team yet — assign one after registration</option>
      {teams.map(team => <option key={team.id} value={team.id}>{team.name} · {team.project_code} {team.project_name}</option>)}
    </select></label>
    {optionsError && <p className="auth-error" role="alert">{optionsError}</p>}
    {!loadingOptions && !optionsError && teams.length === 0 && <p className="auth-notice" role="status">No teams are currently available. You can apply without a team and a manager will assign one.</p>}
    <label>Password<PasswordInput name="password" autoComplete="new-password" minLength={10} maxLength={128} /><small>Use at least 10 characters.</small></label>
    <label>Confirm password<PasswordInput name="password_confirm" autoComplete="new-password" minLength={10} maxLength={128} /></label>
    {error && <p className="auth-error" role="alert">{error}</p>}
    {message && <p className="auth-success" role="status">{message}</p>}
    <button type="submit" disabled={busy}>{busy ? 'Submitting application…' : 'Submit for approval'}</button>
  </form>;
}
