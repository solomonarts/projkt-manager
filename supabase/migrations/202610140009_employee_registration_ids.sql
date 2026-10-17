-- Admin-issued, one-time employee registration IDs.
create table if not exists public.employee_registration_codes (
  user_id text primary key check (user_id ~ '^[A-HJ-NP-Z2-9]{7}$'),
  email text not null,
  full_name text not null check (length(btrim(full_name)) between 1 and 160),
  role_id uuid references public.roles(id) on delete set null,
  status text not null default 'issued' check (status in ('issued','reserved','claimed','revoked')),
  reserved_at timestamptz,
  claimed_by uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists employee_registration_codes_email_active_uidx
  on public.employee_registration_codes (lower(email))
  where status in ('issued','reserved','claimed');

alter table public.employee_registration_codes enable row level security;
revoke all on public.employee_registration_codes from anon, authenticated;
grant all on public.employee_registration_codes to service_role;

create or replace function public.touch_employee_registration_code()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists employee_registration_codes_touch on public.employee_registration_codes;
create trigger employee_registration_codes_touch
  before update on public.employee_registration_codes
  for each row execute function public.touch_employee_registration_code();
