-- Extend the existing delivery, team and report records without replacing their tables.
alter table public.profiles add column if not exists job_title text;
alter table public.profiles add column if not exists reports_to uuid references public.profiles(id);

create table if not exists public.profile_private_details (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  phone text,
  emergency_contact text,
  notes text,
  updated_at timestamptz not null default now()
);
alter table public.profile_private_details enable row level security;
create policy "private member data scoped" on public.profile_private_details for select to authenticated using (profile_id=auth.uid() or public.has_permission('users.view') or public.has_permission('system.manage'));
create policy "private member data manage" on public.profile_private_details for all to authenticated using (public.has_permission('users.edit') or public.has_permission('system.manage')) with check (public.has_permission('users.edit') or public.has_permission('system.manage'));

alter table public.tasks add column if not exists team_id uuid references public.teams(id);
alter table public.tasks add column if not exists reviewer_id uuid references public.profiles(id);
alter table public.tasks add column if not exists objective_id uuid references public.project_objectives(id);
alter table public.tasks add column if not exists output_id uuid references public.project_outputs(id);
alter table public.tasks add column if not exists completed_at timestamptz;
alter table public.tasks add column if not exists expected_deliverable text;
alter table public.tasks add column if not exists blocker text;
alter table public.tasks add column if not exists checklist jsonb not null default '[]';
alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks add constraint tasks_status_check check(status in ('not_started','assigned','in_progress','pending_review','changes_requested','returned','completed','approved','blocked','delayed','cancelled'));

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(), task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null references public.profiles(id), body text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(), task_id uuid not null references public.tasks(id) on delete cascade,
  storage_path text not null, file_name text not null, uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.task_comments enable row level security;
alter table public.task_attachments enable row level security;
create policy "task comments scoped read" on public.task_comments for select to authenticated using (exists(select 1 from public.tasks t where t.id=task_id and (public.can_access_project(t.project_id) or exists(select 1 from public.task_assignments a where a.task_id=t.id and a.profile_id=auth.uid()) or (t.team_id is not null and public.has_team_access(t.team_id)))));
create policy "task comments scoped create" on public.task_comments for insert to authenticated with check (author_id=auth.uid() and exists(select 1 from public.tasks t where t.id=task_id and ((public.can_access_project(t.project_id) and public.has_permission('tasks.edit')) or exists(select 1 from public.task_assignments a where a.task_id=t.id and a.profile_id=auth.uid()))));
create policy "task attachments scoped read" on public.task_attachments for select to authenticated using (exists(select 1 from public.tasks t where t.id=task_id and (public.can_access_project(t.project_id) or exists(select 1 from public.task_assignments a where a.task_id=t.id and a.profile_id=auth.uid()) or (t.team_id is not null and public.has_team_access(t.team_id)))));
create policy "task attachments scoped create" on public.task_attachments for insert to authenticated with check (uploaded_by=auth.uid() and exists(select 1 from public.tasks t where t.id=task_id and ((public.can_access_project(t.project_id) and public.has_permission('tasks.edit')) or exists(select 1 from public.task_assignments a where a.task_id=t.id and a.profile_id=auth.uid()))));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('task-evidence','task-evidence',false,15728640,array['application/pdf','image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy "task evidence scoped read" on storage.objects for select to authenticated using (
  bucket_id='task-evidence' and exists(select 1 from public.tasks t where t.id::text=(storage.foldername(name))[1] and (public.can_access_project(t.project_id) or exists(select 1 from public.task_assignments a where a.task_id=t.id and a.profile_id=auth.uid()) or (t.team_id is not null and public.has_team_access(t.team_id))))
);
create policy "task evidence scoped upload" on storage.objects for insert to authenticated with check (
  bucket_id='task-evidence' and exists(select 1 from public.tasks t where t.id::text=(storage.foldername(name))[1] and ((public.can_access_project(t.project_id) and public.has_permission('tasks.edit')) or exists(select 1 from public.task_assignments a where a.task_id=t.id and a.profile_id=auth.uid())))
);
drop policy if exists "task updates scoped" on public.task_updates;
create policy "task updates scoped" on public.task_updates for select to authenticated using (author_id=auth.uid() or exists(select 1 from public.tasks t where t.id=task_id and (public.can_access_project(t.project_id) or exists(select 1 from public.task_assignments a where a.task_id=t.id and a.profile_id=auth.uid()) or (t.team_id is not null and public.has_team_access(t.team_id)))));
drop policy if exists "task update author insert" on public.task_updates;
create policy "task update author insert" on public.task_updates for insert to authenticated with check (author_id=auth.uid() and public.has_permission('tasks.complete') and exists(select 1 from public.task_assignments a where a.task_id=task_id and a.profile_id=auth.uid()));
drop policy if exists "task dependencies scoped" on public.task_dependencies;
create policy "task dependencies scoped read" on public.task_dependencies for select to authenticated using (
  exists(select 1 from public.tasks t join public.tasks dependency on dependency.id=depends_on_task_id and dependency.project_id=t.project_id where t.id=task_id and public.can_access_project(t.project_id))
);
create policy "task dependencies scoped manage" on public.task_dependencies for all to authenticated using (
  public.has_permission('tasks.edit') and exists(select 1 from public.tasks t join public.tasks dependency on dependency.id=depends_on_task_id and dependency.project_id=t.project_id where t.id=task_id and public.can_access_project(t.project_id))
) with check (
  public.has_permission('tasks.edit') and exists(select 1 from public.tasks t join public.tasks dependency on dependency.id=depends_on_task_id and dependency.project_id=t.project_id where t.id=task_id and public.can_access_project(t.project_id))
);
create policy "task reviewer update" on public.tasks for update to authenticated using (
  public.has_permission('tasks.review') and (public.can_access_project(project_id) or reviewer_id=auth.uid() or (team_id is not null and public.has_team_access(team_id)))
  and (reviewer_id=auth.uid() or public.has_permission('system.manage') or exists(select 1 from public.projects p where p.id=project_id and p.manager_id=auth.uid()) or exists(select 1 from public.team_members tm where tm.team_id=tasks.team_id and tm.profile_id=auth.uid() and tm.team_role='lead'))
) with check(public.can_access_project(project_id) or (team_id is not null and public.has_team_access(team_id)));
create or replace function public.validate_task_transition()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.can_access_project(old.project_id) and (
    (to_jsonb(old) - 'progress' - 'status' - 'blocker' - 'checklist' - 'completed_at' - 'updated_at') is distinct from
    (to_jsonb(new) - 'progress' - 'status' - 'blocker' - 'checklist' - 'completed_at' - 'updated_at')
  ) then raise exception 'Assigned members can update progress and evidence, not change the task assignment'; end if;
  if new.status is distinct from old.status then
    if old.status='pending_review' and new.status in ('approved','completed','changes_requested') and not (
      public.has_permission('system.manage') or (public.has_permission('tasks.review') and old.reviewer_id=auth.uid()) or
      (public.has_permission('tasks.review') and (exists(select 1 from public.projects p where p.id=new.project_id and p.manager_id=auth.uid()) or exists(select 1 from public.team_members tm where tm.team_id=new.team_id and tm.profile_id=auth.uid() and tm.team_role='lead')))
    ) then raise exception 'Only the assigned reviewer or project manager can decide this task'; end if;
    if new.status='pending_review' and not (
      public.has_permission('tasks.edit') or (public.has_permission('tasks.complete') and exists(select 1 from public.task_assignments a where a.task_id=old.id and a.profile_id=auth.uid()))
    ) then raise exception 'Only an authorized assignee can submit this task for review'; end if;
    if new.status='completed' and not public.has_permission('tasks.review') then raise exception 'Submit work for review before marking it complete'; end if;
  end if;
  if new.status in ('approved','completed') and old.status is distinct from new.status then new.completed_at=coalesce(new.completed_at,now()); end if;
  return new;
end $$;
drop trigger if exists tasks_validate_transition on public.tasks;
create trigger tasks_validate_transition before update on public.tasks for each row execute function public.validate_task_transition();
create or replace function public.validate_task_planning_links()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.objective_id is not null and not exists(select 1 from public.project_objectives o where o.id=new.objective_id and o.project_id=new.project_id) then raise exception 'Objective must belong to the selected project'; end if;
  if new.output_id is not null and not exists(select 1 from public.project_outputs o join public.project_outcomes x on x.id=o.outcome_id join public.project_objectives j on j.id=x.objective_id where o.id=new.output_id and j.project_id=new.project_id) then raise exception 'Output must belong to the selected project'; end if;
  if new.activity_id is not null and not exists(select 1 from public.project_activities a join public.project_outputs o on o.id=a.output_id join public.project_outcomes x on x.id=o.outcome_id join public.project_objectives j on j.id=x.objective_id where a.id=new.activity_id and j.project_id=new.project_id) then raise exception 'Activity must belong to the selected project'; end if;
  return new;
end $$;
drop trigger if exists tasks_validate_planning_links on public.tasks;
create trigger tasks_validate_planning_links before insert or update on public.tasks for each row execute function public.validate_task_planning_links();
drop policy if exists "tasks scoped create" on public.tasks;
create policy "tasks scoped create" on public.tasks for insert to authenticated with check (
  public.can_access_project(project_id) and public.has_permission('tasks.create')
  and (team_id is null or public.has_team_access(team_id))
  and (reviewer_id is null or (public.has_permission('tasks.assign') and (exists(select 1 from public.projects p where p.id=project_id and p.manager_id=reviewer_id) or exists(select 1 from public.project_members pm where pm.project_id=project_id and pm.profile_id=reviewer_id) or (team_id is not null and exists(select 1 from public.team_members tm where tm.team_id=team_id and tm.profile_id=reviewer_id)))))
);
drop policy if exists "assignments manage" on public.task_assignments;
drop policy if exists "assignments manage scoped" on public.task_assignments;
create policy "assignments manage scoped" on public.task_assignments for all to authenticated using (
  exists(select 1 from public.tasks t where t.id=task_id and (public.can_access_project(t.project_id) or (t.team_id is not null and public.has_team_access(t.team_id))) and public.has_permission('tasks.assign'))
) with check (
  exists(select 1 from public.tasks t where t.id=task_id and (public.can_access_project(t.project_id) or (t.team_id is not null and public.has_team_access(t.team_id))) and public.has_permission('tasks.assign')
    and (public.has_permission('system.manage') or exists(select 1 from public.project_members pm where pm.project_id=t.project_id and pm.profile_id=task_assignments.profile_id) or exists(select 1 from public.projects p where p.id=t.project_id and p.manager_id=task_assignments.profile_id) or (t.team_id is not null and exists(select 1 from public.team_members tm where tm.team_id=t.team_id and tm.profile_id=task_assignments.profile_id))))
);
drop policy if exists "tasks scoped read" on public.tasks;
create policy "tasks scoped read" on public.tasks for select to authenticated using (
  (public.can_access_project(project_id) and (public.has_permission('tasks.view') or exists(select 1 from public.task_assignments a where a.task_id=id and a.profile_id=auth.uid())))
  or exists(select 1 from public.task_assignments a where a.task_id=id and a.profile_id=auth.uid())
  or (team_id is not null and public.has_permission('tasks.view') and public.has_team_access(team_id))
  or (reviewer_id=auth.uid() and public.has_permission('tasks.review'))
);
create policy "tasks assigned member update" on public.tasks for update to authenticated using (
  public.has_permission('tasks.complete') and exists(select 1 from public.task_assignments a where a.task_id=id and a.profile_id=auth.uid())
) with check (exists(select 1 from public.task_assignments a where a.task_id=id and a.profile_id=auth.uid()));

create or replace function public.audit_task_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (to_jsonb(old) - 'updated_at') is distinct from (to_jsonb(new) - 'updated_at') then
    insert into public.task_updates(task_id,author_id,progress,note)
    values(new.id,auth.uid(),new.progress,'Task updated: ' || coalesce(new.status,'status changed'));
  end if;
  return new;
end $$;
drop trigger if exists tasks_audit_change on public.tasks;
create trigger tasks_audit_change after update on public.tasks for each row execute function public.audit_task_change();

alter table public.reports add column if not exists title text;
alter table public.reports add column if not exists task_id uuid references public.tasks(id);
alter table public.reports add column if not exists activity_id uuid references public.project_activities(id);
alter table public.reports add column if not exists submission_date date;
alter table public.reports add column if not exists outputs jsonb not null default '[]';
alter table public.reports add column if not exists incidents text;
alter table public.reports add column if not exists recommendations text;
alter table public.reports add column if not exists verified boolean not null default false;
update public.reports set title=initcap(replace(report_type,'_',' ')) || ' report' where title is null;
alter table public.reports alter column title set default 'Work report';
alter table public.reports alter column title set not null;
create or replace function public.validate_report_links()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.task_id is not null and not exists(select 1 from public.tasks t where t.id=new.task_id and t.project_id is not distinct from new.project_id and (t.created_by=new.author_id or exists(select 1 from public.task_assignments a where a.task_id=t.id and a.profile_id=new.author_id) or public.can_access_project(t.project_id) or (t.team_id is not null and public.has_team_access(t.team_id)))) then raise exception 'Related task must be in an authorized project or assigned team'; end if;
  if new.activity_id is not null and not exists(select 1 from public.project_activities a join public.project_outputs o on o.id=a.output_id join public.project_outcomes x on x.id=o.outcome_id join public.project_objectives j on j.id=x.objective_id where a.id=new.activity_id and j.project_id is not distinct from new.project_id and public.can_access_project(j.project_id)) then raise exception 'Related activity must belong to the selected project'; end if;
  if new.team_id is not null and not (public.has_team_access(new.team_id) or (new.project_id is not null and public.can_access_project(new.project_id))) then raise exception 'Report team is outside your team or project access'; end if;
  return new;
end $$;
drop trigger if exists reports_validate_links on public.reports;
create trigger reports_validate_links before insert or update on public.reports for each row execute function public.validate_report_links();

create table if not exists public.team_report_sources (
  team_report_id uuid not null references public.reports(id) on delete cascade,
  source_report_id uuid not null references public.reports(id) on delete cascade,
  primary key(team_report_id,source_report_id), check(team_report_id<>source_report_id)
);
alter table public.team_report_sources enable row level security;
create policy "report sources scoped read" on public.team_report_sources for select to authenticated using (exists(select 1 from public.reports r where r.id=team_report_id and (r.author_id=auth.uid() or public.can_review_report(r.id) or (r.team_id is not null and public.has_team_access(r.team_id) and public.has_permission('reports.view')) or (r.project_id is not null and public.can_access_project(r.project_id) and public.has_permission('reports.view')))));
create policy "report sources scoped create" on public.team_report_sources for insert to authenticated with check (exists(select 1 from public.reports r where r.id=team_report_id and public.can_review_report(r.id)) and exists(select 1 from public.reports parent join public.reports s on s.id=source_report_id where parent.id=team_report_id and s.status='approved' and ((parent.team_id is not null and s.team_id=parent.team_id) or (parent.project_id is not null and s.project_id=parent.project_id))));

create table if not exists public.report_change_history (
  id uuid primary key default gen_random_uuid(), report_id uuid not null references public.reports(id) on delete cascade,
  actor_id uuid references public.profiles(id), change_kind text not null, snapshot jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.report_change_history enable row level security;
create policy "report history scoped read" on public.report_change_history for select to authenticated using (exists(select 1 from public.reports r where r.id=report_id and (r.author_id=auth.uid() or public.can_review_report(r.id))));
create or replace function public.audit_report_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.report_change_history(report_id,actor_id,change_kind,snapshot)
  values(new.id,auth.uid(),case when tg_op='INSERT' then 'created' else 'updated' end,to_jsonb(new));
  return new;
end $$;
drop trigger if exists reports_audit_change on public.reports;
create trigger reports_audit_change after insert or update on public.reports for each row execute function public.audit_report_change();
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('report-evidence','report-evidence',false,15728640,array['application/pdf','image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy "report evidence scoped read" on storage.objects for select to authenticated using (
  bucket_id='report-evidence' and exists(select 1 from public.reports r where r.id::text=(storage.foldername(name))[1] and (r.author_id=auth.uid() or public.can_review_report(r.id)))
);
create policy "report evidence scoped upload" on storage.objects for insert to authenticated with check (
  bucket_id='report-evidence' and exists(select 1 from public.reports r where r.id::text=(storage.foldername(name))[1] and r.author_id=auth.uid() and r.status in ('draft','returned'))
);
drop policy if exists "report attachments author create" on public.report_attachments;
create policy "report attachments author create" on public.report_attachments for insert to authenticated with check (
  uploaded_by=auth.uid() and exists(select 1 from public.reports r where r.id=report_id and r.author_id=auth.uid() and r.status in ('draft','returned'))
);

create policy "teams edit permission" on public.teams for update to authenticated using (public.has_permission('teams.edit') or public.has_permission('system.manage')) with check (public.has_permission('teams.edit') or public.has_permission('system.manage'));
create policy "teams delete permission" on public.teams for delete to authenticated using (public.has_permission('teams.edit') or public.has_permission('system.manage'));
drop policy if exists "reports author create" on public.reports;
create policy "reports author create scoped" on public.reports for insert to authenticated with check (
  author_id=auth.uid() and public.has_permission('reports.create') and verified=false
  and (status='draft' or (status='submitted' and public.has_permission('reports.compile')))
  and (project_id is null or public.can_access_project(project_id))
  and (team_id is null or public.has_team_access(team_id))
);
drop policy if exists "reports author update draft" on public.reports;
create policy "reports author update draft" on public.reports for update to authenticated using (
  author_id=auth.uid() and status in ('draft','returned') and public.has_permission('reports.edit')
) with check (
  author_id=auth.uid() and status in ('draft','returned','submitted') and verified=false and public.has_permission('reports.edit')
  and (project_id is null or public.can_access_project(project_id)) and (team_id is null or public.has_team_access(team_id))
);
create policy "reports reviewer decision" on public.reports for update to authenticated using (
  status='submitted' and public.can_review_report(id)
) with check (
  public.can_review_report(id) and status in ('approved','returned','rejected') and reviewed_by=auth.uid() and verified=(status='approved')
);
create or replace function public.can_manage_team(target_team uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.has_permission('system.manage') or (public.has_permission('teams.manage_members') and (
    public.has_permission('teams.edit') or exists(select 1 from public.team_members tm where tm.team_id=target_team and tm.profile_id=auth.uid() and tm.team_role='lead')
  ));
$$;
drop policy if exists "team members manage" on public.team_members;
create policy "team members manage scoped" on public.team_members for all to authenticated using (public.can_manage_team(team_id)) with check (public.can_manage_team(team_id));
create policy "team members admin read" on public.team_members for select to authenticated using (public.has_permission('teams.edit') or public.has_permission('system.manage'));
create policy "profiles team scoped read" on public.profiles for select to authenticated using (
  public.has_permission('system.manage') or public.has_permission('users.view') or (public.has_permission('teams.manage_members') and exists(select 1 from public.team_members lead_member where lead_member.profile_id=auth.uid() and lead_member.team_role='lead')) or exists(
    select 1 from public.team_members mine join public.team_members theirs on theirs.team_id=mine.team_id
    where mine.profile_id=auth.uid() and theirs.profile_id=profiles.id
  ) or exists(
    select 1 from public.project_members mine join public.project_members theirs on theirs.project_id=mine.project_id
    where mine.profile_id=auth.uid() and theirs.profile_id=profiles.id
  ) or exists(
    select 1 from public.projects managed join public.project_members theirs on theirs.project_id=managed.id
    where managed.manager_id=auth.uid() and theirs.profile_id=profiles.id
  )
);

create or replace function public.can_review_report(target_report uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.has_permission('system.manage') or exists(
    select 1 from public.reports r where r.id=target_report and r.project_id is not null
      and public.can_access_project(r.project_id) and (public.has_permission('reports.review') or public.has_permission('reports.approve'))
  ) or exists(
    select 1 from public.reports r join public.team_members tm on tm.team_id=r.team_id
    where r.id=target_report and tm.profile_id=auth.uid() and tm.team_role='lead' and public.has_permission('reports.review')
  );
$$;

insert into public.permissions(key,description) values
('tasks.review','Review task completion'),('reports.compile','Compile team and project reports'),
('teams.reports','Review reports in assigned teams')
on conflict(key) do nothing;
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p on p.key in ('tasks.review','reports.review','reports.compile','teams.reports')
where r.name in ('Super Administrator','Management','Project Manager','Team Lead') on conflict do nothing;
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p on p.key in ('tasks.assign','tasks.edit','tasks.review')
where r.name='Project Manager' on conflict do nothing;
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p on p.key in ('tasks.complete','reports.create','reports.edit','reports.submit')
where r.name='Team Member' on conflict do nothing;
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p on p.key in ('reports.create','reports.edit','reports.submit')
where r.name in ('Team Lead','Project Manager') on conflict do nothing;
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p on p.key in ('tasks.create','tasks.edit','tasks.complete','teams.manage_members')
where r.name='Team Lead' on conflict do nothing;
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p on p.key in ('teams.create','teams.edit','teams.manage_members')
where r.name in ('Super Administrator','Management') on conflict do nothing;
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p on p.key in ('users.view','teams.view')
where r.name='Management' on conflict do nothing;
