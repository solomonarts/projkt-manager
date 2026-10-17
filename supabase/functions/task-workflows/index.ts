import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
type Body=Record<string,unknown>&{action?:string};
const str=(value:unknown)=>typeof value==='string'?value.trim():'';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function permission(db:SupabaseClient,key:string,projectId?:string){const {data,error}=projectId?await db.rpc('has_scoped_permission',{permission_key:key,scope_kind:'project',target_scope:projectId}):await db.rpc('has_permission',{permission_key:key});return !error&&data===true;}
async function task(db:SupabaseClient,id:string){if(!uuid.test(id))return null;const {data}=await db.from('tasks').select('id,project_id').eq('id',id).single();return data;}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return json({error:'Method not allowed.'},405);
 const authorization=req.headers.get('Authorization'),url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_ANON_KEY');
 if(!authorization?.startsWith('Bearer ')||!url||!key)return json({error:'Authentication or server configuration is missing.'},401);
 const db=createClient(url,key,{global:{headers:{Authorization:authorization}}});
 const {data:{user},error:authError}=await db.auth.getUser();if(authError||!user)return json({error:'Sign in to continue.'},401);
 let body:Body;try{body=await req.json() as Body;}catch{return json({error:'Request body must be valid JSON.'},400);}
 try{
  switch(body.action){
   case 'create':return await createTask(db,user.id,body);
   case 'complete':return await taskProgress(db,user.id,body,{progress:100,status:'pending_review',note:'Submitted task for review'});
   case 'progress':return await taskProgress(db,user.id,body,{progress:body.progress,status:str(body.status),note:str(body.note),blocker:str(body.blocker)||null});
   case 'review':return await reviewTask(db,body);
   case 'comment':return await comment(db,user.id,body);
   case 'evidence':return await evidence(db,user.id,body);
   case 'checklist':return await checklist(db,user.id,body);
   case 'reassign':return await reassign(db,body);
   default:return json({error:'Unknown task workflow action.'},400);
  }
 }catch(error){console.error('Task workflow failed',error instanceof Error?error.message:'unknown error');return json({error:error instanceof Error?error.message:'Task workflow failed.'},400);}
});

async function createTask(db:SupabaseClient,userId:string,b:Body){
 const projectId=str(b.project_id),title=str(b.title),priority=str(b.priority)||'medium';
 if(!uuid.test(projectId)||!title||title.length>180||!['low','medium','high','urgent'].includes(priority))return json({error:'Task details are invalid.'},400);
 if(!await permission(db,'tasks.create',projectId))return json({error:'You cannot create tasks in this project.'},403);
 const list=(value:unknown)=>Array.isArray(value)?value.filter(item=>item&&typeof item==='object'):[];
 const checklist=list(b.checklist).slice(0,100).map(item=>({label:str((item as Record<string,unknown>).label).slice(0,240),checked:false})).filter(item=>item.label);
 const record={project_id:projectId,title,description:str(b.description)||null,priority,status:'not_started',start_date:str(b.start_date)||null,due_date:str(b.due_date)||null,expected_deliverable:str(b.expected_deliverable)||null,team_id:str(b.team_id)||null,reviewer_id:str(b.reviewer_id)||null,objective_id:str(b.objective_id)||null,output_id:str(b.output_id)||null,activity_id:str(b.activity_id)||null,checklist,created_by:userId};
 const {data:created,error}=await db.from('tasks').insert(record).select('id').single();if(error||!created)throw error??new Error('Task could not be created.');
 const assignee=str(b.assignee_id),dependency=str(b.dependency_id);
 if(assignee){const {error:e}=await db.from('task_assignments').insert({task_id:created.id,profile_id:assignee});if(e)throw e;}
 if(dependency){const {error:e}=await db.from('task_dependencies').insert({task_id:created.id,depends_on_task_id:dependency});if(e)throw e;}
 return json({created:true,task_id:created.id},201);
}

async function taskProgress(db:SupabaseClient,userId:string,b:Body,values:Record<string,unknown>){
 const id=str(b.task_id),record=await task(db,id);if(!record)return json({error:'Task is unavailable.'},404);
 if(!await permission(db,'tasks.complete',record.project_id))return json({error:'You cannot update this task.'},403);
 if(values.status==='pending_review'&&values.progress===100){/* completion submission */}
 else if(!Number.isInteger(values.progress)||Number(values.progress)<0||Number(values.progress)>99||!['in_progress','blocked'].includes(str(values.status))||!str(values.note))return json({error:'Add a note, progress from 0 to 99, and a valid status.'},400);
 const {error}=await db.from('tasks').update({progress:values.progress,status:values.status,blocker:values.blocker??null,updated_at:new Date().toISOString()}).eq('id',id);
 if(error)throw error;
 // Keep the member's progress note alongside the automatic database audit entry.
 if(str(values.note)){
  const {data:assignment}=await db.from('task_assignments').select('task_id').eq('task_id',id).eq('profile_id',userId).maybeSingle();
  if(assignment){const {error:noteError}=await db.from('task_updates').insert({task_id:id,author_id:userId,progress:values.progress,note:str(values.note)});if(noteError)throw noteError;}
 }
 return json({updated:true});
}

async function reviewTask(db:SupabaseClient,b:Body){
 const id=str(b.task_id),decision=str(b.decision),record=await task(db,id);if(!record)return json({error:'Task is unavailable.'},404);
 if(!['approved','changes_requested'].includes(decision)||!await permission(db,'tasks.approve',record.project_id))return json({error:'Task review is not authorized.'},403);
 const {error}=await db.from('tasks').update({status:decision,updated_at:new Date().toISOString()}).eq('id',id);if(error)throw error;return json({reviewed:true});
}

async function comment(db:SupabaseClient,userId:string,b:Body){
 const id=str(b.task_id),body=str(b.body),record=await task(db,id);if(!record||!body||body.length>5000)return json({error:'Task comment is invalid or unavailable.'},400);
 if(!await permission(db,'tasks.view',record.project_id))return json({error:'You cannot comment on this task.'},403);
 const {error}=await db.from('task_comments').insert({task_id:id,author_id:userId,body});if(error)throw error;return json({commented:true},201);
}

async function evidence(db:SupabaseClient,userId:string,b:Body){
 const id=str(b.task_id),path=str(b.storage_path),fileName=str(b.file_name),record=await task(db,id);
 if(!record||!path.startsWith(`${id}/`)||!fileName)return json({error:'Task evidence is invalid.'},400);
 if(!await permission(db,'tasks.complete',record.project_id))return json({error:'You cannot attach evidence to this task.'},403);
 const {error}=await db.from('task_attachments').insert({task_id:id,storage_path:path,file_name:fileName,uploaded_by:userId});if(error)throw error;return json({attached:true},201);
}

async function checklist(db:SupabaseClient,userId:string,b:Body){
 const id=str(b.task_id),record=await task(db,id),items=Array.isArray(b.checklist)?b.checklist:[];
 if(!record||items.length>100)return json({error:'Checklist is invalid or task is unavailable.'},400);
 if(!await permission(db,'tasks.complete',record.project_id))return json({error:'You cannot update this checklist.'},403);
 const clean=items.map(item=>({label:str((item as Record<string,unknown>).label).slice(0,240),checked:Boolean((item as Record<string,unknown>).checked)}));
 if(clean.some(item=>!item.label))return json({error:'Checklist items need labels.'},400);
 const {error}=await db.from('tasks').update({checklist:clean,updated_at:new Date().toISOString()}).eq('id',id);if(error)throw error;return json({updated:true});
}

async function reassign(db:SupabaseClient,b:Body){
 const id=str(b.task_id),profileId=str(b.profile_id),record=await task(db,id);if(!record)return json({error:'Task is unavailable.'},404);
 if(!await permission(db,'tasks.assign',record.project_id))return json({error:'You cannot reassign this task.'},403);
 if(profileId){const {error}=await db.from('task_assignments').upsert({task_id:id,profile_id:profileId,assignment_type:'assignee'});if(error)throw error;}
 let query=db.from('task_assignments').delete().eq('task_id',id);if(profileId)query=query.neq('profile_id',profileId);
 const {error}=await query;if(error)throw error;return json({reassigned:true});
}
