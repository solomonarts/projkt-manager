'use server';

import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requirePermission } from '@/lib/authz';

async function invokeReport(supabase:SupabaseClient,body:Record<string,unknown>){
  const {data,error}=await supabase.functions.invoke('report-workflows',{body});
  if(error){const response=(error as Error&{context?:Response}).context;if(response)try{const payload=await response.json();throw new Error(payload.error||error.message);}catch(cause){if(cause instanceof Error&&cause.message!==error.message)throw cause;}throw new Error(error.message);}
  if(data?.error)throw new Error(String(data.error));return data;
}

function reportValues(formData:FormData){
  const lines=(name:string)=>String(formData.get(name)??'').split('\n').map(item=>item.trim()).filter(Boolean);
  const progress=String(formData.get('progress')??'');
  if(progress!==''&&(!Number.isFinite(Number(progress))||Number(progress)<0||Number(progress)>100))throw new Error('Progress must be between 0 and 100.');
  return {title:String(formData.get('title')??'').trim(),report_type:String(formData.get('report_type')??'weekly'),team_id:String(formData.get('team_id')??'')||null,project_id:String(formData.get('project_id')??'')||null,task_id:String(formData.get('task_id')??'')||null,activity_id:String(formData.get('activity_id')??'')||null,period_start:String(formData.get('period_start')??'')||null,period_end:String(formData.get('period_end')??'')||null,planned_activities:String(formData.get('planned_activities')??'').trim()||null,achievements:String(formData.get('achievements')??'').trim()||null,activities:lines('activities'),outputs:lines('outputs'),challenges:String(formData.get('challenges')??'').trim()||null,incidents:String(formData.get('incidents')??'').trim()||null,risks:String(formData.get('risks')??'').trim()||null,lessons:String(formData.get('lessons')??'').trim()||null,recommendations:String(formData.get('recommendations')??'').trim()||null,support_required:String(formData.get('support_required')??'').trim()||null,progress:progress===''?null:Math.min(100,Math.max(0,Number(progress)))};
}

async function saveAttachments(supabase:SupabaseClient,reportId:string,userId:string,formData:FormData){
  const files=formData.getAll('attachments').filter((file):file is File=>file instanceof File&&file.size>0);
  if(files.length>5)throw new Error('Attach up to five files at a time.');
  const paths:string[]=[];
  for(const file of files){
    if(file.size>15*1024*1024||!['application/pdf','image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Attachments must be PDF or image files no larger than 15 MB each.');
    const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(-100);const path=`${reportId}/${crypto.randomUUID()}-${safeName}`;
    const {error}=await supabase.storage.from('report-evidence').upload(path,file,{contentType:file.type,upsert:false});if(error)throw new Error(error.message);paths.push(path);
    const {error:recordError}=await supabase.from('report_attachments').insert({report_id:reportId,storage_path:path,file_name:file.name,uploaded_by:userId});
    if(recordError){await supabase.storage.from('report-evidence').remove([path]);throw new Error(recordError.message);}
  }
  return paths;
}

export async function createReport(formData:FormData){
  const values=reportValues(formData);const {supabase,user}=await requirePermission('reports.create');if(!values.title)throw new Error('Enter a report title.');
  const data=await invokeReport(supabase,{action:'create',...values});if(!data?.report_id)throw new Error('Could not save report.');await saveAttachments(supabase,data.report_id,user.id,formData);revalidatePath('/reports');
}

export async function updateReport(formData:FormData){
  const reportId=String(formData.get('report_id')??'');const values=reportValues(formData);if(!reportId||!values.title)throw new Error('Enter a report title.');
  const {supabase,user}=await requirePermission('reports.edit');await invokeReport(supabase,{action:'update',report_id:reportId,...values});await saveAttachments(supabase,reportId,user.id,formData);revalidatePath('/reports');
}

export async function submitReport(formData:FormData){
  const reportId=String(formData.get('report_id')??'');if(!reportId)throw new Error('Missing report.');
  const {supabase}=await requirePermission('reports.submit');await invokeReport(supabase,{action:'submit',report_id:reportId});revalidatePath('/reports');
}

export async function reviewReport(formData:FormData){
  const reportId=String(formData.get('report_id')??'');const decision=String(formData.get('decision')??'');const comment=String(formData.get('comment')??'').trim();
  if(!reportId||!['approve','return','reject'].includes(decision))throw new Error('Choose a valid report review decision.');
  const {supabase}=await requirePermission('reports.review');await invokeReport(supabase,{action:'review',report_id:reportId,decision,comment});revalidatePath('/reports');
}

export async function compileReport(formData:FormData){
  const title=String(formData.get('title')??'').trim();const teamId=String(formData.get('team_id')??'');const projectId=String(formData.get('project_id')??'');
  const sourceIds=formData.getAll('source_report_id').map(String).filter(Boolean);
  if(!title||(!teamId&&!projectId)||!sourceIds.length||Boolean(teamId)===Boolean(projectId))throw new Error('Choose a report title, exactly one team or project, and at least one approved source report.');
  const {supabase}=await requirePermission('reports.compile');await invokeReport(supabase,{action:'compile',title,team_id:teamId||null,project_id:projectId||null,source_report_ids:sourceIds});revalidatePath('/reports');
}
