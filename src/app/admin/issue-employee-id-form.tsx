'use client';

import { FormEvent, useState } from 'react';
import { issueEmployeeId } from './actions';

type Role = { id: string; name: string };

export default function IssueEmployeeIdForm({ roles }: { roles: Role[] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [issuedId, setIssuedId] = useState('');
  const [existingAccount, setExistingAccount] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true); setError(''); setIssuedId(''); setExistingAccount(false);
    try {
      const result = await issueEmployeeId(new FormData(formElement));
      if (result.error || !result.user_id) throw new Error(result.error ?? 'Could not issue an employee ID.');
      setIssuedId(result.user_id);
      setExistingAccount(Boolean(result.existing_account));
      formElement.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not issue an employee ID.');
    } finally { setBusy(false); }
  }

  async function copyId() {
    try { await navigator.clipboard.writeText(issuedId); }
    catch { setError('Clipboard access is unavailable. Select and copy the employee ID manually.'); }
  }

  return <>
    <form onSubmit={submit} className="workspace-form">
      <label>Employee full name<input name="full_name" required maxLength={160}/></label>
      <label>Employee email<input name="email" type="email" required maxLength={254}/></label>
      <label>Initial role (optional)<select name="role_id" defaultValue=""><option value="">Assign later</option>{roles.map(role=><option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
      <button className="workspace-primary" type="submit" disabled={busy}>{busy ? 'Generating ID…' : 'Generate employee ID'}</button>
    </form>
    {error && <p className="workspace-message" role="alert">{error}</p>}
    {issuedId && <div className="workspace-message" id="employee-registration-id" role="status">
      <b>Employee ID issued:</b> <code className="registration-code">{issuedId}</code>
      <p>{existingAccount ? 'This ID is already linked to the existing account and can be used to sign in.' : 'Share this ID with the employee. It can be used for one registration and is not shown again here.'}</p>
      <button className="workspace-small-action" type="button" onClick={copyId}>Copy ID</button>
    </div>}
  </>;
}
