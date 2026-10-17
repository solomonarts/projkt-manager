-- Configurable access control and finance approval limits, layered onto the existing role model.
create table if not exists public.scoped_permission_grants (
  id uuid primary key default gen_random_uuid(),
  principal_type text not null check(principal_type in ('user','role','team','department','project')),
  principal_id uuid not null,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  scope_type text not null check(scope_type in ('organization','department','team','project','record')),
  scope_id uuid,
  granted boolean not null default true,
  sensitivity text not null default 'standard' check(sensitivity in ('standard','confidential','safeguarding','financial')),
  reason text not null default '', granted_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
  check ((scope_type='organization' and scope_id is null) or (scope_type<>'organization' and scope_id is not null))
);
create unique index if not exists scoped_permission_grants_unique on public.scoped_permission_grants(principal_type,principal_id,permission_id,scope_type,coalesce(scope_id,'00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.role_financial_limits (
  role_id uuid not null references public.roles(id) on delete cascade,
  currency text not null default 'UGX', max_amount numeric(16,2) not null check(max_amount>=0),
  granted_by uuid not null references public.profiles(id), updated_at timestamptz not null default now(), primary key(role_id,currency)
);
create table if not exists public.profile_financial_limits (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  currency text not null default 'UGX', max_amount numeric(16,2) not null check(max_amount>=0),
  granted_by uuid not null references public.profiles(id), updated_at timestamptz not null default now(), primary key(profile_id,currency)
);
alter table public.scoped_permission_grants enable row level security;
alter table public.role_financial_limits enable row level security;
alter table public.profile_financial_limits enable row level security;
create policy "scoped grants admin read" on public.scoped_permission_grants for select to authenticated using (public.has_permission('system.manage'));
create policy "scoped grants admin manage" on public.scoped_permission_grants for all to authenticated using (public.has_permission('system.manage')) with check (public.has_permission('system.manage') and granted_by=auth.uid());
create policy "role finance limit admin read" on public.role_financial_limits for select to authenticated using (public.has_permission('system.manage') or public.has_permission('accounting.manage'));
create policy "role finance limit admin manage" on public.role_financial_limits for all to authenticated using (public.has_permission('system.manage')) with check (public.has_permission('system.manage') and granted_by=auth.uid());
create policy "profile finance limit admin read" on public.profile_financial_limits for select to authenticated using (public.has_permission('system.manage') or (profile_id=auth.uid() and public.has_permission('accounting.approve')));
create policy "profile finance limit admin manage" on public.profile_financial_limits for all to authenticated using (public.has_permission('system.manage')) with check (public.has_permission('system.manage') and granted_by=auth.uid());

insert into public.permissions(key,description) values
('documents.view','View authorized documents'),('documents.create','Upload documents'),('documents.edit','Edit document metadata'),('documents.delete','Delete permitted documents'),('documents.export','Download documents'),
('notifications.view','View own notifications'),('notifications.manage','Manage notification delivery'),('departments.manage','Manage department records'),('projects.export','Export project records'),('tasks.export','Export task records'),('reports.export','Export reports'),('accounting.export','Export authorized accounting reports'),('documents.confidential','View confidential documents')
on conflict(key) do nothing;
insert into public.roles(name,description,is_system) values
('Overall Administrator','System-wide administration and access oversight',false),('Organization Director','Organization-wide leadership and oversight',false),('Finance Manager','Manage financial operations and approvals',false),('Accountant','Prepare financial records and reports',false),('Finance Approver','Review and approve financial entries',false),('Department Head','Manage department delivery',false),('Project Officer','Manage assigned project delivery',false),('Field Officer','Collect field activity and monitoring records',false),('General Staff Member','Submit and complete assigned work',false),('Read-Only Reviewer','Read authorized records for review',false)
on conflict(name) do nothing;
-- The administrator capability follows the system.manage permission, not a magic role name.
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p on p.key='system.manage' where r.name='Overall Administrator'
on conflict do nothing;
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p on p.key in ('accounting.view','accounting.manage','accounting.approve','accounting.reports','accounting.export')
where r.name='Finance Manager' on conflict do nothing;
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p on p.key in ('accounting.view','accounting.manage','accounting.reports','accounting.export')
where r.name='Accountant' on conflict do nothing;
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p on p.key in ('accounting.view','accounting.approve','accounting.reports')
where r.name='Finance Approver' on conflict do nothing;
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p on p.key in ('dashboard.view','projects.view','projects.edit','tasks.view','tasks.create','tasks.edit','tasks.assign','reports.view','reports.create','reports.review','reports.approve','teams.view','evaluations.view','indicators.view')
where r.name in ('Department Head','Project Officer') on conflict do nothing;
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p on p.key in ('dashboard.view','projects.view','tasks.view','tasks.complete','reports.view','reports.create','reports.edit','reports.submit','indicators.view')
where r.name in ('Field Officer','General Staff Member') on conflict do nothing;
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p on p.key in ('dashboard.view','projects.view','tasks.view','reports.view','evaluations.view','indicators.view','teams.view')
where r.name='Read-Only Reviewer' on conflict do nothing;

create or replace function public.has_permission(permission_key text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and (
    exists(select 1 from public.profile_roles pr join public.role_permissions rp on rp.role_id=pr.role_id join public.permissions x on x.id=rp.permission_id where pr.profile_id=p.id and x.key='system.manage')
    or (case
      when exists(select 1 from public.user_permissions up join public.permissions x on x.id=up.permission_id where up.profile_id=p.id and x.key=permission_key)
        then exists(select 1 from public.user_permissions up join public.permissions x on x.id=up.permission_id where up.profile_id=p.id and x.key=permission_key and up.granted)
      when exists(select 1 from public.scoped_permission_grants g join public.permissions x on x.id=g.permission_id where x.key=permission_key and g.principal_type='user' and g.principal_id=p.id and g.scope_type='organization' and g.scope_id is null)
        then exists(select 1 from public.scoped_permission_grants g join public.permissions x on x.id=g.permission_id where x.key=permission_key and g.principal_type='user' and g.principal_id=p.id and g.scope_type='organization' and g.scope_id is null and g.granted)
      else (exists(select 1 from public.profile_roles pr join public.role_permissions rp on rp.role_id=pr.role_id join public.permissions x on x.id=rp.permission_id where pr.profile_id=p.id and x.key=permission_key)
        or exists(select 1 from public.scoped_permission_grants g join public.permissions x on x.id=g.permission_id where x.key=permission_key and g.granted and g.sensitivity='standard' and g.scope_type='organization' and g.scope_id is null and (
          (g.principal_type='user' and g.principal_id=p.id) or
          (g.principal_type='role' and exists(select 1 from public.profile_roles pr where pr.profile_id=p.id and pr.role_id=g.principal_id)) or
          (g.principal_type='team' and exists(select 1 from public.team_members tm where tm.profile_id=p.id and tm.team_id=g.principal_id)) or
          (g.principal_type='department' and p.department_id=g.principal_id)))) end)
  ));
$$;

create or replace function public.sensitivity_accessible(classification text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select classification='standard'
  or (classification='confidential' and public.has_permission('documents.confidential'))
  or (classification='safeguarding' and public.has_permission('meal.feedback.sensitive'))
  or (classification='financial' and public.has_permission('accounting.view'));
$$;

create or replace function public.scope_permission_matches(grant_scope text, grant_id uuid, target_kind text, target_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select (grant_scope=target_kind and grant_id is not distinct from target_id)
  or (target_kind='project' and grant_scope='department' and exists(select 1 from public.projects p where p.id=target_id and p.department_id=grant_id))
  or (target_kind='team' and grant_scope='department' and exists(select 1 from public.teams t where t.id=target_id and t.department_id=grant_id));
$$;

create or replace function public.has_scoped_permission(permission_key text, scope_kind text, target_scope uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
 select case
  when exists(select 1 from public.scoped_permission_grants g join public.permissions x on x.id=g.permission_id where x.key=permission_key and g.principal_type='user' and g.principal_id=auth.uid() and public.scope_permission_matches(g.scope_type,g.scope_id,scope_kind,target_scope))
   then exists(select 1 from public.scoped_permission_grants g join public.permissions x on x.id=g.permission_id where x.key=permission_key and g.principal_type='user' and g.principal_id=auth.uid() and public.scope_permission_matches(g.scope_type,g.scope_id,scope_kind,target_scope) and g.granted and public.sensitivity_accessible(g.sensitivity))
  else public.has_permission(permission_key)
   or exists(select 1 from public.scoped_permission_grants g join public.permissions x on x.id=g.permission_id where x.key=permission_key and g.granted and public.sensitivity_accessible(g.sensitivity) and public.scope_permission_matches(g.scope_type,g.scope_id,scope_kind,target_scope) and (
    (g.principal_type='role' and exists(select 1 from public.profile_roles pr where pr.profile_id=auth.uid() and pr.role_id=g.principal_id)) or
    (g.principal_type='team' and exists(select 1 from public.team_members tm where tm.profile_id=auth.uid() and tm.team_id=g.principal_id)) or
    (g.principal_type='department' and exists(select 1 from public.profiles p where p.id=auth.uid() and p.department_id=g.principal_id)) or
    (g.principal_type='project' and exists(select 1 from public.project_members pm where pm.profile_id=auth.uid() and pm.project_id=g.principal_id))
   ))
   or (scope_kind='team' and exists(select 1 from public.team_permissions tp join public.permissions x on x.id=tp.permission_id where tp.team_id=target_scope and x.key=permission_key and exists(select 1 from public.team_members tm where tm.team_id=tp.team_id and tm.profile_id=auth.uid())))
   or (scope_kind='project' and exists(select 1 from public.project_permissions pp join public.permissions x on x.id=pp.permission_id where pp.project_id=target_scope and pp.profile_id=auth.uid() and x.key=permission_key))
 end;
$$;
create or replace function public.can_access_project(target_project uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
 select public.has_permission('projects.view_all') or public.has_permission('system.manage') or public.has_scoped_permission('projects.view','project',target_project) or exists(
  select 1 from public.projects p where p.id=target_project and (p.manager_id=auth.uid() or exists(select 1 from public.project_members pm where pm.project_id=p.id and pm.profile_id=auth.uid())
   or exists(select 1 from public.project_permissions pp join public.permissions x on x.id=pp.permission_id where pp.project_id=p.id and pp.profile_id=auth.uid() and x.key in ('projects.view','projects.view_all')))
 );
$$;
-- Scoped grants participate in database authorization for project workspaces.
drop policy if exists "team members manage" on public.team_members;
create policy "team members manage" on public.team_members for all to authenticated using (public.has_scoped_permission('teams.manage_members','team',team_id)) with check (public.has_scoped_permission('teams.manage_members','team',team_id));
drop policy if exists "project members manage" on public.project_members;
create policy "project members manage" on public.project_members for all to authenticated using (public.can_access_project(project_id) and public.has_scoped_permission('projects.assign','project',project_id)) with check (public.can_access_project(project_id) and public.has_scoped_permission('projects.assign','project',project_id));
drop policy if exists "projects update" on public.projects;
create policy "projects update" on public.projects for update to authenticated using ((public.can_access_project(id) and public.has_scoped_permission('projects.edit','project',id)) or public.has_permission('system.manage')) with check ((public.can_access_project(id) and public.has_scoped_permission('projects.edit','project',id)) or public.has_permission('system.manage'));
drop policy if exists "projects delete" on public.projects;
create policy "projects delete" on public.projects for delete to authenticated using (public.has_scoped_permission('projects.delete','project',id) or public.has_permission('system.manage'));
drop policy if exists "tasks scoped read" on public.tasks;
create policy "tasks scoped read" on public.tasks for select to authenticated using (public.can_access_project(project_id) and (public.has_scoped_permission('tasks.view','project',project_id) or public.has_scoped_permission('tasks.view','record',id) or exists(select 1 from public.task_assignments a where a.task_id=id and a.profile_id=auth.uid())));
drop policy if exists "tasks scoped create" on public.tasks;
create policy "tasks scoped create" on public.tasks for insert to authenticated with check (public.can_access_project(project_id) and public.has_scoped_permission('tasks.create','project',project_id));
drop policy if exists "tasks scoped update" on public.tasks;
create policy "tasks scoped update" on public.tasks for update to authenticated using (public.can_access_project(project_id) and (public.has_scoped_permission('tasks.edit','project',project_id) or public.has_scoped_permission('tasks.edit','record',id) or public.has_scoped_permission('tasks.approve','project',project_id) or (public.has_scoped_permission('tasks.complete','project',project_id) and exists(select 1 from public.task_assignments a where a.task_id=id and a.profile_id=auth.uid())))) with check (public.can_access_project(project_id) and (public.has_scoped_permission('tasks.edit','project',project_id) or public.has_scoped_permission('tasks.edit','record',id) or public.has_scoped_permission('tasks.approve','project',project_id) or (public.has_scoped_permission('tasks.complete','project',project_id) and exists(select 1 from public.task_assignments a where a.task_id=id and a.profile_id=auth.uid()))));
drop policy if exists "tasks scoped delete" on public.tasks;
create policy "tasks scoped delete" on public.tasks for delete to authenticated using (public.can_access_project(project_id) and public.has_scoped_permission('tasks.edit','project',project_id));
drop policy if exists "assignments manage" on public.task_assignments;
create policy "assignments manage" on public.task_assignments for all to authenticated using (exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id) and public.has_scoped_permission('tasks.assign','project',t.project_id))) with check (exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id) and public.has_scoped_permission('tasks.assign','project',t.project_id)));
drop policy if exists "indicators scoped read" on public.indicators;
create policy "indicators scoped read" on public.indicators for select to authenticated using (public.can_access_project(project_id) and (public.has_scoped_permission('indicators.view','project',project_id) or public.has_scoped_permission('indicators.view','record',id)));
drop policy if exists "indicators scoped write" on public.indicators;
create policy "indicators scoped write" on public.indicators for all to authenticated using (public.can_access_project(project_id) and (public.has_scoped_permission('indicators.edit','project',project_id) or public.has_scoped_permission('indicators.edit','record',id))) with check (public.can_access_project(project_id) and (public.has_scoped_permission('indicators.edit','project',project_id) or public.has_scoped_permission('indicators.edit','record',id) or public.has_scoped_permission('indicators.create','project',project_id)));
drop policy if exists "measurements author write" on public.indicator_measurements;
create policy "measurements author write" on public.indicator_measurements for insert to authenticated with check (measured_by=auth.uid() and exists(select 1 from public.indicators i where i.id=indicator_id and public.can_access_project(i.project_id) and public.has_scoped_permission('indicators.measure','project',i.project_id)));
drop policy if exists "evaluations scoped read" on public.evaluations;
create policy "evaluations scoped read" on public.evaluations for select to authenticated using (public.can_access_project(project_id) and (public.has_scoped_permission('evaluations.view','project',project_id) or public.has_scoped_permission('evaluations.view','record',id)));
drop policy if exists "evaluations scoped write" on public.evaluations;
create policy "evaluations scoped write" on public.evaluations for all to authenticated using (public.can_access_project(project_id) and (public.has_scoped_permission('evaluations.edit','project',project_id) or public.has_scoped_permission('evaluations.edit','record',id))) with check (public.can_access_project(project_id) and (public.has_scoped_permission('evaluations.edit','project',project_id) or public.has_scoped_permission('evaluations.edit','record',id) or public.has_scoped_permission('evaluations.create','project',project_id)));
drop policy if exists "evaluation results scoped" on public.evaluation_results;
create policy "evaluation results read scoped" on public.evaluation_results for select to authenticated using (exists(select 1 from public.evaluations e where e.id=evaluation_id and public.can_access_project(e.project_id) and public.has_scoped_permission('evaluations.view','project',e.project_id)));
create policy "evaluation results insert scoped" on public.evaluation_results for insert to authenticated with check (exists(select 1 from public.evaluations e where e.id=evaluation_id and public.can_access_project(e.project_id) and public.has_scoped_permission('evaluations.conduct','project',e.project_id)));
drop policy if exists "reports scoped read" on public.reports;
create policy "reports scoped read" on public.reports for select to authenticated using (author_id=auth.uid() or public.has_permission('system.manage') or (team_id is not null and public.has_team_access(team_id) and public.has_scoped_permission('reports.view','team',team_id)) or (project_id is not null and public.can_access_project(project_id) and (public.has_scoped_permission('reports.view','project',project_id) or public.has_scoped_permission('reports.view','record',id))));
drop policy if exists "reports author create" on public.reports;
create policy "reports author create" on public.reports for insert to authenticated with check (author_id=auth.uid() and ((project_id is null and public.has_permission('reports.create')) or (project_id is not null and public.can_access_project(project_id) and public.has_scoped_permission('reports.create','project',project_id))));
drop policy if exists "risks scoped" on public.risks;
create policy "risks scoped" on public.risks for select to authenticated using (owner_id=auth.uid() or (public.can_access_project(project_id) and (public.has_scoped_permission('projects.view','project',project_id) or public.has_scoped_permission('projects.view','record',id))));
drop policy if exists "risks authorized insert" on public.risks;
create policy "risks authorized insert" on public.risks for insert to authenticated with check (public.can_access_project(project_id) and (public.has_scoped_permission('risks.manage','project',project_id) or public.has_scoped_permission('projects.edit','project',project_id)));
drop policy if exists "risks authorized update" on public.risks;
create policy "risks authorized update" on public.risks for update to authenticated using (public.can_access_project(project_id) and (public.has_scoped_permission('risks.manage','project',project_id) or public.has_scoped_permission('risks.manage','record',id) or public.has_scoped_permission('projects.edit','project',project_id))) with check (public.can_access_project(project_id) and (public.has_scoped_permission('risks.manage','project',project_id) or public.has_scoped_permission('risks.manage','record',id) or public.has_scoped_permission('projects.edit','project',project_id)));

create or replace function public.can_approve_financial_amount(amount numeric, currency_code text)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare max_allowed numeric(16,2); has_profile_limit boolean; has_role_limit boolean;
begin
 if not public.has_permission('accounting.approve') then return false; end if;
 select max_amount into max_allowed from public.profile_financial_limits where profile_id=auth.uid() and currency=upper(currency_code);
 if found then return amount<=max_allowed; end if;
 select min(l.max_amount),count(*)>0 into max_allowed,has_role_limit from public.role_financial_limits l join public.profile_roles pr on pr.role_id=l.role_id where pr.profile_id=auth.uid() and l.currency=upper(currency_code);
 if has_role_limit then return amount<=max_allowed; end if;
 return true;
end $$;
revoke all on function public.can_approve_financial_amount(numeric,text) from public;
grant execute on function public.can_approve_financial_amount(numeric,text) to authenticated;

-- Users with role-assignment permission may administer others, but cannot alter their own roles.
drop policy if exists "profile roles admin manage" on public.profile_roles;
create policy "profile role insert authorized" on public.profile_roles for insert to authenticated with check ((profile_id<>auth.uid() or public.has_permission('system.manage')) and (public.has_permission('users.assign_roles') or public.has_permission('system.manage')));
create policy "profile role update authorized" on public.profile_roles for update to authenticated using ((profile_id<>auth.uid() or public.has_permission('system.manage')) and (public.has_permission('users.assign_roles') or public.has_permission('system.manage'))) with check ((profile_id<>auth.uid() or public.has_permission('system.manage')) and (public.has_permission('users.assign_roles') or public.has_permission('system.manage')));
create policy "profile role delete authorized" on public.profile_roles for delete to authenticated using ((profile_id<>auth.uid() or public.has_permission('system.manage')) and (public.has_permission('users.assign_roles') or public.has_permission('system.manage')));

create or replace function public.audit_access_control_change()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare entity_id uuid; old_doc jsonb; new_doc jsonb;
begin
 if TG_OP<>'INSERT' then old_doc=to_jsonb(old); end if;
 if TG_OP<>'DELETE' then new_doc=to_jsonb(new); end if;
 entity_id=coalesce((new_doc->>'profile_id')::uuid,(old_doc->>'profile_id')::uuid,(new_doc->>'role_id')::uuid,(old_doc->>'role_id')::uuid,(new_doc->>'id')::uuid,(old_doc->>'id')::uuid);
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,old_value,new_value) values(auth.uid(),lower(TG_OP),TG_TABLE_NAME,entity_id,old_doc,new_doc);
 if TG_OP='DELETE' then return old; else return new; end if;
end $$;
create trigger audit_role_change after insert or update or delete on public.roles for each row execute function public.audit_access_control_change();
create trigger audit_role_permission_change after insert or update or delete on public.role_permissions for each row execute function public.audit_access_control_change();
create trigger audit_profile_role_change after insert or update or delete on public.profile_roles for each row execute function public.audit_access_control_change();
create trigger audit_user_permission_change after insert or update or delete on public.user_permissions for each row execute function public.audit_access_control_change();
create trigger audit_scoped_permission_change after insert or update or delete on public.scoped_permission_grants for each row execute function public.audit_access_control_change();
create trigger audit_role_limit_change after insert or update or delete on public.role_financial_limits for each row execute function public.audit_access_control_change();
create trigger audit_profile_limit_change after insert or update or delete on public.profile_financial_limits for each row execute function public.audit_access_control_change();

create or replace function public.post_journal_entry(target_entry uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare entry public.journal_entries%rowtype; total_debits numeric(16,2); total_credits numeric(16,2); currency_code text;
begin
  select * into entry from public.journal_entries where id=target_entry for update;
  if not found or entry.status not in ('pending_approval','draft') then raise exception 'Journal entry is not awaiting posting'; end if;
  select f.currency into currency_code from public.accounting_funds f where f.id=entry.fund_id;
  currency_code=coalesce(currency_code,'UGX');
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into total_debits,total_credits from public.journal_lines where journal_entry_id=target_entry;
  if not public.can_approve_financial_amount(total_debits,currency_code) then raise exception 'Permission denied or approval limit exceeded'; end if;
  if not exists(select 1 from public.accounting_periods p where p.id=entry.period_id and p.status='open' and entry.entry_date between p.starts_on and p.ends_on) then raise exception 'Accounting period is closed or date is outside the period'; end if;
  if total_debits <= 0 or total_debits <> total_credits or (select count(*) from public.journal_lines where journal_entry_id=target_entry) < 2 then raise exception 'Journal entry must contain at least two balanced lines'; end if;
  update public.journal_entries set status='posted', approved_by=auth.uid(), approved_at=now(), updated_at=now() where id=target_entry;
  insert into public.accounting_audit_log(actor_id,journal_entry_id,action,detail) values(auth.uid(),target_entry,'posted',jsonb_build_object('debits',total_debits,'credits',total_credits,'currency',currency_code));
end $$;
revoke all on function public.post_journal_entry(uuid) from public;
grant execute on function public.post_journal_entry(uuid) to authenticated;
