import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors={ 'Access-Control-Allow-Origin':Deno.env.get('APP_ORIGIN')??'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS' };
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
type Body=Record<string,unknown>&{action?:string};
const str=(x:unknown)=>typeof x==='string'?x.trim():'';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function has(db:SupabaseClient,key:string,scope?:{kind:string;id:string}){const {data,error}=scope?await db.rpc('has_scoped_permission',{permission_key:key,scope_kind:scope.kind,target_scope:scope.id}):await db.rpc('has_permission',{permission_key:key});return !error&&data===true;}
function cleanValues(b:Body){
 const allowedTypes=['daily','daily_activity','weekly','monthly','quarterly','task_completion','field','field_activity','incident','challenges_lessons','recommendations','project_progress','team_weekly','team_monthly','project_weekly','project_monthly','project_quarterly','meal_collective'];
 const progress=b.progress===null||b.progress===''?null:Number(b.progress);
 if(progress!==null&&(!Number.isFinite(progress)||progress<0||progress>100))throw new Error('Progress must be between 0 and 100.');
 const arr=(value:unknown)=>Array.isArray(value)?value.slice(0,200).map(str).filter(Boolean):[];
 const reportType=str(b.report_type)||'weekly';if(!allowedTypes.includes(reportType))throw new Error('Report type is invalid.');
 return {title:str(b.title),report_type:reportType,team_id:str(b.team_id)||null,project_id:str(b.project_id)||null,task_id:str(b.task_id)||null,activity_id:str(b.activity_id)||null,period_start:str(b.period_start)||null,period_end:str(b.period_end)||null,planned_activities:str(b.planned_activities)||null,achievements:str(b.achievements)||null,activities:arr(b.activities),deliverables:arr(b.deliverables),outputs:arr(b.outputs),challenges:str(b.challenges)||null,incidents:str(b.incidents)||null,risks:str(b.risks)||null,lessons:str(b.lessons)||null,recommendations:str(b.recommendations)||null,support_required:str(b.support_required)||null,progress};
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return json({error:'Method not allowed.'},405);
 const authorization=req.headers.get('Authorization'),url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_ANON_KEY');if(!authorization?.startsWith('Bearer ')||!url||!key)return json({error:'Authentication or server configuration is missing.'},401);
 const db=createClient(url,key,{global:{headers:{Authorization:authorization}}});const {data:{user},error:authError}=await db.auth.getUser();if(authError||!user)return json({error:'Sign in to continue.'},401);
 let b:Body;try{b=await req.json() as Body;}catch{return json({error:'Request body must be valid JSON.'},400);}
 try{switch(b.action){case 'create':return await create(db,user.id,b);case 'update':return await update(db,b);case 'submit':return await submit(db,b);case 'review':return await review(db,user.id,b);case 'compile':return await compile(db,user.id,b);default:return json({error:'Unknown report workflow action.'},400);}}
 catch(error){console.error('Report workflow failed',error instanceof Error?error.message:'unknown error');return json({error:error instanceof Error?error.message:'Report workflow failed.'},400);}
});

async function create(db:SupabaseClient,userId:string,b:Body){
 const values=cleanValues(b);if(!values.title||values.title.length>200||(!values.project_id&&!values.team_id))return json({error:'Report title and project or team are required.'},400);
 if(values.project_id&&!uuid.test(values.project_id)||values.team_id&&!uuid.test(values.team_id))return json({error:'Report scope is invalid.'},400);
 if(!await has(db,'reports.create'))return json({error:'You cannot create reports.'},403);
 const {data,error}=await db.from('reports').insert({...values,author_id:userId,status:'draft'}).select('id').single();if(error||!data)throw error??new Error('Report could not be created.');return json({created:true,report_id:data.id},201);
}

async function update(db:SupabaseClient,b:Body){
 const id=str(b.report_id),values=cleanValues(b);if(!uuid.test(id)||!values.title)return json({error:'Report details are invalid.'},400);
 if(!await has(db,'reports.edit'))return json({error:'You cannot edit reports.'},403);
 const {error}=await db.from('reports').update(values).eq('id',id);if(error)throw error;return json({updated:true});
}

async function submit(db:SupabaseClient,b:Body){
 const id=str(b.report_id);if(!uuid.test(id)||!await has(db,'reports.submit'))return json({error:'Report submission is not authorized.'},403);
 const {error}=await db.from('reports').update({status:'submitted',submitted_at:new Date().toISOString(),submission_date:new Date().toISOString().slice(0,10)}).eq('id',id).in('status',['draft','returned']);if(error)throw error;return json({submitted:true});
}

async function review(db:SupabaseClient,userId:string,b:Body){
 const id=str(b.report_id),decision=str(b.decision),comment=str(b.comment);if(!uuid.test(id)||!['approve','return','reject'].includes(decision))return json({error:'Report review details are invalid.'},400);
 if(!await has(db,'reports.review'))return json({error:'You cannot review reports.'},403);
 const {data:report,error:lookupError}=await db.from('reports').select('id,status,author_id').eq('id',id).single();if(lookupError||!report||report.status!=='submitted'||report.author_id===userId)return json({error:'Report is unavailable for review.'},404);
 const {error:reviewError}=await db.from('report_reviews').insert({report_id:id,reviewer_id:userId,decision,comment:comment||null});if(reviewError)throw reviewError;
 const status=decision==='approve'?'approved':decision==='return'?'returned':'rejected';const {error}=await db.from('reports').update({status,reviewed_by:userId,verified:decision==='approve'}).eq('id',id).eq('status','submitted');if(error)throw error;return json({reviewed:true,verified:decision==='approve'});
}

async function compile(db:SupabaseClient,userId:string,b:Body){
 const title=str(b.title),teamId=str(b.team_id),projectId=str(b.project_id),raw=Array.isArray(b.source_report_ids)?b.source_report_ids:[];const sourceIds=[...new Set(raw.map(str).filter(Boolean))];
 if(!title||title.length>200||Boolean(teamId)===Boolean(projectId)||!sourceIds.length||sourceIds.length>100||sourceIds.some(id=>!uuid.test(id)))return json({error:'Choose a title, exactly one team or project, and approved source reports.'},400);
 if(!await has(db,'reports.compile'))return json({error:'You cannot compile reports.'},403);
 const {data:sources,error:sourceError}=await db.from('reports').select('id,team_id,project_id,period_start,period_end,activities,deliverables,outputs,planned_activities,achievements,challenges,risks,lessons,recommendations,progress').in('id',sourceIds).eq('status','approved');
 if(sourceError||!sources||sources.length!==sourceIds.length)return json({error:'Only approved, authorized source reports can be compiled.'},403);
 if(teamId&&sources.some(s=>s.team_id!==teamId)||projectId&&sources.some(s=>s.project_id!==projectId))return json({error:'Every source report must belong to the selected team or project.'},400);
 const text=(x:unknown)=>typeof x==='string'?x:'';const join=(key:'planned_activities'|'achievements'|'challenges'|'risks'|'lessons'|'recommendations')=>sources.map(s=>text(s[key])).filter(Boolean).join('\n\n');
 const today=new Date().toISOString().slice(0,10);
 const {data:compiled,error}=await db.from('reports').insert({title,report_type:teamId?'team_monthly':'project_monthly',team_id:teamId||null,project_id:projectId||null,author_id:userId,status:'submitted',submitted_at:new Date().toISOString(),submission_date:today,activities:sources.flatMap(s=>Array.isArray(s.activities)?s.activities:[]),deliverables:sources.flatMap(s=>Array.isArray(s.deliverables)?s.deliverables:[]),outputs:sources.flatMap(s=>Array.isArray(s.outputs)?s.outputs:[]),planned_activities:join('planned_activities'),achievements:join('achievements'),challenges:join('challenges'),risks:join('risks'),lessons:join('lessons'),recommendations:join('recommendations'),progress:sources.reduce((sum,s)=>sum+Number(s.progress??0),0)/sources.length}).select('id').single();
 if(error||!compiled)throw error??new Error('Consolidated report could not be created.');
 const {error:linkError}=await db.from('team_report_sources').insert(sourceIds.map(source_report_id=>({team_report_id:compiled.id,source_report_id})));
 if(linkError)throw linkError;return json({compiled:true,report_id:compiled.id},201);
}
