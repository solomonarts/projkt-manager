import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type ProjectRow = { id:string; code:string; name:string; location:string|null; status:string; end_date:string|null; manager_id:string|null };
type ProjectRelation = {name:string;code:string}|Array<{name:string;code:string}>|null;
type TaskRow = { id:string; title:string; status:string; progress:number|null; due_date:string|null; updated_at:string; project_id:string; projects:ProjectRelation };
type ReportRow = { id:string; title:string; status:string; created_at:string; project_id:string|null };
const permissionKeys = {
  projects:'projects.view', projectsCreate:'projects.create', tasks:'tasks.view', teams:'teams.view',
  reports:'reports.view', reportsCreate:'reports.create', meal:'evaluations.view', indicators:'indicators.view',
  risks:'projects.view', accounting:'accounting.view', documents:'documents.view', documentsCreate:'documents.create',
  administration:'system.manage', dashboard:'dashboard.view', reportReview:'reports.review',
};

export async function GET() {
  try { return await loadDashboard(); }
  catch { return NextResponse.json({error:'Dashboard data is temporarily unavailable. Check Supabase configuration and migrations.'},{status:503}); }
}

async function loadDashboard() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error:'Sign in to load your organization dashboard.' }, { status:401 });

  const entries = await Promise.all(Object.entries(permissionKeys).map(async ([key, permission]) => {
    const { data, error } = await supabase.rpc('has_permission', { permission_key:permission });
    return [key, !error && data === true] as const;
  }));
  const permissions = Object.fromEntries(entries) as Record<keyof typeof permissionKeys, boolean>;
  if (!permissions.dashboard) return NextResponse.json({ error:'Your account does not have access to the organization dashboard.' }, { status:403 });

  const dateParts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Kampala',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(part=>[part.type,part.value]));
  const today=`${dateParts.year}-${dateParts.month}-${dateParts.day}`;
  const weekEndDate=new Date(`${today}T00:00:00Z`);weekEndDate.setUTCDate(weekEndDate.getUTCDate()+7);
  const weekEnd=weekEndDate.toISOString().slice(0,10);
  const [profileResult, projectsResult, tasksResult, recentTasksResult, assignmentResult, reportsResult, activeRiskCount, evaluationCount, activeProjectCount, completedProjectCount, completedTaskCount, submittedReportCount, overdueTaskCount, upcomingTaskCount, postedJournalCount] = await Promise.all([
    supabase.from('profiles').select('full_name,job_title').eq('id',user.id).maybeSingle(),
    supabase.from('projects').select('id,code,name,location,status,end_date,manager_id').order('updated_at',{ascending:false}).limit(100),
    supabase.from('tasks').select('id,title,status,progress,due_date,updated_at,project_id,projects(name,code)').order('due_date',{ascending:true}).limit(1000),
    supabase.from('tasks').select('id,title,status,updated_at,projects(name,code)').order('updated_at',{ascending:false}).limit(10),
    supabase.from('task_assignments').select('task_id').eq('profile_id',user.id),
    supabase.from('reports').select('id,title,status,created_at,project_id').order('created_at',{ascending:false}).limit(500),
    supabase.from('risks').select('id',{count:'exact',head:true}).not('status','in','("closed","resolved","complete")'),
    supabase.from('evaluations').select('id',{count:'exact',head:true}),
    supabase.from('projects').select('id',{count:'exact',head:true}).eq('status','active'),
    supabase.from('projects').select('id',{count:'exact',head:true}).eq('status','completed'),
    supabase.from('tasks').select('id',{count:'exact',head:true}).in('status',['completed','approved']),
    supabase.from('reports').select('id',{count:'exact',head:true}).eq('status','submitted'),
    supabase.from('tasks').select('id',{count:'exact',head:true}).lt('due_date',today).not('status','in','("completed","approved","cancelled")'),
    supabase.from('tasks').select('id',{count:'exact',head:true}).gte('due_date',today).lte('due_date',weekEnd).not('status','in','("completed","approved","cancelled")'),
    permissions.accounting ? supabase.from('journal_entries').select('id',{count:'exact',head:true}).eq('status','posted') : Promise.resolve({count:null,error:null}),
  ]);
  const firstError = [profileResult,projectsResult,tasksResult,recentTasksResult,assignmentResult,reportsResult,activeRiskCount,evaluationCount,activeProjectCount,completedProjectCount,completedTaskCount,submittedReportCount,overdueTaskCount,upcomingTaskCount].find(result=>result.error);
  const projectRows=(projectsResult.data??[]) as ProjectRow[];
  const taskRows=(tasksResult.data??[]) as unknown as TaskRow[];
  const reportRows=(reportsResult.data??[]) as ReportRow[];
  const assignedIds=new Set((assignmentResult.data??[]).map(row=>row.task_id));
  const tasks=taskRows.filter(task=>assignedIds.has(task.id)).slice(0,6).map(task=>({
    id:task.id,title:task.title,project:relatedProject(task.projects)?.name??'Project',projectCode:relatedProject(task.projects)?.code??'',
    dueDate:task.due_date,status:task.status,progress:task.progress??0,
  }));
  const taskProgress=new Map<string,number[]>();
  for(const task of taskRows){const list=taskProgress.get(task.project_id)??[];list.push(task.progress??0);taskProgress.set(task.project_id,list);}
  const todayDate=new Date(`${today}T00:00:00Z`);
  const projects=projectRows.map((project,index)=>{
    const progressValues=taskProgress.get(project.id)??[];
    const progress=progressValues.length?Math.round(progressValues.reduce((sum,value)=>sum+value,0)/progressValues.length):project.status==='completed'?100:null;
    const hasOverdue=taskRows.some(task=>task.project_id===project.id&&task.due_date&&new Date(`${task.due_date}T00:00:00`)<todayDate&&!['approved','completed','cancelled'].includes(task.status));
    const status=project.status==='completed'?'Completed':hasOverdue?'Delayed':project.status==='on_hold'?'On hold':project.status==='active'?'Active':'Planning';
    return {id:project.id,name:project.name,code:project.code,location:project.location??'Location not set',status,progress,color:['violet','green','orange','blue'][index%4],lead:project.manager_id===user.id?'You':'Private',due:project.end_date};
  });
  const now=Date.now();
  const recent=[...reportRows.slice(0,6).map(report=>({id:report.id,title:report.status==='submitted'?'A report is awaiting review':'A report was updated',project:projectRows.find(p=>p.id===report.project_id)?.name??'Organization',date:report.created_at,href:'/reports',tone:'green'})),...((recentTasksResult.data??[]) as unknown as Array<{id:string;title:string;status:string;updated_at:string;projects:ProjectRelation}>).map(task=>({id:task.id,title:task.status==='completed'||task.status==='approved'?'A task was completed':'A task was updated',project:relatedProject(task.projects)?.name??'Project',date:task.updated_at,href:'/tasks',tone:'purple'}))]
    .sort((a,b)=>new Date(b.date).getTime()-new Date(a.date).getTime()).slice(0,4).map(item=>({...item,when:relativeTime(item.date,now)}));

  return NextResponse.json({
    profile:{name:profileResult.data?.full_name||user.email?.split('@')[0]||'Member',role:profileResult.data?.job_title||'Organization member'},
    permissions:{...permissions,projects:permissions.projects||projects.length>0,tasks:permissions.tasks||taskRows.length>0,reports:permissions.reports||reportRows.length>0,documents:permissions.documents||permissions.documentsCreate,meal:permissions.meal||permissions.indicators||permissions.risks},
    metrics:{activeProjects:activeProjectCount.error?null:activeProjectCount.count??0,completedProjects:completedProjectCount.error?null:completedProjectCount.count??0,completedTasks:completedTaskCount.error?null:completedTaskCount.count??0,reportsToReview:submittedReportCount.error?null:submittedReportCount.count??0,activeRisks:activeRiskCount.error?null:activeRiskCount.count??0,evaluations:evaluationCount.error?null:evaluationCount.count??0,overdueTasks:overdueTaskCount.error?null:overdueTaskCount.count??0,upcomingTasks:upcomingTaskCount.error?null:upcomingTaskCount.count??0,postedJournalEntries:permissions.accounting?(postedJournalCount.error?null:postedJournalCount.count??0):null},
    projects,tasks,recent,errors:firstError?['Some dashboard records could not be loaded. Refresh or contact an administrator.']:[],
  });
}

function relativeTime(value:string,now:number){
  const elapsed=Math.max(0,Math.floor((now-new Date(value).getTime())/60000));
  if(elapsed<60)return `${elapsed} min ago`;
  if(elapsed<1440)return `${Math.floor(elapsed/60)} hr ago`;
  return `${Math.floor(elapsed/1440)} days ago`;
}
function relatedProject(value:ProjectRelation){return Array.isArray(value)?value[0]??null:value;}
