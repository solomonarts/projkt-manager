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
  taskReview: 'tasks.review',
  reportReview: 'reports.review',
  accountingApprove: 'accounting.approve',
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

  const permissions = Object.fromEntries(permissionResults);
  const [registrations,reports,tasks,journals] = await Promise.all([
    permissions.teams ? supabase.from('employee_registration_requests').select('id',{count:'exact',head:true}).in('status',['pending_assignment','pending_team_approval','pending_project_approval','approved_pending_id','approved_pending_email']) : Promise.resolve({count:0}),
    permissions.reportReview ? supabase.from('reports').select('id',{count:'exact',head:true}).eq('status','submitted') : Promise.resolve({count:0}),
    permissions.taskReview ? supabase.from('tasks').select('id',{count:'exact',head:true}).eq('status','pending_review') : Promise.resolve({count:0}),
    permissions.accountingApprove ? supabase.from('journal_entries').select('id',{count:'exact',head:true}).eq('status','pending_approval') : Promise.resolve({count:0}),
  ]);
  return NextResponse.json({
    profile: {
      name: profileResult.data?.full_name || user.email?.split('@')[0] || 'Member',
      role: profileResult.data?.job_title || 'Organization member',
    },
    permissions,
    pendingCounts:{teams:registrations.count??0,reports:reports.count??0,tasks:tasks.count??0,accounting:journals.count??0},
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
