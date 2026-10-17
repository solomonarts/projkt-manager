'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { BookOpen, ChevronLeft, ChevronRight, Clock3, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

const guides: Record<string, { title: string; steps: { title: string; body: string }[] }> = {
  overview: { title: 'Overview dashboard', steps: [
    { title: 'Your organization at a glance', body: 'Review authorized project, task, report, MEAL and finance metrics. Empty or unavailable values reflect the records your account can access.' },
    { title: 'Track project performance', body: 'Use the project performance view and recent projects list to spot delivery progress, deadlines and work that needs attention.' },
    { title: 'Open follow-up work', body: 'Use My tasks, Pending actions, notifications and the sidebar to open the relevant workspace and continue the work.' },
  ] },
  projects: { title: 'Projects', steps: [
    { title: 'Review the portfolio', body: 'Browse projects available to your role and check status, dates, managers and delivery progress.' },
    { title: 'Plan project delivery', body: 'Authorized users can create projects and organize objectives, outputs, activities and milestones.' },
    { title: 'Follow linked work', body: 'Use project details to connect activities, tasks, risks, indicators, reports and supporting documents.' },
  ] },
  tasks: { title: 'Tasks & activities', steps: [
    { title: 'Find assigned work', body: 'Review tasks assigned to you or teams you are authorized to manage, including deadlines, status and priority.' },
    { title: 'Update progress', body: 'Record progress, blockers, checklist items and evidence so managers and assignees share the current task state.' },
    { title: 'Submit for review', body: 'When work is ready, send it for review. Reviewers can approve it or return it with requested changes.' },
  ] },
  teams: { title: 'Teams & members', steps: [
    { title: 'Browse teams', body: 'View teams and departments visible to your account, including their leads and project links.' },
    { title: 'Manage membership', body: 'Authorized managers can maintain team members and leadership. Team membership does not itself grant application permissions.' },
    { title: 'Open team workplans', body: 'Use workplans to review templates, planned activities, approvals and scheduled collective reporting.' },
  ] },
  workplans: { title: 'Team workplans', steps: [
    { title: 'Use the team template', body: 'Choose the active template for your team and prepare activities with expected deliverables and dates.' },
    { title: 'Submit for approval', body: 'Submit structured activities or an optional PDF workplan for the required team lead and project manager review.' },
    { title: 'Track schedules', body: 'Review workplan approvals, reporting dates and timeline change requests in this workspace.' },
  ] },
  reports: { title: 'Reports', steps: [
    { title: 'Prepare a report', body: 'Choose the report type and period, then link it to the relevant team, project, activity or task.' },
    { title: 'Add evidence and context', body: 'Record achievements, challenges, lessons and recommendations, and attach supporting evidence where available.' },
    { title: 'Follow review status', body: 'Drafts can be completed later. Submitted reports move through review, return or approval according to your permissions.' },
  ] },
  meal: { title: 'MEAL & evaluation', steps: [
    { title: 'Monitor indicators', body: 'Review project indicators and measurements available to your role, including their evidence and progress.' },
    { title: 'Coordinate evaluation work', body: 'Manage evaluation exercises, team contributions, feedback and follow-up actions where authorized.' },
    { title: 'Manage risks and learning', body: 'Use the risk register and recommendations to record issues, mitigation, findings and accountability actions.' },
  ] },
  accounting: { title: 'Accounting & reporting', steps: [
    { title: 'Use the finance workspace', body: 'This is a dedicated accounting area with its own navigation, records and permission checks.' },
    { title: 'Review finance records', body: 'Use the workspace sections to review budgets, transactions, journals and reports available to your role.' },
    { title: 'Follow approval status', body: 'Check each record’s status and audit information. Only authorized finance roles can create or approve financial records.' },
  ] },
  documents: { title: 'Documents', steps: [
    { title: 'Find linked files', body: 'Browse documents linked to projects, tasks, reports, evaluations or financial records that your account can access.' },
    { title: 'Upload supporting evidence', body: 'Authorized users can add files and link them to relevant work so evidence stays with its record.' },
    { title: 'Use secure downloads', body: 'Protected files are served through access checks and short-lived download links.' },
  ] },
  admin: { title: 'Administration & permissions', steps: [
    { title: 'Manage access', body: 'Review roles, permissions and user assignments. Application access is managed separately from team membership.' },
    { title: 'Manage organization setup', body: 'Authorized administrators can maintain departments, teams, employee IDs and invitations.' },
    { title: 'Review sensitive controls', body: 'Financial limits and confidential access are managed here when your role has the required permissions.' },
  ] },
  todos: { title: 'Personal tasks', steps: [
    { title: 'Review your list', body: 'Use this page to review personal follow-up items available to your signed-in account.' },
    { title: 'Keep work current', body: 'Update items as you make progress and connect important work to the relevant project workspace.' },
    { title: 'Return to the dashboard', body: 'Use the main navigation to return to project, task and reporting workspaces.' },
  ] },
};

function guideForPath(pathname: string) {
  if (pathname.startsWith('/accounting')) return 'accounting';
  if (pathname.startsWith('/projects')) return 'projects';
  if (pathname.startsWith('/tasks')) return 'tasks';
  if (pathname.startsWith('/teams/workplans')) return 'workplans';
  if (pathname.startsWith('/teams')) return 'teams';
  if (pathname.startsWith('/reports')) return 'reports';
  if (pathname.startsWith('/meal')) return 'meal';
  if (pathname.startsWith('/documents')) return 'documents';
  if (pathname.startsWith('/admin')) return 'admin';
  if (pathname.startsWith('/todos')) return 'todos';
  if (pathname === '/') return 'overview';
  return null;
}

export default function AppExperience() {
  const pathname = usePathname() || '/';
  const moduleId = guideForPath(pathname);
  const [userId, setUserId] = useState<string | null>(null);
  const [idleLogout, setIdleLogout] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideStep, setGuideStep] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const guide = useMemo(() => moduleId ? guides[moduleId] : null, [moduleId]);

  useEffect(() => {
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
    });
    void supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!userId || !moduleId || !guide) {
      setGuideOpen(false);
      return;
    }
    const key = `fieldnote:guide:${moduleId}:v1`;
    if (window.localStorage.getItem(key) !== 'seen') {
      setGuideStep(0);
      setGuideOpen(true);
    }
  }, [userId, moduleId, guide]);

  useEffect(() => {
    if (!guideOpen) return;
    const dialog = document.querySelector<HTMLElement>('.app-guide-dialog');
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.querySelector<HTMLElement>('button')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (moduleId) window.localStorage.setItem(`fieldnote:guide:${moduleId}:v1`, 'seen');
        setGuideOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [guideOpen, moduleId]);

  useEffect(() => {
    if (!userId) {
      setIdleLogout(false);
      return;
    }
    const key = `fieldnote:idle-logout:${userId}`;
    setIdleLogout(window.localStorage.getItem(key) === 'enabled');
  }, [userId]);

  useEffect(() => {
    if (!userId || !idleLogout) return;
    const lastActivityKey = `fieldnote:last-activity:${userId}`;
    let timeout: number | undefined;
    let signingOut = false;
    const scheduleExpiry = () => {
      if (timeout) window.clearTimeout(timeout);
      const lastActivity = Number(window.localStorage.getItem(lastActivityKey) || 0);
      if (!lastActivity) {
        window.localStorage.setItem(lastActivityKey, String(Date.now()));
        timeout = window.setTimeout(expireSession, 60 * 60 * 1000);
        return;
      }
      const remaining = 60 * 60 * 1000 - (Date.now() - lastActivity);
      timeout = window.setTimeout(expireSession, Math.max(0, remaining));
    };
    const resetTimer = () => {
      window.localStorage.setItem(lastActivityKey, String(Date.now()));
      scheduleExpiry();
    };
    function expireSession() {
      if (signingOut) return;
      const lastActivity = Number(window.localStorage.getItem(lastActivityKey) || 0);
      const remaining = 60 * 60 * 1000 - (Date.now() - lastActivity);
      if (remaining > 0) {
        timeout = window.setTimeout(expireSession, remaining);
        return;
      }
      signingOut = true;
      void createClient().auth.signOut().finally(() => {
        window.localStorage.removeItem(lastActivityKey);
        window.location.assign('/login?reason=idle');
      });
    }
    const activityEvents: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart', 'scroll'];
    activityEvents.forEach(eventName => window.addEventListener(eventName, resetTimer, { passive: true }));
    const onStorage = (event: StorageEvent) => {
      if (event.key === lastActivityKey) {
        if (event.newValue === null) {
          if (timeout) window.clearTimeout(timeout);
        } else scheduleExpiry();
      }
    };
    window.addEventListener('storage', onStorage);
    resetTimer();
    return () => {
      if (timeout) window.clearTimeout(timeout);
      activityEvents.forEach(eventName => window.removeEventListener(eventName, resetTimer));
      window.removeEventListener('storage', onStorage);
    };
  }, [userId, idleLogout]);

  const closeGuide = () => {
    if (moduleId) window.localStorage.setItem(`fieldnote:guide:${moduleId}:v1`, 'seen');
    setGuideOpen(false);
  };
  const toggleIdleLogout = (enabled: boolean) => {
    if (userId) {
      const key = `fieldnote:idle-logout:${userId}`;
      if (enabled) window.localStorage.setItem(key, 'enabled');
      else {
        window.localStorage.removeItem(key);
        window.localStorage.removeItem(`fieldnote:last-activity:${userId}`);
      }
    }
    setIdleLogout(enabled);
  };

  if (!userId || !moduleId || !guide) return null;
  const step = guide.steps[guideStep];

  return <>
    <div className="app-experience-tools">
      <button type="button" className="app-guide-trigger" onClick={() => { setGuideStep(0); setGuideOpen(true); }}><BookOpen size={16}/> Guide</button>
      <button type="button" className="app-guide-trigger" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(value => !value)}><Clock3 size={16}/> Session</button>
      {settingsOpen && <div className="app-session-popover" role="region" aria-label="Session preferences">
        <label><input type="checkbox" checked={idleLogout} onChange={event => toggleIdleLogout(event.target.checked)}/> Sign out after 1 hour of inactivity</label>
        <p>Optional. This preference is saved for this account in this browser.</p>
      </div>}
    </div>
    {guideOpen && <div className="app-guide-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeGuide(); }}>
      <section className="app-guide-dialog" role="dialog" aria-modal="true" aria-labelledby="app-guide-title" aria-describedby="app-guide-body">
        <button type="button" className="app-guide-close" onClick={closeGuide} aria-label="Close guide"><X size={18}/></button>
        <p className="app-guide-kicker">FIELDNOTE · {moduleId.replaceAll('-', ' ').toUpperCase()} · STEP {guideStep + 1} OF {guide.steps.length}</p>
        <h2 id="app-guide-title">{guide.title}</h2>
        <div className="app-guide-progress" aria-label={`Step ${guideStep + 1} of ${guide.steps.length}`}>
          {guide.steps.map((item, index) => <i key={item.title} className={index <= guideStep ? 'current' : ''}/>) }
        </div>
        <h3>{step.title}</h3>
        <p id="app-guide-body">{step.body}</p>
        <div className="app-guide-actions">
          <button type="button" className="app-guide-skip" onClick={closeGuide}>Skip guide</button>
          <div>
            {guideStep > 0 && <button type="button" className="app-guide-secondary" onClick={() => setGuideStep(value => value - 1)}><ChevronLeft size={15}/> Back</button>}
            {guideStep < guide.steps.length - 1
              ? <button type="button" className="app-guide-next" onClick={() => setGuideStep(value => value + 1)}>Next <ChevronRight size={15}/></button>
              : <button type="button" className="app-guide-next" onClick={closeGuide}>Finish</button>}
          </div>
        </div>
      </section>
    </div>}
  </>;
}
