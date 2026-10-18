-- Open employee applications with separate team-lead and project-manager approval.
-- Employee IDs are provisioned only after both approvals are recorded.

create table if not exists public.employee_registration_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null check (length(btrim(full_name)) between 1 and 160),
  team_id uuid not null references public.teams(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  status text not null default 'pending_team_approval'
    check (status in ('pending_team_approval','pending_project_approval','approved_pending_id','approved_pending_email','approved','rejected')),
  team_decision text check (team_decision in ('approved','rejected')),
  team_reviewed_by uuid references public.profiles(id),
  team_reviewed_at timestamptz,
  team_review_comment text,
  project_decision text check (project_decision in ('approved','rejected')),
  project_reviewed_by uuid references public.profiles(id),
  project_reviewed_at timestamptz,
  project_review_comment text,
  employee_id text check (employee_id is null or employee_id ~ '^[A-HJ-NP-Z2-9]{7}$'),
  employee_id_email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((team_reviewed_by is null) = (team_reviewed_at is null)),
  check ((project_reviewed_by is null) = (project_reviewed_at is null))
);

create unique index if not exists employee_registration_requests_active_email_uidx
  on public.employee_registration_requests (lower(email))
  where status <> 'rejected';

create index if not exists employee_registration_requests_team_status_idx
  on public.employee_registration_requests (team_id, status, created_at desc);
create index if not exists employee_registration_requests_project_status_idx
  on public.employee_registration_requests (project_id, status, created_at desc);

alter table public.employee_registration_requests enable row level security;
revoke all on public.employee_registration_requests from anon, authenticated;
grant all on public.employee_registration_requests to service_role;
grant select on public.employee_registration_requests to authenticated;

drop policy if exists "registration requests visible to applicant and approvers" on public.employee_registration_requests;
create policy "registration requests visible to applicant and approvers"
  on public.employee_registration_requests for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_permission('system.manage')
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

create or replace function public.touch_employee_registration_request()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.touch_employee_registration_request() from public, anon, authenticated;
drop trigger if exists employee_registration_requests_touch on public.employee_registration_requests;
create trigger employee_registration_requests_touch
  before update on public.employee_registration_requests
  for each row execute function public.touch_employee_registration_request();
