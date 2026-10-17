-- Fieldnote MEAL platform: organization-scoped schema and default-deny RLS.
create extension if not exists pgcrypto;

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(), name text not null, description text,
  created_at timestamptz not null default now()
);
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(), name text not null unique,
  description text, is_system boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(), key text not null unique, description text not null default ''
);
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade, full_name text not null default '',
  email text not null default '', department_id uuid references public.departments(id),
  is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.profile_roles (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade, primary key(profile_id, role_id)
);
create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade, primary key(role_id, permission_id)
);
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(), department_id uuid references public.departments(id),
  name text not null, description text, created_at timestamptz not null default now()
);
create table if not exists public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  team_role text not null default 'member' check(team_role in ('member','lead')),
  joined_at timestamptz not null default now(), primary key(team_id, profile_id)
);
create table if not exists public.team_permissions (
  team_id uuid not null references public.teams(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade, primary key(team_id, permission_id)
);
create table if not exists public.user_permissions (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  granted boolean not null default true, granted_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), primary key(profile_id, permission_id)
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(), code text not null unique, name text not null, description text,
  manager_id uuid references public.profiles(id), department_id uuid references public.departments(id),
  start_date date, end_date date, status text not null default 'planning' check(status in ('planning','active','on_hold','completed','cancelled')),
  budget numeric(14,2), currency text not null default 'UGX', funding_source text, location text,
  target_beneficiaries integer, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  access_level text not null default 'member' check(access_level in ('manager','member','viewer')),
  primary key(project_id, profile_id)
);
create table if not exists public.project_permissions (
  project_id uuid not null references public.projects(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key(project_id, profile_id, permission_id)
);
create table if not exists public.project_objectives (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  title text not null, description text, sort_order int not null default 0
);
create table if not exists public.project_outcomes (
  id uuid primary key default gen_random_uuid(), objective_id uuid not null references public.project_objectives(id) on delete cascade,
  title text not null, description text, sort_order int not null default 0
);
create table if not exists public.project_outputs (
  id uuid primary key default gen_random_uuid(), outcome_id uuid not null references public.project_outcomes(id) on delete cascade,
  title text not null, description text, sort_order int not null default 0
);
create table if not exists public.project_activities (
  id uuid primary key default gen_random_uuid(), output_id uuid not null references public.project_outputs(id) on delete cascade,
  title text not null, description text, start_date date, end_date date, status text not null default 'planned'
);
create table if not exists public.project_milestones (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  title text not null, due_date date, completed_at timestamptz, status text not null default 'upcoming'
);
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  activity_id uuid references public.project_activities(id), parent_task_id uuid references public.tasks(id),
  title text not null, description text, priority text not null default 'medium' check(priority in ('low','medium','high','urgent')),
  status text not null default 'not_started' check(status in ('not_started','assigned','in_progress','pending_review','returned','completed','approved','delayed','cancelled')),
  progress smallint not null default 0 check(progress between 0 and 100), start_date date, due_date date,
  created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.task_assignments (
  task_id uuid not null references public.tasks(id) on delete cascade, profile_id uuid not null references public.profiles(id) on delete cascade,
  assignment_type text not null default 'assignee' check(assignment_type in ('assignee','support')), primary key(task_id, profile_id)
);
create table if not exists public.task_dependencies (
  task_id uuid not null references public.tasks(id) on delete cascade, depends_on_task_id uuid not null references public.tasks(id) on delete cascade,
  primary key(task_id, depends_on_task_id), check(task_id <> depends_on_task_id)
);
create table if not exists public.task_updates (
  id uuid primary key default gen_random_uuid(), task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null references public.profiles(id), progress smallint check(progress between 0 and 100), note text not null,
  evidence_url text, created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(), project_id uuid references public.projects(id), author_id uuid not null references public.profiles(id),
  team_id uuid references public.teams(id), report_type text not null default 'weekly', period_start date, period_end date,
  status text not null default 'draft' check(status in ('draft','submitted','returned','approved','rejected')),
  activities jsonb not null default '[]', deliverables jsonb not null default '[]', progress numeric(5,2),
  achievements text, challenges text, risks text, lessons text, planned_activities text, support_required text,
  submitted_at timestamptz, reviewed_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.report_reviews (
  id uuid primary key default gen_random_uuid(), report_id uuid not null references public.reports(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id), decision text not null check(decision in ('comment','return','approve','reject')),
  comment text, created_at timestamptz not null default now()
);
create table if not exists public.report_attachments (
  id uuid primary key default gen_random_uuid(), report_id uuid not null references public.reports(id) on delete cascade,
  storage_path text not null, file_name text not null, uploaded_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);

create table if not exists public.indicators (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  objective_id uuid references public.project_objectives(id), output_id uuid references public.project_outputs(id),
  name text not null, description text, unit text, baseline numeric, target numeric, current_value numeric,
  data_source text, frequency text, responsible_id uuid references public.profiles(id), verification_method text, created_at timestamptz not null default now()
);
create table if not exists public.indicator_measurements (
  id uuid primary key default gen_random_uuid(), indicator_id uuid not null references public.indicators(id) on delete cascade,
  value numeric not null, measured_on date not null, notes text, evidence_url text, measured_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create table if not exists public.evaluation_templates (
  id uuid primary key default gen_random_uuid(), name text not null, description text, created_by uuid references public.profiles(id), created_at timestamptz not null default now()
);
create table if not exists public.evaluations (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  template_id uuid references public.evaluation_templates(id), title text not null,
  stage text not null check(stage in ('baseline','midline','endline','post_project')), status text not null default 'planned',
  lead_id uuid references public.profiles(id), due_date date, executive_summary text, methodology text,
  findings text, challenges text, lessons text, created_at timestamptz not null default now()
);
create table if not exists public.evaluation_results (
  id uuid primary key default gen_random_uuid(), evaluation_id uuid not null references public.evaluations(id) on delete cascade,
  criterion text not null, rating numeric(4,2), narrative text, evidence_url text
);
create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(), evaluation_id uuid not null references public.evaluations(id) on delete cascade,
  title text not null, description text, assignee_id uuid references public.profiles(id), team_id uuid references public.teams(id),
  due_date date, status text not null default 'open' check(status in ('open','in_progress','complete','cancelled'))
);

create table if not exists public.risks (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  title text not null, description text, probability smallint check(probability between 1 and 5), impact smallint check(impact between 1 and 5),
  owner_id uuid references public.profiles(id), mitigation text, status text not null default 'open', created_at timestamptz not null default now()
);
create table if not exists public.issues (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  title text not null, description text, responsible_id uuid references public.profiles(id), impact text,
  required_action text, deadline date, resolution text, status text not null default 'open', created_at timestamptz not null default now()
);
create table if not exists public.project_budgets (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  name text not null, amount numeric(14,2) not null, currency text not null default 'UGX'
);
create table if not exists public.expenditures (
  id uuid primary key default gen_random_uuid(), budget_id uuid not null references public.project_budgets(id) on delete cascade,
  amount numeric(14,2) not null, description text, spent_on date not null, status text not null default 'submitted', submitted_by uuid references public.profiles(id)
);
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null, title text not null, body text, entity_type text, entity_id uuid, read_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles(id), action text not null,
  entity_type text not null, entity_id uuid, old_value jsonb, new_value jsonb, request_meta jsonb not null default '{}', created_at timestamptz not null default now()
);

-- Security-definer helpers avoid recursive RLS while keeping authorization centralized.
create or replace function public.has_permission(permission_key text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_active
    and (exists(select 1 from public.profile_roles pr join public.roles r on r.id=pr.role_id where pr.profile_id=p.id and r.name='Super Administrator')
      or (case when exists(select 1 from public.user_permissions up join public.permissions x on x.id=up.permission_id where up.profile_id=p.id and x.key=permission_key)
        then exists(select 1 from public.user_permissions up join public.permissions x on x.id=up.permission_id where up.profile_id=p.id and x.key=permission_key and up.granted)
        else (exists(select 1 from public.profile_roles pr join public.role_permissions rp on rp.role_id=pr.role_id join public.permissions x on x.id=rp.permission_id where pr.profile_id=p.id and x.key=permission_key)
          or exists(select 1 from public.team_members tm join public.team_permissions tp on tp.team_id=tm.team_id join public.permissions x on x.id=tp.permission_id where tm.profile_id=p.id and x.key=permission_key)) end))
  );
$$;
create or replace function public.has_team_access(target_team uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.has_permission('system.manage') or exists(select 1 from public.team_members where team_id=target_team and profile_id=auth.uid());
$$;
create or replace function public.can_access_project(target_project uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.has_permission('projects.view_all') or public.has_permission('system.manage') or exists(
    select 1 from public.projects p where p.id=target_project and (p.manager_id=auth.uid() or exists(select 1 from public.project_members pm where pm.project_id=p.id and pm.profile_id=auth.uid())
      or exists(select 1 from public.project_permissions pp join public.permissions x on x.id=pp.permission_id where pp.project_id=p.id and pp.profile_id=auth.uid() and x.key in ('projects.view','projects.view_all')))
  );
$$;
create or replace function public.can_review_report(target_report uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
 select public.has_permission('reports.review') or public.has_permission('system.manage') or exists(
   select 1 from public.reports r join public.team_members tm on tm.team_id=r.team_id and tm.profile_id=auth.uid() and tm.team_role='lead' where r.id=target_report
 ) or exists(select 1 from public.reports r where r.id=target_report and r.project_id is not null and public.can_access_project(r.project_id) and public.has_permission('reports.approve'));
$$;

-- Permission catalog and starter role presets. Administrators can extend these records.
insert into public.permissions(key,description) values
('dashboard.view','View dashboard'),('analytics.view','View analytics'),('projects.view','View permitted projects'),('projects.view_all','View all projects'),('projects.create','Create projects'),('projects.edit','Edit projects'),('projects.delete','Delete projects'),('projects.assign','Assign project access'),
('tasks.view','View permitted tasks'),('tasks.create','Create tasks'),('tasks.edit','Edit tasks'),('tasks.assign','Assign tasks'),('tasks.complete','Complete assigned tasks'),('tasks.approve','Approve task completion'),
('reports.view','View permitted reports'),('reports.create','Create reports'),('reports.edit','Edit own reports'),('reports.submit','Submit reports'),('reports.review','Review team reports'),('reports.approve','Approve reports'),('reports.reject','Reject reports'),('reports.compile','Compile team reports'),
('evaluations.view','View evaluations'),('evaluations.create','Create evaluations'),('evaluations.edit','Edit evaluations'),('evaluations.conduct','Conduct evaluations'),('evaluations.approve','Approve evaluations'),('evaluations.publish','Publish evaluations'),
('indicators.view','View indicators'),('indicators.create','Create indicators'),('indicators.edit','Edit indicators'),('indicators.measure','Record measurements'),('teams.view','View teams'),('teams.create','Create teams'),('teams.edit','Edit teams'),('teams.manage_members','Manage team membership'),
('users.view','View users'),('users.create','Create users'),('users.edit','Edit users'),('users.disable','Disable users'),('users.assign_roles','Assign roles'),('finance.view','View finance'),('finance.create','Create finance records'),('finance.edit','Edit finance records'),('finance.approve','Approve expenditures'),('audit_logs.view','View audit logs'),('system.manage','Manage organization settings')
on conflict(key) do nothing;
insert into public.roles(name,description,is_system) values
('Super Administrator','Full organization and system access',true),('Management','Organization-wide oversight',true),('Project Manager','Manage assigned projects and delivery',true),('Team Lead','Coordinate team delivery and review reports',true),('Team Member','Execute assigned tasks and submit reports',true),('MEAL Officer','Manage indicators and evaluations',true),('Finance Officer','Manage project budgets and expenditure',true),('Viewer','Read-only access to assigned areas',true)
on conflict(name) do nothing;
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r cross join public.permissions p
where (r.name='Super Administrator')
or (r.name='Management' and p.key in ('dashboard.view','analytics.view','projects.view_all','tasks.view','reports.view','evaluations.view','indicators.view','teams.view','finance.view'))
or (r.name='Project Manager' and p.key in ('dashboard.view','projects.view','projects.edit','projects.assign','tasks.view','tasks.create','tasks.edit','tasks.assign','tasks.approve','reports.view','reports.review','reports.approve','reports.compile','evaluations.view','evaluations.create','indicators.view','teams.view'))
or (r.name='Team Lead' and p.key in ('dashboard.view','projects.view','tasks.view','tasks.assign','tasks.approve','reports.view','reports.review','reports.approve','reports.compile','teams.view'))
or (r.name='Team Member' and p.key in ('dashboard.view','projects.view','tasks.view','tasks.complete','reports.view','reports.create','reports.edit','reports.submit','indicators.view'))
or (r.name='MEAL Officer' and p.key in ('dashboard.view','analytics.view','projects.view','reports.view','evaluations.view','evaluations.create','evaluations.edit','evaluations.conduct','evaluations.approve','evaluations.publish','indicators.view','indicators.create','indicators.edit','indicators.measure'))
or (r.name='Finance Officer' and p.key in ('dashboard.view','projects.view','finance.view','finance.create','finance.edit','finance.approve'))
or (r.name='Viewer' and p.key in ('dashboard.view','projects.view','tasks.view','reports.view','evaluations.view','indicators.view','teams.view'))
on conflict do nothing;

-- Enable RLS on all user-facing tables. Policies are intentionally explicit and default-deny.
do $$ declare t text; begin
  foreach t in array array['departments','roles','permissions','profiles','profile_roles','role_permissions','teams','team_members','team_permissions','user_permissions','projects','project_members','project_permissions','project_objectives','project_outcomes','project_outputs','project_activities','project_milestones','tasks','task_assignments','task_dependencies','task_updates','reports','report_reviews','report_attachments','indicators','indicator_measurements','evaluation_templates','evaluations','evaluation_results','recommendations','risks','issues','project_budgets','expenditures','notifications','audit_logs'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy "profiles read self or authorized" on public.profiles for select to authenticated using (id=auth.uid() or public.has_permission('users.view') or public.has_permission('system.manage'));
create policy "profiles admin update" on public.profiles for update to authenticated using (public.has_permission('users.edit') or public.has_permission('system.manage')) with check (public.has_permission('users.edit') or public.has_permission('system.manage'));
create policy "profiles own read" on public.profiles for insert to authenticated with check (id=auth.uid());
create policy "roles visible to signed in" on public.roles for select to authenticated using (true);
create policy "roles admin manage" on public.roles for all to authenticated using (public.has_permission('system.manage')) with check (public.has_permission('system.manage'));
create policy "permissions visible to signed in" on public.permissions for select to authenticated using (true);
create policy "permissions admin manage" on public.permissions for all to authenticated using (public.has_permission('system.manage')) with check (public.has_permission('system.manage'));
create policy "departments read authorized" on public.departments for select to authenticated using (public.has_permission('system.manage') or public.has_permission('projects.view_all') or exists(select 1 from public.profiles p where p.id=auth.uid() and p.department_id=departments.id));
create policy "departments manage" on public.departments for all to authenticated using (public.has_permission('system.manage')) with check (public.has_permission('system.manage'));
create policy "profile roles self or admin read" on public.profile_roles for select to authenticated using (profile_id=auth.uid() or public.has_permission('users.view') or public.has_permission('system.manage'));
create policy "profile roles admin manage" on public.profile_roles for all to authenticated using (public.has_permission('users.assign_roles') or public.has_permission('system.manage')) with check (public.has_permission('users.assign_roles') or public.has_permission('system.manage'));
create policy "teams read membership" on public.teams for select to authenticated using (public.has_permission('teams.view') or public.has_permission('system.manage') or public.has_team_access(id));
create policy "teams manage" on public.teams for all to authenticated using (public.has_permission('teams.create') or public.has_permission('system.manage')) with check (public.has_permission('teams.create') or public.has_permission('system.manage'));
create policy "team members scoped read" on public.team_members for select to authenticated using (profile_id=auth.uid() or public.has_permission('system.manage') or public.has_team_access(team_id));
create policy "team members manage" on public.team_members for all to authenticated using (public.has_permission('teams.manage_members') or public.has_permission('system.manage')) with check (public.has_permission('teams.manage_members') or public.has_permission('system.manage'));
create policy "team permissions admin" on public.team_permissions for all to authenticated using (public.has_permission('system.manage')) with check (public.has_permission('system.manage'));
create policy "team permissions read members" on public.team_permissions for select to authenticated using (public.has_team_access(team_id));
create policy "user permissions own or admin read" on public.user_permissions for select to authenticated using (profile_id=auth.uid() or public.has_permission('system.manage'));
create policy "user permissions admin manage" on public.user_permissions for all to authenticated using (public.has_permission('system.manage')) with check (public.has_permission('system.manage'));
create policy "projects scoped read" on public.projects for select to authenticated using (public.can_access_project(id));
create policy "projects create" on public.projects for insert to authenticated with check (public.has_permission('projects.create') or public.has_permission('system.manage'));
create policy "projects update" on public.projects for update to authenticated using ((public.can_access_project(id) and public.has_permission('projects.edit')) or public.has_permission('system.manage')) with check ((public.can_access_project(id) and public.has_permission('projects.edit')) or public.has_permission('system.manage'));
create policy "projects delete" on public.projects for delete to authenticated using (public.has_permission('projects.delete') or public.has_permission('system.manage'));
create policy "project members scoped read" on public.project_members for select to authenticated using (profile_id=auth.uid() or public.can_access_project(project_id));
create policy "project members manage" on public.project_members for all to authenticated using ((public.can_access_project(project_id) and public.has_permission('projects.assign')) or public.has_permission('system.manage')) with check ((public.can_access_project(project_id) and public.has_permission('projects.assign')) or public.has_permission('system.manage'));
create policy "project permissions admin" on public.project_permissions for all to authenticated using (public.has_permission('system.manage') or (public.can_access_project(project_id) and public.has_permission('projects.assign'))) with check (public.has_permission('system.manage') or (public.can_access_project(project_id) and public.has_permission('projects.assign')));
create policy "objectives scoped" on public.project_objectives for all to authenticated using (public.can_access_project(project_id)) with check (public.can_access_project(project_id) and public.has_permission('projects.edit'));
create policy "outcomes scoped" on public.project_outcomes for all to authenticated using (exists(select 1 from public.project_objectives o where o.id=objective_id and public.can_access_project(o.project_id))) with check (exists(select 1 from public.project_objectives o where o.id=objective_id and public.can_access_project(o.project_id) and public.has_permission('projects.edit')));
create policy "outputs scoped" on public.project_outputs for all to authenticated using (exists(select 1 from public.project_outcomes o join public.project_objectives b on b.id=o.objective_id where o.id=outcome_id and public.can_access_project(b.project_id))) with check (exists(select 1 from public.project_outcomes o join public.project_objectives b on b.id=o.objective_id where o.id=outcome_id and public.can_access_project(b.project_id) and public.has_permission('projects.edit')));
create policy "activities scoped" on public.project_activities for all to authenticated using (exists(select 1 from public.project_outputs o join public.project_outcomes b on b.id=o.outcome_id join public.project_objectives j on j.id=b.objective_id where o.id=output_id and public.can_access_project(j.project_id))) with check (exists(select 1 from public.project_outputs o join public.project_outcomes b on b.id=o.outcome_id join public.project_objectives j on j.id=b.objective_id where o.id=output_id and public.can_access_project(j.project_id) and public.has_permission('projects.edit')));
create policy "milestones scoped" on public.project_milestones for all to authenticated using (public.can_access_project(project_id)) with check (public.can_access_project(project_id) and public.has_permission('projects.edit'));
create policy "tasks scoped read" on public.tasks for select to authenticated using (public.can_access_project(project_id) and (public.has_permission('tasks.view') or exists(select 1 from public.task_assignments a where a.task_id=id and a.profile_id=auth.uid())));
create policy "tasks scoped create" on public.tasks for insert to authenticated with check (public.can_access_project(project_id) and public.has_permission('tasks.create'));
create policy "tasks scoped update" on public.tasks for update to authenticated using (public.can_access_project(project_id) and (public.has_permission('tasks.edit') or (public.has_permission('tasks.complete') and exists(select 1 from public.task_assignments a where a.task_id=id and a.profile_id=auth.uid())))) with check (public.can_access_project(project_id));
create policy "tasks scoped delete" on public.tasks for delete to authenticated using (public.can_access_project(project_id) and (public.has_permission('tasks.edit') or public.has_permission('system.manage')));
create policy "assignments scoped" on public.task_assignments for select to authenticated using (profile_id=auth.uid() or exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id) and public.has_permission('tasks.view')));
create policy "assignments manage" on public.task_assignments for all to authenticated using (exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id) and public.has_permission('tasks.assign'))) with check (exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id) and public.has_permission('tasks.assign')));
create policy "task dependencies scoped" on public.task_dependencies for all to authenticated using (exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id))) with check (exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id) and public.has_permission('tasks.edit')));
create policy "task updates scoped" on public.task_updates for select to authenticated using (author_id=auth.uid() or exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id) and public.has_permission('tasks.view')));
create policy "task update author insert" on public.task_updates for insert to authenticated with check (author_id=auth.uid() and exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id) and exists(select 1 from public.task_assignments a where a.task_id=t.id and a.profile_id=auth.uid())));
create policy "reports scoped read" on public.reports for select to authenticated using (author_id=auth.uid() or public.has_permission('system.manage') or (team_id is not null and public.has_team_access(team_id) and public.has_permission('reports.view')) or (project_id is not null and public.can_access_project(project_id) and public.has_permission('reports.view')));
create policy "reports author create" on public.reports for insert to authenticated with check (author_id=auth.uid() and public.has_permission('reports.create'));
create policy "reports author update draft" on public.reports for update to authenticated using ((author_id=auth.uid() and status in ('draft','returned') and public.has_permission('reports.edit')) or public.can_review_report(id)) with check (author_id=auth.uid() or public.can_review_report(id));
create policy "reports author or reviewer delete" on public.reports for delete to authenticated using ((author_id=auth.uid() and status='draft') or public.has_permission('system.manage'));
create policy "report reviews scoped" on public.report_reviews for select to authenticated using (exists(select 1 from public.reports r where r.id=report_id and (r.author_id=auth.uid() or public.can_review_report(r.id))));
create policy "report reviews reviewers create" on public.report_reviews for insert to authenticated with check (reviewer_id=auth.uid() and public.can_review_report(report_id));
create policy "report attachments scoped" on public.report_attachments for select to authenticated using (exists(select 1 from public.reports r where r.id=report_id and (r.author_id=auth.uid() or public.can_review_report(r.id))));
create policy "report attachments author create" on public.report_attachments for insert to authenticated with check (uploaded_by=auth.uid() and exists(select 1 from public.reports r where r.id=report_id and r.author_id=auth.uid()));
create policy "indicators scoped read" on public.indicators for select to authenticated using (public.can_access_project(project_id) and public.has_permission('indicators.view'));
create policy "indicators scoped write" on public.indicators for all to authenticated using (public.can_access_project(project_id) and public.has_permission('indicators.edit')) with check (public.can_access_project(project_id) and (public.has_permission('indicators.edit') or public.has_permission('indicators.create')));
create policy "measurements scoped read" on public.indicator_measurements for select to authenticated using (exists(select 1 from public.indicators i where i.id=indicator_id and public.can_access_project(i.project_id) and public.has_permission('indicators.view')));
create policy "measurements author write" on public.indicator_measurements for insert to authenticated with check (measured_by=auth.uid() and public.has_permission('indicators.measure') and exists(select 1 from public.indicators i where i.id=indicator_id and public.can_access_project(i.project_id)));
create policy "evaluation templates read" on public.evaluation_templates for select to authenticated using (auth.uid() is not null);
create policy "evaluation templates manage" on public.evaluation_templates for all to authenticated using (public.has_permission('system.manage') or public.has_permission('evaluations.create')) with check (public.has_permission('system.manage') or public.has_permission('evaluations.create'));
create policy "evaluations scoped read" on public.evaluations for select to authenticated using (public.can_access_project(project_id) and public.has_permission('evaluations.view'));
create policy "evaluations scoped write" on public.evaluations for all to authenticated using (public.can_access_project(project_id) and public.has_permission('evaluations.edit')) with check (public.can_access_project(project_id) and (public.has_permission('evaluations.edit') or public.has_permission('evaluations.create')));
create policy "evaluation results scoped" on public.evaluation_results for all to authenticated using (exists(select 1 from public.evaluations e where e.id=evaluation_id and public.can_access_project(e.project_id) and public.has_permission('evaluations.view'))) with check (exists(select 1 from public.evaluations e where e.id=evaluation_id and public.can_access_project(e.project_id) and public.has_permission('evaluations.conduct')));
create policy "recommendations scoped" on public.recommendations for all to authenticated using (assignee_id=auth.uid() or exists(select 1 from public.evaluations e where e.id=evaluation_id and public.can_access_project(e.project_id) and public.has_permission('evaluations.view'))) with check (exists(select 1 from public.evaluations e where e.id=evaluation_id and public.can_access_project(e.project_id) and public.has_permission('evaluations.edit')));
create policy "risks scoped" on public.risks for all to authenticated using (owner_id=auth.uid() or (public.can_access_project(project_id) and public.has_permission('projects.view'))) with check (public.can_access_project(project_id) and public.has_permission('projects.edit'));
create policy "issues scoped" on public.issues for all to authenticated using (responsible_id=auth.uid() or (public.can_access_project(project_id) and public.has_permission('projects.view'))) with check (public.can_access_project(project_id) and public.has_permission('projects.edit'));
create policy "budget scoped read" on public.project_budgets for select to authenticated using (public.can_access_project(project_id) and public.has_permission('finance.view'));
create policy "budget finance manage" on public.project_budgets for all to authenticated using (public.can_access_project(project_id) and public.has_permission('finance.edit')) with check (public.can_access_project(project_id) and public.has_permission('finance.edit'));
create policy "expenditures finance read" on public.expenditures for select to authenticated using (exists(select 1 from public.project_budgets b where b.id=budget_id and public.can_access_project(b.project_id) and public.has_permission('finance.view')));
create policy "expenditures finance write" on public.expenditures for all to authenticated using (exists(select 1 from public.project_budgets b where b.id=budget_id and public.can_access_project(b.project_id) and public.has_permission('finance.edit'))) with check (exists(select 1 from public.project_budgets b where b.id=budget_id and public.can_access_project(b.project_id) and (public.has_permission('finance.edit') or public.has_permission('finance.create'))));
create policy "notifications owner read" on public.notifications for select to authenticated using (profile_id=auth.uid() or public.has_permission('system.manage'));
create policy "notifications owner update" on public.notifications for update to authenticated using (profile_id=auth.uid()) with check (profile_id=auth.uid());
create policy "notifications system create" on public.notifications for insert to authenticated with check (public.has_permission('system.manage') or profile_id=auth.uid());
create policy "audit logs authorized read" on public.audit_logs for select to authenticated using (public.has_permission('audit_logs.view') or public.has_permission('system.manage'));
create policy "audit logs actor append" on public.audit_logs for insert to authenticated with check (actor_id=auth.uid());
-- Audit rows are append-only: no update/delete policies are intentionally defined.
