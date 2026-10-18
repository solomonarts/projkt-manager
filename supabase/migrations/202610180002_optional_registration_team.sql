-- Allow open employee applications before a team or project has been assigned.
alter table public.employee_registration_requests
  alter column team_id drop not null,
  alter column project_id drop not null;

alter table public.employee_registration_requests
  drop constraint if exists employee_registration_requests_status_check;

alter table public.employee_registration_requests
  add constraint employee_registration_requests_status_check
  check (status in ('pending_assignment','pending_team_approval','pending_project_approval','approved_pending_id','approved_pending_email','approved','rejected'));

alter table public.employee_registration_requests
  drop constraint if exists employee_registration_requests_team_project_pair_check;

alter table public.employee_registration_requests
  add constraint employee_registration_requests_team_project_pair_check
  check ((team_id is null and project_id is null) or (team_id is not null and project_id is not null));

drop policy if exists "registration requests visible to applicant and approvers" on public.employee_registration_requests;
create policy "registration requests visible to applicant and approvers"
  on public.employee_registration_requests for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_permission('system.manage')
    or (
      status = 'pending_assignment'
      and (
        exists (select 1 from public.team_members tm where tm.profile_id = (select auth.uid()) and tm.team_role = 'lead')
        or exists (select 1 from public.projects p where p.manager_id = (select auth.uid()))
      )
    )
    or exists (
      select 1 from public.team_members tm
      where tm.team_id = employee_registration_requests.team_id
        and tm.profile_id = (select auth.uid())
        and tm.team_role = 'lead'
    )
    or exists (
      select 1 from public.projects p
      where p.id = employee_registration_requests.project_id
        and p.manager_id = (select auth.uid())
    )
  );
