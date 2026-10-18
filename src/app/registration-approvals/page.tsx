'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Clock3, Mail, UserRoundCheck, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type Relation = { name: string; code?: string } | Array<{ name: string; code?: string }> | null;
type RegistrationRequest = {
  id: string;
  email: string;
  full_name: string;
  status: string;
  team_decision: string | null;
  team_review_comment: string | null;
  project_decision: string | null;
  project_review_comment: string | null;
  employee_id: string | null;
  created_at: string;
  teams: Relation;
  projects: Relation;
};

const relation = (value: Relation) => Array.isArray(value) ? value[0] : value;
const statusText: Record<string, string> = {
  pending_team_approval: 'Awaiting team lead',
  pending_project_approval: 'Awaiting project manager',
  approved_pending_id: 'Approved · ID not sent',
  approved_pending_email: 'Approved · email needs retry',
};

export default function RegistrationApprovalsPage() {
  const [requests, setRequests] = useState<RegistrationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');
  const [comments, setComments] = useState<Record<string, string>>({});

  const loadRequests = useCallback(async () => {
    setLoading(true);
    const { data, error: invokeError } = await createClient().functions.invoke('employee-auth', { body: { action: 'list_registration_requests' } });
    if (invokeError || !data?.requests) {
      setError(data?.error ?? 'Registration requests could not be loaded.');
      setRequests([]);
    } else {
      setError('');
      setRequests(data.requests as RegistrationRequest[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void loadRequests(); }, [loadRequests]);

  async function decide(item: RegistrationRequest, stage: 'team' | 'project', decision: 'approve' | 'reject') {
    setBusyId(item.id); setError(''); setNotice('');
    const { data, error: invokeError } = await createClient().functions.invoke('employee-auth', {
      body: { action: 'review_registration', request_id: item.id, stage, decision, comment: comments[item.id] ?? '' },
    });
    if (invokeError) setError(data?.error ?? 'The review could not be saved.');
    else if (data?.error && !data?.approved) setError(data.error);
    else setNotice(data?.error ?? data?.message ?? 'Review saved.');
    await loadRequests();
    setBusyId('');
  }

  async function sendId(item: RegistrationRequest) {
    setBusyId(item.id); setError(''); setNotice('');
    const { data, error: invokeError } = await createClient().functions.invoke('employee-auth', {
      body: { action: 'issue_approved_employee_id', request_id: item.id },
    });
    if (invokeError || data?.error) setError(data?.error ?? 'The employee ID email could not be sent.');
    else setNotice(data?.message ?? 'Employee ID sent.');
    await loadRequests();
    setBusyId('');
  }

  return <div className="workspace-page"><header className="workspace-top"><span>FIELDNOTE / REGISTRATION APPROVALS</span></header>
    <main className="workspace-content registration-approval-page">
      <div className="workspace-heading"><div><span className="workspace-kicker">EMPLOYEE ONBOARDING</span><h1>Registration approvals</h1><p>Applications require approval from the team lead and the selected project manager. Employee IDs are created and emailed after both approvals.</p></div><UserRoundCheck size={22}/></div>
      {error && <div className="workspace-message" role="alert">{error}</div>}
      {notice && <div className="workspace-message registration-notice" role="status">{notice}</div>}
      <section className="registration-request-list" aria-label="Registration requests" aria-busy={loading}>
        {loading ? <div className="workspace-empty" role="status"><Clock3 size={21}/><b>Loading registration requests…</b></div>
          : requests.length ? requests.map(item => {
            const team = relation(item.teams);
            const project = relation(item.projects);
            const pendingTeam = item.status === 'pending_team_approval';
            const pendingProject = item.status === 'pending_project_approval';
            const pendingEmail = ['approved_pending_id', 'approved_pending_email'].includes(item.status);
            return <article className="workspace-panel registration-request" key={item.id}>
              <div className="registration-request-head"><div><h2>{item.full_name}</h2><p>{item.email}</p></div><span className={`workspace-status ${item.status.includes('pending') ? 'open' : 'approved'}`}>{statusText[item.status] ?? item.status}</span></div>
              <dl className="registration-facts"><div><dt>Team</dt><dd>{team?.name ?? 'Team'}</dd></div><div><dt>Project</dt><dd>{project ? `${project.code ? `${project.code} · ` : ''}${project.name}` : 'Project'}</dd></div><div><dt>Applied</dt><dd>{new Date(item.created_at).toLocaleDateString('en-UG', { timeZone: 'Africa/Kampala', year: 'numeric', month: 'short', day: 'numeric' })}</dd></div></dl>
              {(item.team_review_comment || item.project_review_comment) && <div className="registration-review-history">{item.team_review_comment && <p><b>Team review:</b> {item.team_review_comment}</p>}{item.project_review_comment && <p><b>Project review:</b> {item.project_review_comment}</p>}</div>}
              {(pendingTeam || pendingProject) && <div className="registration-review-controls">
                <label>Review note<textarea value={comments[item.id] ?? ''} onChange={event => setComments(current => ({ ...current, [item.id]: event.target.value }))} rows={2} maxLength={800} placeholder="Optional approval note; explain a rejection." /></label>
                <div><button className="workspace-primary" disabled={busyId === item.id} onClick={() => void decide(item, pendingTeam ? 'team' : 'project', 'approve')}><Check size={15}/> Approve</button><button className="registration-reject" disabled={busyId === item.id} onClick={() => void decide(item, pendingTeam ? 'team' : 'project', 'reject')}><X size={15}/> Reject</button></div>
              </div>}
              {pendingEmail && <div className="registration-review-controls"><p>Both approvals are complete. {item.employee_id ? `Employee ID ${item.employee_id} is ready for delivery.` : 'Create the employee ID and send it to the applicant.'}</p><button className="workspace-primary" disabled={busyId === item.id} onClick={() => void sendId(item)}><Mail size={15}/>{busyId === item.id ? 'Sending…' : 'Create / resend employee ID email'}</button></div>}
            </article>;
          }) : <div className="workspace-empty"><UserRoundCheck size={23}/><b>No applications to review</b><span>New applications for your teams or projects will appear here.</span></div>}
      </section>
    </main>
  </div>;
}
