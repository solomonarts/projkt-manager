import Link from 'next/link';
import { ArrowLeft, ArrowRight, CalendarDays, FolderKanban, Plus } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/authz';
import { createProject } from './actions';

export default async function ProjectsPage() {
  let projects: Array<{id:string;code:string;name:string;status:string;start_date:string|null;end_date:string|null;location:string|null;manager_id:string|null}> = [];
  let error = '';
  let canCreate = false;
  try {
    canCreate = await hasPermission('projects.create');
    const supabase = await createClient();
    const result = await supabase.from('projects').select('id,code,name,status,start_date,end_date,location,manager_id').order('updated_at',{ascending:false});
    projects = result.data ?? [];
    if (result.error) error = result.error.message;
  } catch { error = 'Sign in and configure Supabase to view organization projects.'; }
  return <div className="workspace-page">
    <header className="workspace-top"><Link href="/" className="workspace-back"><ArrowLeft size={16}/> Overview</Link><span>FIELDNOTE / PROJECTS</span></header>
    <main className="workspace-content"><div className="workspace-heading"><div><span className="workspace-kicker">DELIVERY WORKSPACE</span><h1>Projects</h1><p>Plan and track your organization’s project portfolio.</p></div>{canCreate&&<a className="workspace-primary" href="#new-project"><Plus size={16}/> New project</a>}</div>
      {error&&<div className="workspace-message" role="status">{error}</div>}
      <section className="workspace-panel"><div className="workspace-panel-head"><div><h2>Project portfolio</h2><p>{projects.length} projects visible to your account</p></div><FolderKanban size={20}/></div>
      {projects.length ? <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>PROJECT</th><th>STATUS</th><th>LOCATION</th><th>DATES</th><th>REFERENCE</th></tr></thead><tbody>{projects.map(p=><tr key={p.id}><td><b>{p.name}</b></td><td><span className={`workspace-status ${p.status}`}>{p.status.replace('_',' ')}</span></td><td>{p.location||'—'}</td><td><CalendarDays size={13}/>{p.start_date||'—'} – {p.end_date||'—'}</td><td>{p.code}</td></tr>)}</tbody></table></div>:!error&&<div className="workspace-empty"><FolderKanban size={24}/><b>No projects are visible yet</b><span>Projects appear here when you have access through your role or project membership.</span></div>}</section>
      {canCreate&&<section className="workspace-panel" id="new-project"><div className="workspace-panel-head"><div><h2>Create a project</h2><p>Set up the project record; add objectives, outcomes, outputs and activities as the plan develops.</p></div><Plus size={20}/></div><form action={createProject} className="workspace-form"><label>Project name<input name="name" required maxLength={160}/></label><label>Reference code<input name="code" required maxLength={32} placeholder="e.g. EDU-026"/></label><label>Start date<input name="start_date" type="date"/></label><label>End date<input name="end_date" type="date"/></label><label>Location<input name="location" maxLength={160}/></label><label>Funding source<input name="funding_source" maxLength={160}/></label><label className="wide-field">Description<textarea name="description" rows={3}/></label><button className="workspace-primary" type="submit">Create project <ArrowRight size={15}/></button></form></section>}
      <Link href="/accounting" className="workspace-accounting-link">Open Accounting &amp; Reporting <ArrowRight size={15}/></Link>
    </main>
  </div>;
}
