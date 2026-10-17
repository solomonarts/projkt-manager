'use server';

import { revalidatePath } from 'next/cache';
import { requireAuth, requirePermission, requireScopedPermission } from '@/lib/authz';

async function invokeTask(supabase:Awaited<ReturnType<typeof requireAuth>>['supabase'],body:Record<string,unknown>){const {data,error}=await supabase.functions.invoke('task-workflows',{body});if(error){const response=(error as Error&{context?:Response}).context;if(response)try{const payload=await response.json();throw new Error(payload.error||error.message);}catch(cause){if(cause instanceof Error&&cause.message!==error.message)throw cause;}throw new Error(error.message);}if(data?.error)throw new Error(String(data.error));return data;}

async function requireTaskScope(taskId:string,permission:string){const {supabase}=await requireAuth();const {data,error}=await supabase.from('tasks').select('project_id').eq('id',taskId).single();if(error||!data?.project_id)throw new Error('Task is unavailable in your authorized projects.');return requireScopedPermission(permission,'project',data.project_id);}

export async function completeTask(formData:FormData){
  const taskId=String(formData.get('task_id')??'');
  if(!taskId)throw new Error('Missing task.');
  const {supabase}=await requireTaskScope(taskId,'tasks.complete');await invokeTask(supabase,{action:'complete',task_id:taskId});
  revalidatePath('/tasks');
}

export async function createTask(formData:FormData){
  const projectId=String(formData.get('project_id')??'');const title=String(formData.get('title')??'').trim();
  const {supabase}=await requireScopedPermission('tasks.create','project',projectId);
  if(!projectId||!title)throw new Error('Choose a project and enter a task title.');
  const checklist=String(formData.get('checklist')??'').split('\n').map(label=>label.trim()).filter(Boolean).map(label=>({label,checked:false}));
  await invokeTask(supabase,{action:'create',project_id:projectId,title,description:String(formData.get('description')??''),priority:String(formData.get('priority')??'medium'),start_date:String(formData.get('start_date')??''),due_date:String(formData.get('due_date')??''),expected_deliverable:String(formData.get('expected_deliverable')??''),team_id:String(formData.get('team_id')??''),reviewer_id:String(formData.get('reviewer_id')??''),objective_id:String(formData.get('objective_id')??''),output_id:String(formData.get('output_id')??''),activity_id:String(formData.get('activity_id')??''),checklist,assignee_id:String(formData.get('assignee_id')??''),dependency_id:String(formData.get('dependency_id')??'')});
  revalidatePath('/tasks');
}

export async function reviewTask(formData:FormData){
  const taskId=String(formData.get('task_id')??'');const decision=String(formData.get('decision')??'');
  if(!taskId||!['approved','changes_requested'].includes(decision))throw new Error('Choose a valid task review decision.');
  const {supabase}=await requireTaskScope(taskId,'tasks.approve');
  await invokeTask(supabase,{action:'review',task_id:taskId,decision});
  revalidatePath('/tasks');
}

export async function addTaskComment(formData:FormData){
  const taskId=String(formData.get('task_id')??'');const body=String(formData.get('body')??'').trim();
  if(!taskId||!body)throw new Error('Write a comment before submitting.');
  const {supabase}=await requireTaskScope(taskId,'tasks.view');await invokeTask(supabase,{action:'comment',task_id:taskId,body});
  revalidatePath('/tasks');
}

export async function uploadTaskEvidence(formData:FormData){
  const taskId=String(formData.get('task_id')??'');const item=formData.get('file');
  if(!taskId||!(item instanceof File)||item.size===0)throw new Error('Choose an evidence file to upload.');
  if(item.size>15*1024*1024||!['application/pdf','image/jpeg','image/png','image/webp'].includes(item.type))throw new Error('Upload a PDF or image no larger than 15 MB.');
  const {supabase,user}=await requireTaskScope(taskId,'tasks.complete');
  const {data:task,error:taskError}=await supabase.from('tasks').select('id').eq('id',taskId).single();
  if(taskError||!task)throw new Error('You do not have access to this task.');
  const safeName=item.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(-100);
  const path=`${taskId}/${crypto.randomUUID()}-${safeName}`;
  const {error:uploadError}=await supabase.storage.from('task-evidence').upload(path,item,{contentType:item.type,upsert:false});
  if(uploadError)throw new Error(uploadError.message);
  try{await invokeTask(supabase,{action:'evidence',task_id:taskId,storage_path:path,file_name:item.name});}catch(error){await supabase.storage.from('task-evidence').remove([path]);throw error;}
  revalidatePath('/tasks');
}

export async function updateTaskProgress(formData:FormData){
  const taskId=String(formData.get('task_id')??'');const progress=Number(formData.get('progress'));const status=String(formData.get('status')??'in_progress');
  const note=String(formData.get('note')??'').trim();const blocker=String(formData.get('blocker')??'').trim();
  if(!taskId||!Number.isInteger(progress)||progress<0||progress>99||!['in_progress','blocked'].includes(status)||!note)throw new Error('Add a progress update, note, and valid task status.');
  const {supabase}=await requireTaskScope(taskId,'tasks.complete');await invokeTask(supabase,{action:'progress',task_id:taskId,progress,status,note,blocker});revalidatePath('/tasks');
}

export async function updateTaskChecklist(formData:FormData){
  const taskId=String(formData.get('task_id')??'');let checklist:Array<{label:string;checked:boolean}>;
  try{const parsed=JSON.parse(String(formData.get('checklist_data')??'[]'));if(!Array.isArray(parsed)||parsed.length>100)throw new Error();checklist=parsed.map(item=>({label:String(item.label).slice(0,240),checked:false}));}catch{throw new Error('Checklist data is invalid.');}
  const checked=new Set(formData.getAll('checklist_done').map(String));checklist=checklist.map((item,index)=>({...item,checked:checked.has(String(index))}));
  const {supabase}=await requireTaskScope(taskId,'tasks.complete');await invokeTask(supabase,{action:'checklist',task_id:taskId,checklist});revalidatePath('/tasks');
}

export async function reassignTask(formData:FormData){
  const taskId=String(formData.get('task_id')??'');const profileId=String(formData.get('profile_id')??'');
  if(!taskId)throw new Error('Missing task.');const {supabase}=await requireTaskScope(taskId,'tasks.assign');await invokeTask(supabase,{action:'reassign',task_id:taskId,profile_id:profileId});revalidatePath('/tasks');
}
