-- Keep each system-issued employee ID visible on the matching profile.
alter table public.profiles
  add column employee_id text;

alter table public.profiles
  add constraint profiles_employee_id_format_check
  check (employee_id is null or employee_id ~ '^[A-HJ-NP-Z2-9]{7}$');

-- Backfill IDs already claimed by Auth users. If an old user has more than
-- one claimed code, retain the most recently claimed ID.
with latest_claimed_code as (
  select distinct on (claimed_by) claimed_by, user_id
  from public.employee_registration_codes
  where status = 'claimed' and claimed_by is not null
  order by claimed_by, claimed_at desc nulls last, created_at desc
)
update public.profiles p
set employee_id = c.user_id
from latest_claimed_code c
where p.id = c.claimed_by
  and p.employee_id is null;

create unique index profiles_employee_id_unique_idx
  on public.profiles (employee_id)
  where employee_id is not null;

create or replace function public.sync_profile_employee_id_from_registration()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'claimed' and new.claimed_by is not null then
    update public.profiles
    set employee_id = new.user_id
    where id = new.claimed_by
      and (employee_id is null or employee_id = new.user_id);

    if not found then
      raise exception 'Could not assign employee ID to the matching profile';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_profile_employee_id_from_registration() from public, anon, authenticated;

create trigger employee_registration_codes_sync_profile
  after insert or update on public.employee_registration_codes
  for each row execute function public.sync_profile_employee_id_from_registration();

-- Employee IDs are system-managed profile identity fields, like email and
-- department. They cannot be changed through a member's own profile update.
create or replace function public.protect_profile_identity_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if pg_trigger_depth() = 1 and auth.uid() is not null and old.id = auth.uid()
     and not public.has_permission('users.edit')
     and not public.has_permission('system.manage')
     and (
       new.id is distinct from old.id
       or new.email is distinct from old.email
       or new.department_id is distinct from old.department_id
       or new.is_active is distinct from old.is_active
       or new.reports_to is distinct from old.reports_to
       or new.employee_id is distinct from old.employee_id
     ) then
    raise exception 'Members may only update their own display name and job title';
  end if;
  new.updated_at = now();
  return new;
end;
$$;
