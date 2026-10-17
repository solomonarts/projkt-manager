'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission, requireScopedPermission } from '@/lib/authz';

export async function createDepartment(formData:FormData){
  const name=String(formData.get('name')??'').trim();if(!name)throw new Error('Enter a department name.');
  const {supabase}=await requirePermission('system.manage');const {error}=await supabase.from('departments').insert({name,description:String(formData.get('description')??'').trim()||null});
  if(error)throw new Error(error.message);revalidatePath('/teams');
}
export async function createTeam(formData:FormData){
  const name=String(formData.get('name')??'').trim();const projectId=String(formData.get('project_id')??'');if(!name||!projectId)throw new Error('Choose the project and enter a team name.');
  const {supabase}=await requirePermission('teams.create');
  const {data:team,error}=await supabase.from('teams').insert({name,description:String(formData.get('description')??'').trim()||null,department_id:String(formData.get('department_id')??'')||null,default_project_id:projectId}).select('id').single();
  if(error||!team)throw new Error(error?.message??'Could not create team.');
  const leadId=String(formData.get('lead_id')??'');if(leadId){const {error:memberError}=await supabase.from('team_members').insert({team_id:team.id,profile_id:leadId,team_role:'lead'});if(memberError)throw new Error(memberError.message);}
  revalidatePath('/teams');
}
export async function addTeamMember(formData:FormData){
  const teamId=String(formData.get('team_id')??'');const profileId=String(formData.get('profile_id')??'');const role=String(formData.get('team_role')??'member');
  if(!teamId||!profileId||!['member','lead'].includes(role))throw new Error('Choose a team member and valid team role.');
  const {supabase}=await requireScopedPermission('teams.manage_members','team',teamId);const {error}=await supabase.from('team_members').upsert({team_id:teamId,profile_id:profileId,team_role:role});
  if(error)throw new Error(error.message);revalidatePath('/teams');
}
export async function removeTeamMember(formData:FormData){
  const teamId=String(formData.get('team_id')??'');const profileId=String(formData.get('profile_id')??'');
  const {supabase}=await requireScopedPermission('teams.manage_members','team',teamId);const {error}=await supabase.from('team_members').delete().eq('team_id',teamId).eq('profile_id',profileId);
  if(error)throw new Error(error.message);revalidatePath('/teams');
}
export async function addProjectMember(formData:FormData){
  const projectId=String(formData.get('project_id')??'');const profileId=String(formData.get('profile_id')??'');const access=String(formData.get('access_level')??'member');
  if(!projectId||!profileId||!['manager','member','viewer'].includes(access))throw new Error('Choose a project, member and access level.');
  const {supabase}=await requireScopedPermission('projects.assign','project',projectId);const {error}=await supabase.from('project_members').upsert({project_id:projectId,profile_id:profileId,access_level:access});
  if(error)throw new Error(error.message);revalidatePath('/teams');revalidatePath('/projects');
}
