'use client';

import { FormEvent, useState } from 'react';
import { inviteMember } from './actions';

type Role = { id: string; name: string };

export default function InviteMemberForm({ roles }: { roles: Role[] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [warning, setWarning] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true); setError(''); setEmployeeId(''); setWarning('');
    try {
      const result = await inviteMember(new FormData(formElement));
      if (result.error || !result.employee_id) throw new Error(result.error ?? 'The invitation could not be sent.');
      setEmployeeId(result.employee_id);
      setWarning(result.warning ?? '');
      formElement.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The invitation could not be sent.');
    } finally { setBusy(false); }
  }

  return <>
    <form onSubmit={submit} className="workspace-form">
      <label>Full name<input name="full_name" required maxLength={160}/></label>
      <label>Email address<input name="email" type="email" required maxLength={254}/></label>
      <label>Initial role (optional)<select name="role_id" defaultValue=""><option value="">Invite without a role</option>{roles.map(role=><option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
      <button className="workspace-primary" type="submit" disabled={busy}>{busy ? 'Sending invitation…' : 'Send invitation and issue ID'}</button>
    </form>
    {error && <p className="workspace-message" role="alert">{error}</p>}
    {employeeId && <div className="workspace-message" role="status"><b>Employee ID:</b> <code className="registration-code">{employeeId}</code><p>Share this ID with the employee. They can use it to sign in after accepting the invitation.</p>{warning&&<p>{warning}</p>}</div>}
  </>;
}
