import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const permissionKeys = {
  dashboard: 'dashboard.view',
  projects: 'projects.view',
  tasks: 'tasks.view',
  teams: 'teams.view',
  reports: 'reports.view',
  meal: 'evaluations.view',
  risks: 'projects.view',
  accounting: 'accounting.view',
  documents: 'documents.view',
  administration: 'system.manage',
};

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

  const [profileResult, permissionResults] = await Promise.all([
    supabase.from('profiles').select('full_name,job_title').eq('id', user.id).maybeSingle(),
    Promise.all(Object.entries(permissionKeys).map(async ([key, permission]) => {
      const { data, error } = await supabase.rpc('has_permission', { permission_key: permission });
      return [key, !error && data === true] as const;
    })),
  ]);

  const { data: pendingRegistrations } = await supabase.from('employee_registration_requests').select('id')
    .in('status', ['pending_team_approval','pending_project_approval','approved_pending_id','approved_pending_email']).limit(1);
  const permissions = Object.fromEntries(permissionResults);
  permissions.registrationApprovals = Boolean(pendingRegistrations?.length);
  return NextResponse.json({
    profile: {
      name: profileResult.data?.full_name || user.email?.split('@')[0] || 'Member',
      role: profileResult.data?.job_title || 'Organization member',
    },
    permissions,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
