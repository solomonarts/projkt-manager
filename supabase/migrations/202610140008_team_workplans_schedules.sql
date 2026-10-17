-- Team/project hierarchy, workplans, approved task creation and scheduled
-- collective delivery/MEAL reporting. Existing project/task/report records stay intact.

alter table public.teams
  add column if not exists default_project_id uuid references public.projects(id) on delete set null;

create table if not exists public.team_workplan_templates (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  version integer not null check(version > 0),
  title text not null,
  description text,
  role_deliverables jsonb not null default '[]'::jsonb check(jsonb_typeof(role_deliverables)='array'),
  storage_path text,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(team_id,version)
);
create unique index if not exists team_workplan_one_active_template
  on public.team_workplan_templates(team_id) where active;

create table if not exists public.workplans (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  template_id uuid references public.team_workplan_templates(id) on delete set null,
  submitted_by uuid not null references public.profiles(id),
  title text not null,
  period_start date not null,
  period_end date not null,
  reporting_cadence text not null default 'weekly' check(reporting_cadence in ('weekly','monthly','quarterly')),
  status text not null default 'draft' check(status in ('draft','submitted','changes_requested','approved')),
  upload_path text,
  team_lead_approved_by uuid references public.profiles(id),
  team_lead_approved_at timestamptz,
  project_manager_approved_by uuid references public.profiles(id),
  project_manager_approved_at timestamptz,
  review_comment text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(period_end >= period_start),
  check((team_lead_approved_by is null)=(team_lead_approved_at is null)),
  check((project_manager_approved_by is null)=(project_manager_approved_at is null))
);
create index if not exists workplans_team_period_idx on public.workplans(team_id,project_id,period_start,period_end);

create table if not exists public.workplan_items (
  id uuid primary key default gen_random_uuid(),
  workplan_id uuid not null references public.workplans(id) on delete cascade,
  title text not null,
  description text,
  expected_deliverable text,
  planned_start date,
  due_date date,
  meal_contribution_required boolean not null default false,
  task_id uuid references public.tasks(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  check(due_date is null or planned_start is null or due_date >= planned_start)
);
create index if not exists workplan_items_plan_sort_idx on public.workplan_items(workplan_id,sort_order);

create table if not exists public.team_reporting_schedules (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  report_type text not null check(report_type in ('team_progress','meal_collective')),
  cadence text not null check(cadence in ('once','weekly','monthly','quarterly')),
  period_start date not null,
  period_end date not null,
  next_due_on date not null,
  created_by uuid not null references public.profiles(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check(period_end >= period_start),
  unique(team_id,project_id,report_type,cadence,period_start,period_end)
);
create index if not exists team_reporting_due_idx on public.team_reporting_schedules(next_due_on) where active;

create table if not exists public.team_reporting_schedule_changes (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.team_reporting_schedules(id) on delete cascade,
  requested_by uuid not null references public.profiles(id),
  proposed_period_start date not null,
  proposed_period_end date not null,
  proposed_next_due_on date not null,
  reason text not null,
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  team_lead_approved_by uuid references public.profiles(id),
  team_lead_approved_at timestamptz,
  project_manager_approved_by uuid references public.profiles(id),
  project_manager_approved_at timestamptz,
  review_comment text,
  created_at timestamptz not null default now(),
  check(proposed_period_end >= proposed_period_start),
  check((team_lead_approved_by is null)=(team_lead_approved_at is null)),
  check((project_manager_approved_by is null)=(project_manager_approved_at is null))
);

alter table public.reports add column if not exists reporting_schedule_id uuid references public.team_reporting_schedules(id) on delete set null;
alter table public.reports add column if not exists reporting_due_on date;
create unique index if not exists reports_scheduled_run_unique
  on public.reports(reporting_schedule_id,reporting_due_on) where reporting_schedule_id is not null;

create table if not exists public.meal_team_assignments (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.evaluations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  contribution_instructions text not null,
  due_date date not null,
  assigned_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(evaluation_id,team_id)
);

create table if not exists public.meal_team_contributions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.meal_team_assignments(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  summary text not null,
  observations jsonb not null default '{}'::jsonb check(jsonb_typeof(observations)='object'),
  evidence_path text,
  status text not null default 'submitted' check(status in ('submitted','returned','approved')),
  reviewed_by uuid references public.profiles(id),
  review_comment text,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(assignment_id,author_id)
);

create table if not exists public.team_collective_report_sources (
  report_id uuid not null references public.reports(id) on delete cascade,
  contribution_id uuid not null references public.meal_team_contributions(id) on delete restrict,
  primary key(report_id,contribution_id)
);

insert into public.permissions(key,description) values
 ('workplans.view','View authorized team workplans'),
 ('workplans.submit','Submit a team workplan'),
 ('workplans.templates.manage','Create team workplan templates'),
 ('workplans.approve','Review and approve member workplans'),
 ('reporting.schedule.change','Request a change to scheduled report dates'),
 ('reporting.schedule.approve','Approve scheduled report date changes'),
 ('reporting.compile','Generate scheduled collective reports'),
 ('meal.contribute','Submit an assigned team MEAL contribution'),
 ('meal.team.assign','Assign MEAL contributions to project teams')
on conflict(key) do nothing;

-- Add least-privilege defaults to existing role records, retaining custom grants.
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p on p.key in (
 'teams.create','teams.manage_members','workplans.view','workplans.approve',
 'workplans.templates.manage','reporting.schedule.change','reporting.schedule.approve',
 'reporting.compile','meal.team.assign'
) where r.name='Project Manager' on conflict do nothing;
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p on p.key in (
 'workplans.view','workplans.submit','meal.contribute','tasks.view','tasks.complete'
) where r.name in ('Team Member','General Staff Member','Field Officer') on conflict do nothing;
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p on p.key in (
 'workplans.view','workplans.approve','workplans.templates.manage',
 'reporting.schedule.change','reporting.schedule.approve','reporting.compile',
 'meal.contribute','meal.team.assign','teams.manage_members'
) where r.name in ('Team Lead','Department Head') on conflict do nothing;
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p on p.key in (
 'workplans.view','workplans.submit','workplans.approve','workplans.templates.manage',
 'reporting.schedule.change','reporting.schedule.approve','reporting.compile',
 'meal.contribute','meal.team.assign'
) where r.name in ('Overall Administrator','Super Administrator') on conflict do nothing;
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p on p.key in (
 'dashboard.view','analytics.view','projects.view_all','tasks.view','reports.view',
 'evaluations.view','indicators.view','teams.view','finance.view',
 'accounting.view','accounting.reports','accounting.export','documents.view',
 'risks.manage','workplans.view','reporting.compile'
) where r.name in ('Management','Organization Director') on conflict do nothing;

create or replace function public.can_access_team(target_team uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.has_permission('system.manage')
   or (public.has_permission('projects.view_all') and public.has_permission('teams.view'))
   or public.has_team_access(target_team)
   or exists(select 1 from public.teams t join public.projects p on p.id=t.default_project_id
      where t.id=target_team and p.manager_id=auth.uid() and public.has_permission('teams.view'));
$$;

create or replace function public.can_manage_team(target_team uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.has_permission('system.manage')
   or (public.has_permission('teams.manage_members') and exists(
     select 1 from public.team_members tm where tm.team_id=target_team and tm.profile_id=auth.uid() and tm.team_role='lead'
   ))
   or (public.has_permission('teams.manage_members') and exists(
     select 1 from public.teams t join public.projects p on p.id=t.default_project_id
     where t.id=target_team and p.manager_id=auth.uid()
   ));
$$;
revoke all on function public.can_access_team(uuid) from public;
revoke all on function public.can_manage_team(uuid) from public;
grant execute on function public.can_access_team(uuid) to authenticated;
grant execute on function public.can_manage_team(uuid) to authenticated;

-- Project managers see/manage only teams attached to their own projects.
drop policy if exists "teams read membership" on public.teams;
drop policy if exists "teams manage" on public.teams;
drop policy if exists "teams edit permission" on public.teams;
drop policy if exists "teams delete permission" on public.teams;
create policy "teams read authorized project or team" on public.teams
for select to authenticated using (public.can_access_team(id));
create policy "teams create in managed project" on public.teams
for insert to authenticated with check (
  public.has_permission('system.manage')
  or (public.has_permission('teams.create') and default_project_id is not null
    and exists(select 1 from public.projects p where p.id=default_project_id and p.manager_id=auth.uid()))
);
create policy "teams update authorized project or team" on public.teams
for update to authenticated using (public.can_manage_team(id))
with check (public.can_manage_team(id));
create policy "teams delete authorized" on public.teams
for delete to authenticated using (public.has_permission('system.manage'));

drop policy if exists "team members scoped read" on public.team_members;
drop policy if exists "team members manage scoped" on public.team_members;
drop policy if exists "team members admin read" on public.team_members;
drop policy if exists "team members manage" on public.team_members;
create policy "team members read self or team manager" on public.team_members
for select to authenticated using (profile_id=auth.uid() or public.can_access_team(team_id));
create policy "team members manage by lead or project manager" on public.team_members
for all to authenticated using (public.can_manage_team(team_id))
with check (public.can_manage_team(team_id));

drop policy if exists "profiles authorized read" on public.profiles;
create policy "profiles authorized read" on public.profiles for select to authenticated using (
 id=auth.uid() or public.has_permission('users.view') or public.has_permission('system.manage')
 or exists(select 1 from public.team_members mine join public.team_members colleague on colleague.team_id=mine.team_id
   where mine.profile_id=auth.uid() and colleague.profile_id=profiles.id)
 or exists(select 1 from public.teams t join public.projects p on p.id=t.default_project_id
   join public.team_members member on member.team_id=t.id
   where p.manager_id=auth.uid() and member.profile_id=profiles.id)
 or exists(select 1 from public.projects managed join public.project_members theirs on theirs.project_id=managed.id
   where managed.manager_id=auth.uid() and theirs.profile_id=profiles.id)
 or exists(select 1 from public.project_members mine join public.project_members colleague on colleague.project_id=mine.project_id
   where mine.profile_id=auth.uid() and colleague.profile_id=profiles.id)
);

alter table public.team_workplan_templates enable row level security;
alter table public.workplans enable row level security;
alter table public.workplan_items enable row level security;
alter table public.team_reporting_schedules enable row level security;
alter table public.team_reporting_schedule_changes enable row level security;
alter table public.meal_team_assignments enable row level security;
alter table public.meal_team_contributions enable row level security;
alter table public.team_collective_report_sources enable row level security;

create policy "team templates view authorized" on public.team_workplan_templates
for select to authenticated using (public.can_access_team(team_id) and (public.has_permission('workplans.view') or public.has_permission('system.manage')));
create policy "team templates insert by managers" on public.team_workplan_templates
for insert to authenticated with check (public.can_manage_team(team_id) and (public.has_permission('workplans.templates.manage') or public.has_permission('system.manage')) and created_by=auth.uid());
create policy "team templates update by managers" on public.team_workplan_templates
for update to authenticated using (public.can_manage_team(team_id) and (public.has_permission('workplans.templates.manage') or public.has_permission('system.manage')))
with check (public.can_manage_team(team_id) and (public.has_permission('workplans.templates.manage') or public.has_permission('system.manage')));
create policy "team templates delete by managers" on public.team_workplan_templates
for delete to authenticated using (public.can_manage_team(team_id) and (public.has_permission('workplans.templates.manage') or public.has_permission('system.manage')));

create or replace function public.publish_team_workplan_template(
  target_team uuid, template_title text, template_description text, deliverables jsonb, template_storage_path text
) returns table(template_id uuid, template_version integer)
language plpgsql security invoker set search_path=public,pg_temp as $$
declare next_version integer; created_id uuid;
begin
  if not public.has_scoped_permission('workplans.templates.manage','team',target_team)
     or jsonb_typeof(deliverables)<>'array' or jsonb_array_length(deliverables)>100 then
    raise exception 'Template management permission or valid deliverables are required';
  end if;
  select coalesce(max(version),0)+1 into next_version from public.team_workplan_templates where team_id=target_team;
  update public.team_workplan_templates set active=false where team_id=target_team and active;
  insert into public.team_workplan_templates(team_id,version,title,description,role_deliverables,storage_path,created_by)
  values(target_team,next_version,template_title,template_description,deliverables,template_storage_path,auth.uid())
  returning id into created_id;
  return query select created_id,next_version;
end;
$$;
revoke all on function public.publish_team_workplan_template(uuid,text,text,jsonb,text) from public;
grant execute on function public.publish_team_workplan_template(uuid,text,text,jsonb,text) to authenticated;

create or replace function public.can_view_workplan(target_workplan uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.workplans w where w.id=target_workplan and (
   w.submitted_by=auth.uid() or public.can_access_team(w.team_id)
 ));
$$;
revoke all on function public.can_view_workplan(uuid) from public;
grant execute on function public.can_view_workplan(uuid) to authenticated;

create policy "workplans view author and authorized team" on public.workplans
for select to authenticated using (submitted_by=auth.uid() or (public.can_access_team(team_id) and (public.has_permission('workplans.view') or public.has_permission('system.manage'))));
create policy "workplans submit own team plan" on public.workplans
for insert to authenticated with check (
  submitted_by=auth.uid() and status in ('draft','submitted')
  and public.has_permission('workplans.submit') and public.has_team_access(team_id)
  and exists(select 1 from public.teams t where t.id=team_id and t.default_project_id=project_id)
  and (template_id is null or exists(select 1 from public.team_workplan_templates x where x.id=template_id and x.team_id=team_id and x.active))
);
create policy "workplans author draft edit" on public.workplans
for update to authenticated using (submitted_by=auth.uid() and status in ('draft','changes_requested'))
with check (submitted_by=auth.uid() and status in ('draft','changes_requested','submitted'));
create policy "workplans reviewer update" on public.workplans
for update to authenticated using (
  status in ('submitted','changes_requested') and (public.has_permission('workplans.approve') or public.has_permission('system.manage'))
  and (public.can_manage_team(team_id) or exists(select 1 from public.projects p where p.id=project_id and p.manager_id=auth.uid()))
)
with check (
  (public.has_permission('workplans.approve') or public.has_permission('system.manage'))
  and (public.can_manage_team(team_id) or exists(select 1 from public.projects p where p.id=project_id and p.manager_id=auth.uid()))
);
create policy "workplans delete own drafts" on public.workplans
for delete to authenticated using ((submitted_by=auth.uid() and status='draft') or public.has_permission('system.manage'));

create policy "workplan items view through plan" on public.workplan_items
for select to authenticated using (public.can_view_workplan(workplan_id));
create policy "workplan items author draft manage" on public.workplan_items
for all to authenticated using (exists(select 1 from public.workplans w where w.id=workplan_id
  and w.submitted_by=auth.uid() and w.status in ('draft','changes_requested')))
with check (exists(select 1 from public.workplans w where w.id=workplan_id
  and w.submitted_by=auth.uid() and w.status in ('draft','changes_requested')));

create or replace function public.protect_workplan_item_task_link()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if pg_trigger_depth()=1 and new.task_id is distinct from old.task_id then
    raise exception 'Task links are created automatically after workplan approval';
  end if;
  return new;
end;
$$;
drop trigger if exists workplan_items_protect_task_link on public.workplan_items;
create trigger workplan_items_protect_task_link before update on public.workplan_items
for each row execute function public.protect_workplan_item_task_link();

create or replace function public.validate_workplan_scope()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not exists(select 1 from public.teams t where t.id=new.team_id and t.default_project_id=new.project_id) then
    raise exception 'A workplan must use the team''s assigned project';
  end if;
  if new.template_id is not null and not exists(select 1 from public.team_workplan_templates x
     where x.id=new.template_id and x.team_id=new.team_id) then
    raise exception 'The workplan template must belong to its team';
  end if;
  return new;
end;
$$;
drop trigger if exists workplans_validate_scope on public.workplans;
create trigger workplans_validate_scope before insert or update on public.workplans
for each row execute function public.validate_workplan_scope();

create or replace function public.protect_workplan_review()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_is_lead boolean; actor_is_project_manager boolean;
begin
  if new.submitted_by is distinct from old.submitted_by or new.team_id is distinct from old.team_id
     or new.project_id is distinct from old.project_id then
    raise exception 'Workplan owner, team and project cannot be changed';
  end if;
  actor_is_lead := public.can_manage_team(old.team_id) and exists(
    select 1 from public.team_members tm where tm.team_id=old.team_id and tm.profile_id=auth.uid() and tm.team_role='lead'
  );
  actor_is_project_manager := exists(select 1 from public.projects p where p.id=old.project_id and p.manager_id=auth.uid());

  if new.submitted_by is distinct from old.submitted_by or new.team_id is distinct from old.team_id
     or new.project_id is distinct from old.project_id or new.template_id is distinct from old.template_id
     or new.period_start is distinct from old.period_start or new.period_end is distinct from old.period_end
     or new.reporting_cadence is distinct from old.reporting_cadence or new.upload_path is distinct from old.upload_path
     or new.title is distinct from old.title then
    if old.submitted_by<>auth.uid() or old.status not in ('draft','changes_requested') then
      raise exception 'Only the workplan author may change workplan details before approval';
    end if;
  end if;

  if new.team_lead_approved_at is distinct from old.team_lead_approved_at
     or new.team_lead_approved_by is distinct from old.team_lead_approved_by then
    if new.status<>'changes_requested' and (not public.has_permission('workplans.approve') or (not actor_is_lead and not public.has_permission('system.manage')) or new.team_lead_approved_by<>auth.uid()) then
      raise exception 'Only the team lead may record team approval';
    end if;
  end if;
  if new.project_manager_approved_at is distinct from old.project_manager_approved_at
     or new.project_manager_approved_by is distinct from old.project_manager_approved_by then
    if new.status<>'changes_requested' and (not public.has_permission('workplans.approve') or (not actor_is_project_manager and not public.has_permission('system.manage')) or new.project_manager_approved_by<>auth.uid()) then
      raise exception 'Only the project manager may record project approval';
    end if;
  end if;
  if new.status='changes_requested' and old.status is distinct from new.status
     and not (public.has_permission('workplans.approve') and (actor_is_lead or actor_is_project_manager or public.has_permission('system.manage'))) then
    raise exception 'Only a team lead or project manager may request workplan changes';
  end if;
  if old.submitted_by=auth.uid() and new.status is distinct from old.status
     and new.status not in ('submitted','changes_requested') then
    raise exception 'Workplan authors may submit plans but cannot approve them';
  end if;

  if new.status='changes_requested' and old.status is distinct from new.status then
    new.team_lead_approved_by=null;
    new.team_lead_approved_at=null;
    new.project_manager_approved_by=null;
    new.project_manager_approved_at=null;
  end if;

  if new.team_lead_approved_at is not null and new.project_manager_approved_at is not null then
    new.status='approved';
  elsif new.team_lead_approved_at is not null or new.project_manager_approved_at is not null then
    new.status='submitted';
  elsif new.status='approved' then
    raise exception 'Workplans require approval from both the team lead and project manager';
  end if;
  new.updated_at=now();
  return new;
end;
$$;
drop trigger if exists workplans_protect_review on public.workplans;
create trigger workplans_protect_review before update on public.workplans
for each row execute function public.protect_workplan_review();

create or replace function public.publish_approved_workplan()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare item record; created_task uuid; first_due date;
begin
  if new.status='approved' and old.status is distinct from 'approved' then
    for item in select * from public.workplan_items where workplan_id=new.id order by sort_order,created_at loop
      if item.task_id is null then
        insert into public.tasks(project_id,team_id,title,description,status,priority,progress,start_date,due_date,
          expected_deliverable,created_by)
        values(new.project_id,new.team_id,item.title,item.description,'not_started','medium',0,
          item.planned_start,item.due_date,item.expected_deliverable,new.submitted_by)
        returning id into created_task;
        insert into public.task_assignments(task_id,profile_id,assignment_type)
        values(created_task,new.submitted_by,'assignee') on conflict do nothing;
        update public.workplan_items set task_id=created_task where id=item.id;
      end if;
    end loop;
    first_due := case new.reporting_cadence
      when 'weekly' then least(new.period_end,new.period_start+7)
      when 'monthly' then least(new.period_end,(new.period_start+interval '1 month')::date)
      else least(new.period_end,(new.period_start+interval '3 months')::date)
    end;
    insert into public.team_reporting_schedules(team_id,project_id,report_type,cadence,period_start,period_end,next_due_on,created_by)
    values(new.team_id,new.project_id,'team_progress',new.reporting_cadence,new.period_start,new.period_end,first_due,new.submitted_by)
    on conflict(team_id,project_id,report_type,cadence,period_start,period_end) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists workplans_publish_approved on public.workplans;
create trigger workplans_publish_approved after update of status on public.workplans
for each row execute function public.publish_approved_workplan();

create policy "report schedules view authorized" on public.team_reporting_schedules
for select to authenticated using (public.can_access_team(team_id));
create policy "report schedule changes request authorized" on public.team_reporting_schedule_changes
for insert to authenticated with check (
  requested_by=auth.uid() and public.has_permission('reporting.schedule.change')
  and exists(select 1 from public.team_reporting_schedules s where s.id=schedule_id and public.can_access_team(s.team_id))
  and status='pending' and team_lead_approved_at is null and project_manager_approved_at is null
);
create policy "report schedule changes view authorized" on public.team_reporting_schedule_changes
for select to authenticated using (exists(select 1 from public.team_reporting_schedules s where s.id=schedule_id and public.can_access_team(s.team_id)));
create policy "report schedule changes approve authorized" on public.team_reporting_schedule_changes
for update to authenticated using (
  status='pending' and public.has_permission('reporting.schedule.approve')
  and exists(select 1 from public.team_reporting_schedules s where s.id=schedule_id
    and (public.can_manage_team(s.team_id) or exists(select 1 from public.projects p where p.id=s.project_id and p.manager_id=auth.uid())))
)
with check (public.has_permission('reporting.schedule.approve') and status in ('pending','approved','rejected'));

create or replace function public.apply_reporting_schedule_change()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare sched public.team_reporting_schedules%rowtype;
begin
  select * into sched from public.team_reporting_schedules where id=new.schedule_id;
  if new.schedule_id is distinct from old.schedule_id or new.requested_by is distinct from old.requested_by
     or new.proposed_period_start is distinct from old.proposed_period_start
     or new.proposed_period_end is distinct from old.proposed_period_end
     or new.proposed_next_due_on is distinct from old.proposed_next_due_on or new.reason is distinct from old.reason then
    raise exception 'Schedule change request details cannot be edited';
  end if;
  if old.status<>'pending' then raise exception 'This schedule change has already been reviewed'; end if;
  if new.team_lead_approved_at is distinct from old.team_lead_approved_at
     or new.team_lead_approved_by is distinct from old.team_lead_approved_by then
    if not public.has_permission('reporting.schedule.approve')
       or (not public.has_permission('system.manage') and (not public.can_manage_team(sched.team_id)
         or not exists(select 1 from public.team_members tm where tm.team_id=sched.team_id and tm.profile_id=auth.uid() and tm.team_role='lead')))
       or new.team_lead_approved_by<>auth.uid() then raise exception 'Only the assigned team lead may approve this timeline'; end if;
  end if;
  if new.project_manager_approved_at is distinct from old.project_manager_approved_at
     or new.project_manager_approved_by is distinct from old.project_manager_approved_by then
    if not public.has_permission('reporting.schedule.approve')
       or (not public.has_permission('system.manage') and not exists(select 1 from public.projects p where p.id=sched.project_id and p.manager_id=auth.uid()))
       or new.project_manager_approved_by<>auth.uid() then raise exception 'Only the project manager may approve this timeline'; end if;
  end if;
  if new.status='rejected' and old.status='pending' and not public.has_permission('system.manage')
     and not public.can_manage_team(sched.team_id)
     and not exists(select 1 from public.projects p where p.id=sched.project_id and p.manager_id=auth.uid()) then
    raise exception 'Timeline change review is not authorized';
  end if;
  if new.team_lead_approved_at is not null and new.project_manager_approved_at is not null then
    new.status='approved';
    update public.team_reporting_schedules set period_start=new.proposed_period_start,
      period_end=new.proposed_period_end,next_due_on=new.proposed_next_due_on where id=new.schedule_id;
  end if;
  return new;
end;
$$;
drop trigger if exists reporting_schedule_change_apply on public.team_reporting_schedule_changes;
create trigger reporting_schedule_change_apply before update on public.team_reporting_schedule_changes
for each row execute function public.apply_reporting_schedule_change();

create or replace function public.validate_meal_team_assignment()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.evaluations e join public.teams t on t.id=new.team_id
   where e.id=new.evaluation_id and e.project_id=new.project_id and t.default_project_id=new.project_id) then
   raise exception 'MEAL contribution team and evaluation must use the same project';
 end if;
 return new;
end;
$$;
drop trigger if exists meal_team_assignment_scope on public.meal_team_assignments;
create trigger meal_team_assignment_scope before insert or update on public.meal_team_assignments
for each row execute function public.validate_meal_team_assignment();

create or replace function public.schedule_meal_collective_report()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.team_reporting_schedules(team_id,project_id,report_type,cadence,period_start,period_end,next_due_on,created_by)
 values(new.team_id,new.project_id,'meal_collective','once',new.due_date,new.due_date,new.due_date,new.assigned_by)
 on conflict(team_id,project_id,report_type,cadence,period_start,period_end) do nothing;
 return new;
end;
$$;
drop trigger if exists meal_assignment_report_schedule on public.meal_team_assignments;
create trigger meal_assignment_report_schedule after insert on public.meal_team_assignments
for each row execute function public.schedule_meal_collective_report();

create policy "meal team assignments view authorized" on public.meal_team_assignments
for select to authenticated using (public.can_access_team(team_id) and (public.has_permission('evaluations.view') or public.has_permission('meal.contribute') or public.has_permission('system.manage')));
create policy "meal team assignments manage authorized" on public.meal_team_assignments
for all to authenticated using (public.can_access_project(project_id) and public.has_permission('meal.team.assign'))
with check (assigned_by=auth.uid() and public.can_access_project(project_id) and public.has_permission('meal.team.assign'));
create policy "meal team contributions view authorized" on public.meal_team_contributions
for select to authenticated using (author_id=auth.uid() or exists(
 select 1 from public.meal_team_assignments a where a.id=assignment_id and public.can_access_team(a.team_id)
 and (public.has_permission('evaluations.view') or exists(select 1 from public.team_members tm where tm.team_id=a.team_id and tm.profile_id=auth.uid() and tm.team_role='lead'))
));
create policy "meal contribution submit assigned member" on public.meal_team_contributions
for insert to authenticated with check (author_id=auth.uid() and status='submitted' and exists(
 select 1 from public.meal_team_assignments a join public.team_members tm on tm.team_id=a.team_id
 where a.id=assignment_id and tm.profile_id=auth.uid() and public.has_permission('meal.contribute')
));
create policy "meal contribution author edit returned" on public.meal_team_contributions
for update to authenticated using (author_id=auth.uid() and status='returned')
with check (author_id=auth.uid() and status='submitted');
create policy "meal contribution reviewer decision" on public.meal_team_contributions
for update to authenticated using (author_id<>auth.uid() and status='submitted' and exists(select 1 from public.meal_team_assignments a where a.id=assignment_id
 and (public.has_permission('evaluations.edit') or (public.can_manage_team(a.team_id) and exists(select 1 from public.team_members tm where tm.team_id=a.team_id and tm.profile_id=auth.uid() and tm.team_role='lead')))))
with check (author_id<>auth.uid() and reviewed_by=auth.uid() and status in ('approved','returned') and exists(
 select 1 from public.meal_team_assignments a where a.id=assignment_id
 and (public.has_permission('evaluations.edit') or (public.can_manage_team(a.team_id)
   and exists(select 1 from public.team_members tm where tm.team_id=a.team_id and tm.profile_id=auth.uid() and tm.team_role='lead')))
));
create or replace function public.protect_meal_contribution_review()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.assignment_id is distinct from old.assignment_id or new.author_id is distinct from old.author_id then
    raise exception 'Contribution owner and assignment cannot be changed';
  end if;
  if old.author_id=auth.uid() and old.status='returned' then
    if new.status<>'submitted' or new.reviewed_by is not null or new.review_comment is not null then
      raise exception 'Returned contributors may edit their response and resubmit it';
    end if;
  elsif old.author_id<>auth.uid() and old.status='submitted' then
    if (to_jsonb(new)-'status'-'reviewed_by'-'review_comment') is distinct from (to_jsonb(old)-'status'-'reviewed_by'-'review_comment')
       or new.status not in ('approved','returned') or new.reviewed_by<>auth.uid() then
      raise exception 'Reviewers may only approve a contribution or return it with comments';
    end if;
  else
    raise exception 'Contribution update is not authorized';
  end if;
  return new;
end;
$$;
drop trigger if exists meal_contributions_protect_review on public.meal_team_contributions;
create trigger meal_contributions_protect_review before update on public.meal_team_contributions
for each row execute function public.protect_meal_contribution_review();
create policy "collective report sources read authorized" on public.team_collective_report_sources
for select to authenticated using (exists(select 1 from public.reports r where r.id=report_id
 and (public.can_review_report(r.id) or r.author_id=auth.uid())));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('team-workplans','team-workplans',false,15728640,array['application/pdf']) on conflict(id) do nothing;
create policy "team workplan private read" on storage.objects for select to authenticated using (
 bucket_id='team-workplans' and (
   exists(select 1 from public.team_workplan_templates t where t.storage_path=name and public.can_access_team(t.team_id))
   or exists(select 1 from public.workplans w where w.upload_path=name and (w.submitted_by=auth.uid() or public.can_access_team(w.team_id)))
 )
);
create policy "team workplan member upload" on storage.objects for insert to authenticated with check (
 bucket_id='team-workplans' and (storage.foldername(name))[2]=auth.uid()::text
 and exists(select 1 from public.team_members tm where tm.team_id::text=(storage.foldername(name))[1] and tm.profile_id=auth.uid())
);
create policy "team workplan manager upload" on storage.objects for insert to authenticated with check (
 bucket_id='team-workplans' and (storage.foldername(name))[2]='templates'
 and public.can_manage_team(((storage.foldername(name))[1])::uuid)
 and public.has_permission('workplans.templates.manage')
);
