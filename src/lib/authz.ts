import { createClient } from '@/lib/supabase/server';

/** Permission checks are backed by the security-definer database resolver and RLS. */
export async function hasPermission(permission: string): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase.rpc('has_permission', { permission_key: permission });
  return !error && data === true;
}

export async function requireAuth() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Authentication required');
  return { supabase, user };
}

export async function requirePermission(permission: string) {
  const { supabase, user } = await requireAuth();
  const { data, error } = await supabase.rpc('has_permission', { permission_key: permission });
  if (error || data !== true) throw new Error('Permission denied');
  return { supabase, user };
}

export async function requireScopedPermission(permission: string, scopeType: 'organization'|'department'|'team'|'project'|'record', scopeId: string | null) {
  const { supabase, user } = await requireAuth();
  const { data, error } = await supabase.rpc('has_scoped_permission', { permission_key: permission, scope_kind: scopeType, target_scope: scopeId });
  if (error || data !== true) throw new Error('Permission denied for this scope');
  return { supabase, user };
}

export async function hasTeamAccess(teamId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('has_team_access', { target_team: teamId });
  return !error && data === true;
}

export async function canAccessProject(projectId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('can_access_project', { target_project: projectId });
  return !error && data === true;
}
