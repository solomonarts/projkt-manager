-- Authentication, member provisioning and scoped task/report authorization.
-- Additive migration: existing records and role assignments are preserved.

-- Provision one member profile for every Supabase Auth user. Metadata from the
-- public sign-up form is limited to the display name; roles are never inferred.
create or replace function public.provision_profile_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles(id, full_name, email)
  values (
    new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'), ''), ''), 160),
    lower(coalesce(new.email, ''))
  )
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_profile_created on auth.users;
create trigger on_auth_user_profile_created
  after insert or update of email on auth.users
  for each row execute function public.provision_profile_from_auth_user();

insert into public.profiles(id, full_name, email)
select u.id,
       left(coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'), ''), ''), 160),
       lower(coalesce(u.email, ''))
from auth.users u
on conflict (id) do update
  set email = excluded.email,
      updated_at = now();

-- Self-service profile editing must never allow users to activate themselves,
-- change their department/reporting line, or alter their email in this table.
drop policy if exists "profiles read self or authorized" on public.profiles;
drop policy if exists "profiles own read" on public.profiles;
drop policy if exists "profiles admin update" on public.profiles;
drop policy if exists "profiles team scoped read" on public.profiles;
create policy "profiles authorized read" on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or public.has_permission('users.view')
  or public.has_permission('system.manage')
  or exists (
    select 1 from public.team_members mine
    join public.team_members colleague on colleague.team_id = mine.team_id
    where mine.profile_id = auth.uid() and colleague.profile_id = profiles.id
  )
  or exists (
    select 1 from public.project_members mine
    join public.project_members colleague on colleague.project_id = mine.project_id
    where mine.profile_id = auth.uid() and colleague.profile_id = profiles.id
  )
  or exists (
    select 1 from public.projects p
    where p.manager_id = auth.uid()
      and exists (select 1 from public.project_members pm where pm.project_id=p.id and pm.profile_id=profiles.id)
  )
);
drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self or authorized update" on public.profiles
for update to authenticated
using (id = auth.uid() or public.has_permission('users.edit') or public.has_permission('system.manage'))
with check (id = auth.uid() or public.has_permission('users.edit') or public.has_permission('system.manage'));
drop policy if exists "profiles own read" on public.profiles;
create policy "profiles self insert disabled" on public.profiles
for insert to authenticated with check (false);

create or replace function public.protect_profile_identity_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if pg_trigger_depth()=1 and auth.uid() is not null and old.id = auth.uid()
     and not public.has_permission('users.edit')
     and not public.has_permission('system.manage')
     and (
       new.id is distinct from old.id
       or new.email is distinct from old.email
       or new.department_id is distinct from old.department_id
       or new.is_active is distinct from old.is_active
       or new.reports_to is distinct from old.reports_to
     ) then
    raise exception 'Members may only update their own display name and job title';
  end if;
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists profiles_protect_identity_fields on public.profiles;
create trigger profiles_protect_identity_fields
  before update on public.profiles
  for each row execute function public.protect_profile_identity_fields();

-- Delegated role managers cannot bootstrap themselves into organization-wide
-- administration by assigning a role that grants role/user administration.
create or replace function public.protect_privileged_role_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null
     and not public.has_permission('system.manage')
     and exists (
       select 1 from public.role_permissions rp
       join public.permissions p on p.id=rp.permission_id
       where rp.role_id=new.role_id
         and p.key in ('system.manage','users.assign_roles','users.create','users.edit','users.disable')
     ) then
    raise exception 'Only a system administrator may assign a role with administrative permissions';
  end if;
  return new;
end;
$$;
drop trigger if exists profile_roles_protect_privileged_assignment on public.profile_roles;
create trigger profile_roles_protect_privileged_assignment
  before insert or update on public.profile_roles
  for each row execute function public.protect_privileged_role_assignment();

-- A task is visible to its assignees, authorized project members, or authorized
-- members of its assigned team. Team membership alone never grants task access.
create or replace function public.can_view_task(target_task uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = target_task and (
      (public.can_access_project(t.project_id)
        and (public.has_scoped_permission('tasks.view','project',t.project_id)
          or public.has_scoped_permission('tasks.view','record',t.id)))
      or exists (select 1 from public.task_assignments a where a.task_id=t.id and a.profile_id=auth.uid())
      or (t.team_id is not null and public.has_team_access(t.team_id)
        and public.has_scoped_permission('tasks.view','team',t.team_id))
      or (t.reviewer_id=auth.uid() and public.has_permission('tasks.review'))
    )
  );
$$;

create or replace function public.can_review_task(target_task uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.tasks t
    where t.id=target_task
      and public.has_permission('tasks.review')
      and not exists(select 1 from public.task_assignments a where a.task_id=t.id and a.profile_id=auth.uid())
      and (
        t.reviewer_id=auth.uid()
        or (public.can_access_project(t.project_id)
          and exists(select 1 from public.projects p where p.id=t.project_id and p.manager_id=auth.uid()))
        or (t.team_id is not null and exists(
          select 1 from public.team_members tm
          where tm.team_id=t.team_id and tm.profile_id=auth.uid() and tm.team_role='lead'
        ))
        or public.has_permission('system.manage')
      )
  );
$$;
revoke all on function public.can_view_task(uuid) from public;
revoke all on function public.can_review_task(uuid) from public;
grant execute on function public.can_view_task(uuid) to authenticated;
grant execute on function public.can_review_task(uuid) to authenticated;

-- Replace permissive policies left by the initial and intermediate migrations.
do $$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies
    where schemaname='public'
      and tablename in ('tasks','task_assignments','task_dependencies','task_updates',
        'task_comments','task_attachments','reports','report_reviews','report_attachments',
        'team_report_sources','report_change_history')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end;
$$;

create policy "tasks view authorized records" on public.tasks
for select to authenticated using (public.can_view_task(id));
create policy "tasks create authorized records" on public.tasks
for insert to authenticated with check (
  created_by=auth.uid()
  and public.has_scoped_permission('tasks.create','project',project_id)
  and (team_id is null or public.has_team_access(team_id))
  and (reviewer_id is null or reviewer_id=auth.uid()
    or exists(select 1 from public.project_members pm where pm.project_id=project_id and pm.profile_id=reviewer_id)
    or exists(select 1 from public.projects p where p.id=project_id and p.manager_id=reviewer_id)
    or exists(select 1 from public.team_members tm where tm.team_id=team_id and tm.profile_id=reviewer_id))
);
create policy "tasks edit authorized records" on public.tasks
for update to authenticated
using (
  (public.can_access_project(project_id) and (
    public.has_scoped_permission('tasks.edit','project',project_id)
    or public.has_scoped_permission('tasks.edit','record',id)
  ))
  or (public.has_permission('tasks.complete') and exists(
    select 1 from public.task_assignments a where a.task_id=id and a.profile_id=auth.uid()
  ))
  or public.can_review_task(id)
)
with check (
  (public.can_access_project(project_id) and (
    public.has_scoped_permission('tasks.edit','project',project_id)
    or public.has_scoped_permission('tasks.edit','record',id)
  ))
  or (public.has_permission('tasks.complete') and exists(
    select 1 from public.task_assignments a where a.task_id=id and a.profile_id=auth.uid()
  ))
  or public.can_review_task(id)
);
create policy "tasks delete authorized records" on public.tasks
for delete to authenticated using (
  public.can_access_project(project_id)
  and (public.has_scoped_permission('tasks.edit','project',project_id)
    or public.has_scoped_permission('tasks.edit','record',id))
);

create or replace function public.protect_task_updates()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare is_editor boolean; is_assignee boolean; is_reviewer boolean;
begin
  is_editor := public.has_permission('system.manage')
    or public.has_scoped_permission('tasks.edit','project',old.project_id)
    or public.has_scoped_permission('tasks.edit','record',old.id);
  is_assignee := public.has_permission('tasks.complete') and exists(
    select 1 from public.task_assignments a where a.task_id=old.id and a.profile_id=auth.uid()
  );
  is_reviewer := public.can_review_task(old.id);

  if not is_editor then
    if is_reviewer then
      if (to_jsonb(new) - 'status' - 'completed_at' - 'updated_at')
          is distinct from (to_jsonb(old) - 'status' - 'completed_at' - 'updated_at')
         or old.status <> 'pending_review'
         or new.status not in ('approved','changes_requested') then
        raise exception 'Reviewers may only approve a submitted task or request changes';
      end if;
    elsif is_assignee then
      if (to_jsonb(new) - 'progress' - 'status' - 'blocker' - 'checklist' - 'completed_at' - 'updated_at')
          is distinct from (to_jsonb(old) - 'progress' - 'status' - 'blocker' - 'checklist' - 'completed_at' - 'updated_at')
         or new.status not in ('not_started','assigned','in_progress','pending_review','changes_requested','blocked','delayed') then
        raise exception 'Assignees may update progress, blockers and checklists, not task planning or review fields';
      end if;
    else
      raise exception 'Task update is not authorized';
    end if;
  end if;

  if new.status='pending_review' and old.status is distinct from new.status and not (is_editor or is_assignee) then
    raise exception 'Only an authorized assignee may submit work for review';
  end if;
  if new.status in ('approved','completed') and old.status is distinct from new.status
     and not is_reviewer then
    raise exception 'Only an authorized reviewer may approve task completion';
  end if;
  if new.status in ('approved','completed') and old.status is distinct from new.status then
    new.completed_at=coalesce(new.completed_at,now());
  end if;
  new.updated_at=now();
  return new;
end;
$$;
drop trigger if exists tasks_validate_transition on public.tasks;
create trigger tasks_validate_transition before update on public.tasks
for each row execute function public.protect_task_updates();

create policy "task assignments view authorized" on public.task_assignments
for select to authenticated using (profile_id=auth.uid() or public.can_view_task(task_id));
create policy "task assignments manage authorized" on public.task_assignments
for all to authenticated
using (exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id)
  and public.has_scoped_permission('tasks.assign','project',t.project_id)))
with check (exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id)
  and public.has_scoped_permission('tasks.assign','project',t.project_id)
  and (
    public.has_permission('system.manage')
    or exists(select 1 from public.project_members pm where pm.project_id=t.project_id and pm.profile_id=task_assignments.profile_id)
    or exists(select 1 from public.projects p where p.id=t.project_id and p.manager_id=task_assignments.profile_id)
    or (t.team_id is not null and exists(select 1 from public.team_members tm where tm.team_id=t.team_id and tm.profile_id=task_assignments.profile_id))
  )));
create policy "task dependencies view authorized" on public.task_dependencies
for select to authenticated using (public.can_view_task(task_id) and public.can_view_task(depends_on_task_id));
create policy "task dependencies manage authorized" on public.task_dependencies
for all to authenticated
using (exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id)
  and public.has_scoped_permission('tasks.edit','project',t.project_id)))
with check (exists(select 1 from public.tasks t join public.tasks d on d.id=depends_on_task_id and d.project_id=t.project_id
  where t.id=task_id and public.can_access_project(t.project_id) and public.has_scoped_permission('tasks.edit','project',t.project_id)));
create policy "task updates view authorized" on public.task_updates
for select to authenticated using (public.can_view_task(task_id));
create policy "task updates assigned member insert" on public.task_updates
for insert to authenticated with check (author_id=auth.uid() and public.has_permission('tasks.complete')
  and exists(select 1 from public.task_assignments a where a.task_id=task_id and a.profile_id=auth.uid())
  and public.can_view_task(task_id));
create policy "task comments view authorized" on public.task_comments
for select to authenticated using (public.can_view_task(task_id));
create policy "task comments create authorized" on public.task_comments
for insert to authenticated with check (author_id=auth.uid() and public.can_view_task(task_id)
  and (exists(select 1 from public.task_assignments a where a.task_id=task_id and a.profile_id=auth.uid())
    or exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id)
      and public.has_scoped_permission('tasks.edit','project',t.project_id))));
create policy "task attachments view authorized" on public.task_attachments
for select to authenticated using (public.can_view_task(task_id));
create policy "task attachments create authorized" on public.task_attachments
for insert to authenticated with check (uploaded_by=auth.uid() and public.can_view_task(task_id)
  and (exists(select 1 from public.task_assignments a where a.task_id=task_id and a.profile_id=auth.uid())
    or exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id)
      and public.has_scoped_permission('tasks.edit','project',t.project_id))));

-- Report review is always limited to a report's team or project. A global
-- reports.review permission by itself never exposes an unrelated submission.
create or replace function public.can_review_report(target_report uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists(
    select 1 from public.reports r
    where r.id=target_report and (
      public.has_permission('system.manage')
      or (r.project_id is not null and public.can_access_project(r.project_id)
        and (public.has_scoped_permission('reports.review','project',r.project_id)
          or public.has_scoped_permission('reports.approve','project',r.project_id)))
      or (r.team_id is not null and public.has_team_access(r.team_id)
        and (public.has_scoped_permission('reports.review','team',r.team_id)
          or public.has_scoped_permission('reports.approve','team',r.team_id))
        and (exists(select 1 from public.team_members tm where tm.team_id=r.team_id and tm.profile_id=auth.uid() and tm.team_role='lead')
          or public.has_permission('reports.review') or public.has_permission('reports.approve')))
    )
  );
$$;
revoke all on function public.can_review_report(uuid) from public;
grant execute on function public.can_review_report(uuid) to authenticated;

create policy "reports view authorized" on public.reports
for select to authenticated using (
  author_id=auth.uid()
  or public.can_review_report(id)
  or (project_id is not null and public.can_access_project(project_id)
    and public.has_scoped_permission('reports.view','project',project_id))
  or (team_id is not null and public.has_team_access(team_id)
    and public.has_scoped_permission('reports.view','team',team_id))
);
create policy "reports author create draft" on public.reports
for insert to authenticated with check (
  author_id=auth.uid() and status='draft' and verified=false and reviewed_by is null
  and public.has_permission('reports.create')
  and (project_id is null or (public.can_access_project(project_id)
    and public.has_scoped_permission('reports.create','project',project_id)))
  and (team_id is null or (public.has_team_access(team_id)
    and public.has_scoped_permission('reports.create','team',team_id)))
);
create policy "reports compile authorized" on public.reports
for insert to authenticated with check (
  author_id=auth.uid() and status='submitted' and public.has_permission('reports.compile')
  and ((project_id is not null and public.can_access_project(project_id)
      and public.has_scoped_permission('reports.compile','project',project_id))
    or (team_id is not null and public.has_team_access(team_id)
      and public.has_scoped_permission('reports.compile','team',team_id)))
);
create policy "reports author edit drafts" on public.reports
for update to authenticated using (
  author_id=auth.uid() and status in ('draft','returned') and public.has_permission('reports.edit')
)
with check (author_id=auth.uid() and status in ('draft','returned','submitted')
  and public.has_permission('reports.edit'));
create policy "reports author submit" on public.reports
for update to authenticated using (
  author_id=auth.uid() and status in ('draft','returned') and public.has_permission('reports.submit')
)
with check (author_id=auth.uid() and status='submitted' and public.has_permission('reports.submit'));
create policy "reports reviewer decide" on public.reports
for update to authenticated using (status='submitted' and author_id<>auth.uid() and public.can_review_report(id))
with check (author_id<>auth.uid() and public.can_review_report(id) and status in ('submitted','returned','approved','rejected'));
create policy "reports author delete draft" on public.reports
for delete to authenticated using ((author_id=auth.uid() and status='draft') or public.has_permission('system.manage'));

create or replace function public.protect_report_workflow()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare is_author boolean; is_reviewer boolean; is_compiler boolean;
begin
  is_author := old.author_id=auth.uid();
  is_reviewer := public.can_review_report(old.id);
  is_compiler := public.has_permission('reports.compile');

  if public.has_permission('system.manage') then
    new.updated_at=now();
    return new;
  end if;

  if is_author and old.status in ('draft','returned') and public.has_permission('reports.edit') then
    if (to_jsonb(new) - 'status' - 'verified' - 'reviewed_by' - 'submitted_at' - 'submission_date' - 'updated_at')
       is distinct from (to_jsonb(old) - 'status' - 'verified' - 'reviewed_by' - 'submitted_at' - 'submission_date' - 'updated_at') then
      raise exception 'Report author cannot change its ownership or review fields';
    end if;
    if new.status is distinct from old.status and not (
      new.status='submitted' and public.has_permission('reports.submit')
    ) and not (new.status in ('draft','returned') and public.has_permission('reports.edit')) then
      raise exception 'Use the report submission workflow to change report status';
    end if;
  elsif is_author and old.status in ('draft','returned') and new.status='submitted'
        and public.has_permission('reports.submit') then
    if (to_jsonb(new) - 'status' - 'submitted_at' - 'submission_date' - 'updated_at')
       is distinct from (to_jsonb(old) - 'status' - 'submitted_at' - 'submission_date' - 'updated_at') then
      raise exception 'Report submission cannot modify report content';
    end if;
    new.submitted_at=coalesce(new.submitted_at,now());
  elsif is_reviewer and old.status='submitted' and old.author_id<>auth.uid() then
    if (to_jsonb(new) - 'status' - 'verified' - 'reviewed_by' - 'updated_at')
       is distinct from (to_jsonb(old) - 'status' - 'verified' - 'reviewed_by' - 'updated_at')
       or new.status not in ('approved','returned','rejected') then
      raise exception 'Reviewers may only record a decision on submitted reports';
    end if;
    new.reviewed_by=auth.uid();
    new.verified=(new.status='approved');
  elsif not is_compiler then
    raise exception 'Report change is not authorized';
  end if;

  if new.status='submitted' then
    new.submitted_at=coalesce(new.submitted_at,now());
    new.submission_date=coalesce(new.submission_date,current_date);
    new.verified=false;
  elsif new.status in ('returned','rejected') then
    new.verified=false;
  end if;
  new.updated_at=now();
  return new;
end;
$$;
drop trigger if exists reports_protect_workflow on public.reports;
create trigger reports_protect_workflow before update on public.reports
for each row execute function public.protect_report_workflow();

create policy "report reviews visible to parties" on public.report_reviews
for select to authenticated using (
  exists(select 1 from public.reports r where r.id=report_id
    and (r.author_id=auth.uid() or public.can_review_report(r.id)))
);
create policy "report reviewers append decision" on public.report_reviews
for insert to authenticated with check (
  reviewer_id=auth.uid() and decision in ('comment','return','approve','reject')
  and public.can_review_report(report_id)
  and exists(select 1 from public.reports r where r.id=report_id
    and r.status='submitted' and r.author_id<>auth.uid())
);
create policy "report attachments visible to parties" on public.report_attachments
for select to authenticated using (
  exists(select 1 from public.reports r where r.id=report_id
    and (r.author_id=auth.uid() or public.can_review_report(r.id)
      or (r.project_id is not null and public.can_access_project(r.project_id)
        and public.has_scoped_permission('reports.view','project',r.project_id))))
);
create policy "report attachments author upload" on public.report_attachments
for insert to authenticated with check (
  uploaded_by=auth.uid() and exists(select 1 from public.reports r
    where r.id=report_id and r.author_id=auth.uid() and r.status in ('draft','returned'))
);
create policy "team report sources visible" on public.team_report_sources
for select to authenticated using (
  exists(select 1 from public.reports r where r.id=team_report_id
    and (r.author_id=auth.uid() or public.can_review_report(r.id)
      or (r.project_id is not null and public.can_access_project(r.project_id)
        and public.has_scoped_permission('reports.view','project',r.project_id))
      or (r.team_id is not null and public.has_team_access(r.team_id)
        and public.has_scoped_permission('reports.view','team',r.team_id))))
);
create policy "team report sources create from approved" on public.team_report_sources
for insert to authenticated with check (
  exists(select 1 from public.reports parent where parent.id=team_report_id
    and public.can_review_report(parent.id))
  and exists(select 1 from public.reports parent join public.reports source
    on source.id=source_report_id where parent.id=team_report_id
    and source.status='approved' and (
      (parent.team_id is not null and source.team_id=parent.team_id)
      or (parent.project_id is not null and source.project_id=parent.project_id)
    ))
);
create policy "report history visible to parties" on public.report_change_history
for select to authenticated using (
  exists(select 1 from public.reports r where r.id=report_id
    and (r.author_id=auth.uid() or public.can_review_report(r.id)))
);

-- Private storage paths always start with their owning report/task UUID.
drop policy if exists "task evidence scoped read" on storage.objects;
create policy "task evidence scoped read" on storage.objects for select to authenticated
using (bucket_id='task-evidence' and exists(
  select 1 from public.tasks t where t.id::text=(storage.foldername(name))[1]
    and public.can_view_task(t.id)
));
drop policy if exists "task evidence scoped upload" on storage.objects;
create policy "task evidence scoped upload" on storage.objects for insert to authenticated
with check (bucket_id='task-evidence' and exists(
  select 1 from public.tasks t where t.id::text=(storage.foldername(name))[1]
    and public.can_view_task(t.id)
    and (exists(select 1 from public.task_assignments a where a.task_id=t.id and a.profile_id=auth.uid())
      or (public.can_access_project(t.project_id) and public.has_scoped_permission('tasks.edit','project',t.project_id)))
));
drop policy if exists "report evidence scoped read" on storage.objects;
create policy "report evidence scoped read" on storage.objects for select to authenticated
using (bucket_id='report-evidence' and exists(
  select 1 from public.reports r where r.id::text=(storage.foldername(name))[1]
    and (r.author_id=auth.uid() or public.can_review_report(r.id))
));
drop policy if exists "report evidence scoped upload" on storage.objects;
create policy "report evidence scoped upload" on storage.objects for insert to authenticated
with check (bucket_id='report-evidence' and exists(
  select 1 from public.reports r where r.id::text=(storage.foldername(name))[1]
    and r.author_id=auth.uid() and r.status in ('draft','returned')
));
