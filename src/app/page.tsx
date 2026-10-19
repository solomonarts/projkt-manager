'use client';

import { useEffect, useState } from 'react';
import {
  Activity, ArrowRight, Bell, BriefcaseBusiness, Check, ChevronRight,
  Clock3, Command, FileText, Globe2, MapPin, Plus, Search, ShieldCheck, ListTodo,
  WalletCards, X,
} from 'lucide-react';

type Project = { name: string; code: string; location: string; status: string; progress: number|null; color: string; lead: string; due: string|null };
type InboxNotification = { id: string; kind: string; title: string; body: string | null; entity_type: string | null; entity_id: string | null; read_at: string | null; created_at: string };
type DashboardData = { profile:{name:string;role:string};permissions:Record<string,boolean>;metrics:{activeProjects:number|null;completedProjects:number|null;completedTasks:number|null;reportsToReview:number|null;indicatorProgress:number|null;activeRisks:number|null;evaluations:number|null;overdueTasks:number|null;upcomingTasks:number|null;postedJournalEntries:number|null};pendingActions:Array<{key:string;label:string;detail:string;count:number;href:string}>;projects:Array<Project&{id:string}>;tasks:Array<{id:string;title:string;project:string;projectCode:string;dueDate:string|null;status:string;progress:number}>;recent:Array<{id:string;title:string;project:string;when:string;href:string;tone:string}>;errors:string[] };

export default function Home() {
  const [query, setQuery] = useState('');
  const [dashboard, setDashboard] = useState<DashboardData|null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState('');
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<InboxNotification[]>([]);
  const [notificationError, setNotificationError] = useState('');
  const visibleProjects = (dashboard?.projects??[]).filter(p => `${p.name} ${p.code} ${p.location}`.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    let active = true;
    fetch('/api/dashboard').then(async response => { const result=await response.json();if(!response.ok)throw new Error(result.error||'Dashboard data could not be loaded.');return result as DashboardData; })
      .then(result=>{if(active){setDashboard(result);setDashboardError(result.errors?.[0]??'');setDashboardLoading(false);}})
      .catch(error=>{if(active){setDashboardError(error instanceof Error?error.message:'Dashboard data could not be loaded.');setDashboardLoading(false);}});
    return ()=>{active=false;};
  },[]);

  useEffect(() => {
    if (!showNotifications) return;
    let active = true;
    fetch('/api/notifications').then(async response => {
      if (!response.ok) throw new Error('Notifications could not be loaded.');
      return response.json();
    }).then(result => { if (active) { setNotifications(result.notifications ?? []); setNotificationError(''); } })
      .catch(() => { if (active) setNotificationError('Notifications could not be loaded.'); });
    return () => { active = false; };
  }, [showNotifications]);

  const markNotificationRead = async (id: string) => {
    const response = await fetch('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    if (response.ok) setNotifications(current => current.map(item => item.id === id ? { ...item, read_at: new Date().toISOString() } : item));
  };
  const notificationHref = (item: InboxNotification) => item.entity_type === 'task' ? '/tasks' : item.entity_type === 'report' ? '/reports' : item.entity_type === 'risk' ? '/meal#risks' : item.entity_type === 'transaction' ? '/accounting' : item.kind === 'follow_up_assigned' ? '/meal#actions' : '/';

  return <div className="app-shell">
    <main className="main-area">
      <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14} /><b>Overview</b></div><div className="top-actions"><button className="search-trigger" onClick={() => document.getElementById('project-search')?.focus()}><Search size={15} /><span>Search projects...</span><kbd><Command size={11} /> K</kbd></button><span className="top-divider" /><div className="popover-wrap"><button className="icon-button bell-button" aria-label={`Notifications${notifications.some(n => !n.read_at) ? `, ${notifications.filter(n => !n.read_at).length} unread` : ''}`} aria-expanded={showNotifications} aria-controls="notifications-popover" onClick={() => setShowNotifications(!showNotifications)}><Bell size={18} />{notifications.some(n => !n.read_at) && <i />}</button>{showNotifications && <div className="popover notification-pop" id="notifications-popover" role="region" aria-label="Notifications"><div className="pop-head"><b>Notifications</b><button onClick={() => setShowNotifications(false)} aria-label="Close notifications"><X size={15} /></button></div>{notificationError&&<p role="status">{notificationError}</p>}{notifications.length ? <><ul className="notification-list">{notifications.map(item=><li key={item.id} className={item.read_at?'read':''}><a href={notificationHref(item)} onClick={async event=>{event.preventDefault();await markNotificationRead(item.id);window.location.assign(notificationHref(item));}}><span className="notification-dot" aria-hidden="true" /><span><b>{item.title}</b><small>{item.body||item.kind.replaceAll('_',' ')} · {new Date(item.created_at).toLocaleString()}</small></span></a></li>)}</ul>{notifications.some(n=>!n.read_at)&&<button className="notification-mark-all" onClick={async()=>{const response=await fetch('/api/notifications',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({all:true})});if(response.ok)setNotifications(items=>items.map(item=>({...item,read_at:new Date().toISOString()})));}}>Mark all as read</button>}</> : !notificationError&&<p role="status">No notifications yet.</p>}</div>}</div><span className="avatar avatar-top" aria-label={dashboard?.profile.name||'Signed in user'}>{dashboard?.profile.name.slice(0,2).toUpperCase()||'—'}</span></div></header>

      <div className="content-wrap">
        <div className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line" /> {new Date().toLocaleDateString('en-UG',{timeZone:'Africa/Kampala',weekday:'long',month:'long',day:'numeric',year:'numeric'}).toUpperCase()}</div><h1>Welcome, {dashboard?.profile.name||'there'} <span className="wave" aria-hidden="true">✳</span></h1><p className="welcome-sub">A view of the work your account is authorized to access.</p></div><div className="welcome-actions">{dashboard?.permissions.projectsCreate&&<a className="button button-primary" href="/projects#new-project"><Plus size={16} /> New project</a>}{dashboard?.permissions.accounting&&<a className="button button-secondary" href="/accounting"><WalletCards size={15}/> Accounting workspace</a>}</div></div>

        {dashboardLoading&&<div className="workspace-message" role="status" aria-live="polite">Loading your authorized dashboard data…</div>}
        {dashboardError&&<div className="workspace-message" role="alert">{dashboardError}<button className="notification-mark-all" onClick={()=>window.location.reload()}>Retry loading dashboard</button></div>}

        <section className="metrics-grid" aria-label="Organization metrics">
          <Metric title="Active projects" value={dashboardLoading||!dashboard?'—':metricText(dashboard.metrics.activeProjects)} detail="In your authorized portfolio" icon={<BriefcaseBusiness size={17}/>} iconTone="lavender"/>
          <Metric title="Completed projects" value={dashboardLoading||!dashboard?'—':metricText(dashboard.metrics.completedProjects)} detail="Marked complete" icon={<Check size={17}/>} iconTone="mint"/>
          <Metric title="Overdue tasks" value={dashboardLoading||!dashboard?'—':metricText(dashboard.metrics.overdueTasks)} detail={`${dashboard?metricText(dashboard.metrics.upcomingTasks):'—'} due in the next 7 days`} icon={<Clock3 size={17}/>} iconTone="peach"/>
          <Metric title="Reports awaiting review" value={dashboardLoading||!dashboard?'—':metricText(dashboard.metrics.reportsToReview)} detail="Visible submitted reports" icon={<FileText size={17}/>} iconTone="blue"/>
          {dashboard?.permissions.accounting&&<Metric title="Posted journal entries" value={dashboardLoading?'—':metricText(dashboard.metrics.postedJournalEntries)} detail="Authorized financial activity · open workspace" icon={<WalletCards size={17}/>} iconTone="mint"/>}
        </section>

        <section className="panel dashboard-pending-panel" aria-labelledby="pending-actions-heading">
          <div className="panel-head"><div><h2 id="pending-actions-heading">Pending actions</h2><p>Work that needs a decision or follow-up in your authorized areas</p></div><Bell size={18}/></div>
          {dashboardLoading ? <div className="workspace-empty compact" role="status">Checking for pending actions…</div>
            : dashboard?.pendingActions.length ? <ul className="dashboard-pending-list">{dashboard.pendingActions.map(action=><li key={action.key}><a href={action.href}><span className="dashboard-pending-icon">{action.key==='tasks'?<ListTodo size={17}/>:action.key==='accounting'?<WalletCards size={17}/>:action.key==='reports'?<FileText size={17}/>:<ShieldCheck size={17}/>}</span><span><b>{action.label}</b><small>{action.detail}</small></span><strong>{action.count}</strong><ArrowRight size={15}/></a></li>)}</ul>
            : <div className="workspace-empty compact"><b>No pending actions</b><span>New reviews and approvals will appear here.</span></div>}
        </section>

        <section className="overview-grid">
          <div className="panel progress-panel"><div className="panel-head"><div><h2>Project performance</h2><p>Progress calculated from visible task records</p></div><a className="text-link" href="/projects">All projects <ArrowRight size={14}/></a></div>
            {dashboardLoading?<div className="workspace-empty" role="status"><b>Loading project performance…</b></div>:dashboard?.projects.some(project=>project.progress!==null)?<ul className="portfolio-bars" aria-label="Project progress summary">{dashboard.projects.filter(project=>project.progress!==null).slice(0,6).map(project=><li key={project.id}><span title={project.name}>{project.name}</span><div className="progress-track" role="img" aria-label={`${project.progress}% task progress`}><i style={{width:`${project.progress}%`}}/></div><b>{project.progress}%</b></li>)}</ul>:<div className="workspace-empty"><b>No project progress data</b><span>Progress appears when accessible projects have tasks with recorded completion values.</span></div>}
          </div>
          <div className="panel outcome-panel"><div className="panel-head"><div><h2>Portfolio status</h2><p>Accessible project records</p></div></div><div className="outcome-legend dashboard-status-list"><div><span className="outcome-name"><i className="outcome-dot purple-dot"/>Active</span><b>{dashboard?.metrics.activeProjects??'—'}</b></div><div><span className="outcome-name"><i className="outcome-dot amber-dot"/>Completed</span><b>{dashboard?.metrics.completedProjects??'—'}</b></div><div><span className="outcome-name"><i className="outcome-dot gray-dot"/>Overdue tasks</span><b>{dashboard?.metrics.overdueTasks??'—'}</b></div><div><span className="outcome-name"><i className="outcome-dot blue-dot"/>Risks and issues</span><b>{dashboard?.metrics.activeRisks??'—'}</b></div></div><a className="text-link" href="/meal#risks">Review MEAL and risks <ArrowRight size={14}/></a></div>
        </section>

        <section className="lower-grid">
          <div className="panel projects-panel"><div className="panel-head"><div><h2>Recent projects</h2><p>Projects visible to your account</p></div><a className="text-link" href="/projects">All projects <ArrowRight size={14} /></a></div><div className="project-controls"><label className="project-search"><Search size={15} /><input id="project-search" placeholder="Search projects..." value={query} onChange={e => setQuery(e.target.value)} aria-label="Search projects" /></label></div><div className="project-table-wrap"><table className="project-table"><thead><tr><th>PROJECT</th><th>STATUS</th><th>PROGRESS</th><th>PROJECT LEAD</th><th>END DATE</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visibleProjects.map((project) => <tr key={project.id}><td><div className="project-name-cell"><span className={`project-mark ${project.color}`}><Globe2 size={16} /></span><span><a href="/projects" className="project-row-link"><b>{project.name}</b></a><small>{project.code}<span>·</span><MapPin size={11} />{project.location}</small></span></div></td><td><Status status={project.status} /></td><td><div className="progress-cell"><div className="progress-track"><i className={project.color} style={{ width: `${project.progress??0}%` }} /></div><span>{project.progress===null?'—':`${project.progress}%`}</span></div></td><td><span className={`avatar avatar-small ${project.color}`} aria-label={`Project manager: ${project.lead}`}>{project.lead}</span></td><td className="date-cell">{formatDate(project.due)}</td><td></td></tr>)}</tbody></table>{visibleProjects.length === 0 && <div className="empty-state" role={dashboardLoading?'status':undefined}>{dashboardLoading?'Loading projects…':query?`No projects match “${query}”.`:'No projects are available to your account.'}</div>}</div><a className="mobile-all" href="/projects">View all projects <ArrowRight size={14} /></a></div>

          <div className="right-stack"><div className="panel tasks-panel"><div className="panel-head"><div><h2>My tasks</h2><p>{dashboardLoading||!dashboard?'—':dashboard.tasks.length} assigned tasks visible</p></div></div><div className="task-list">{dashboard?.tasks.map(task=><a className="task-row" key={task.id} href="/tasks"><span className={`task-check ${task.status==='blocked'?'task-flag':''}`}><Clock3 size={14}/></span><span className="task-copy"><b>{task.title}</b><small><span className="task-project-dot lavender"/>{task.project}</small></span><span className="task-date">{formatDate(task.dueDate)}</span></a>)}{!dashboardLoading&&!dashboard?.tasks.length&&<div className="empty-state">No assigned tasks are visible.</div>}</div><a className="task-footer" href="/tasks">View all tasks <ArrowRight size={14} /></a></div>

          <div className="panel activity-panel"><div className="panel-head"><div><h2>Recent activity</h2><p>Recent visible task and report updates</p></div></div><div className="activity-list">{dashboard?.recent.map(item=><a className="activity-row" key={`${item.href}-${item.id}`} href={item.href}><span className={`activity-icon ${item.tone}`}><Activity size={14}/></span><span className="activity-copy"><span>{item.title}</span><small>{item.project} · {item.when}</small></span></a>)}{!dashboardLoading&&!dashboard?.recent.length&&<div className="empty-state">No recent activity is available.</div>}</div><a className="activity-footer" href="/reports">Open reports <ArrowRight size={14} /></a></div></div>
        </section>
        <footer className="page-footer"><span>VAI Project Manager workspace</span><span><ShieldCheck size={13} /> Your data is protected</span></footer>
      </div>
    </main>
  </div>;
}

function Metric({ title, value, detail, icon, iconTone }: { title:string;value:string;detail:string;icon:React.ReactNode;iconTone:string }) {
  return <article className="panel metric-card"><div className="metric-top"><span className={`metric-icon ${iconTone}`}>{icon}</span></div><div className="metric-title">{title}</div><div className="metric-bottom"><div><div className="metric-value">{value}</div><div className="metric-change">{detail}</div></div></div></article>;
}

function Status({ status }: { status: string }) {
  const klass = ['Active','Completed'].includes(status) ? 'on-track' : ['Planning','On hold'].includes(status) ? 'at-risk' : 'delayed';
  return <span className={`status-pill ${klass}`}><i />{status}</span>;
}

function formatDate(value:string|null){return value?new Date(`${value}T00:00:00Z`).toLocaleDateString('en-UG',{timeZone:'Africa/Kampala',month:'short',day:'numeric',year:'numeric'}):'No deadline';}
function metricText(value:number|null){return value===null?'—':String(value);}
