-- Dedicated double-entry accounting workspace. Existing project finance tables remain intact.
insert into public.permissions(key, description) values
  ('accounting.view', 'View the accounting workspace'),
  ('accounting.manage', 'Manage accounting setup and journal entries'),
  ('accounting.approve', 'Approve and post journal entries'),
  ('accounting.reports', 'View financial statements and reports')
on conflict (key) do nothing;

create table if not exists public.accounting_funds (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  currency text not null default 'UGX',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.accounting_periods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_on date not null,
  ends_on date not null,
  status text not null default 'open' check (status in ('open','closed')),
  check (ends_on >= starts_on),
  unique (starts_on, ends_on)
);

create table if not exists public.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  account_type text not null check (account_type in ('asset','liability','equity','revenue','expense')),
  parent_id uuid references public.chart_of_accounts(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  entry_number bigint generated always as identity unique,
  description text not null,
  reference text,
  fund_id uuid references public.accounting_funds(id),
  period_id uuid not null references public.accounting_periods(id),
  entry_date date not null,
  status text not null default 'draft' check (status in ('draft','pending_approval','posted','rejected')),
  created_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.journal_entries(id) on delete cascade,
  account_id uuid not null references public.chart_of_accounts(id),
  description text,
  debit numeric(16,2) not null default 0 check (debit >= 0),
  credit numeric(16,2) not null default 0 check (credit >= 0),
  project_id uuid references public.projects(id),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);

create table if not exists public.accounting_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  journal_entry_id uuid references public.journal_entries(id),
  action text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.accounting_funds enable row level security;
alter table public.accounting_periods enable row level security;
alter table public.chart_of_accounts enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
alter table public.accounting_audit_log enable row level security;

create policy "accounting funds read" on public.accounting_funds for select to authenticated using (public.has_permission('accounting.view'));
create policy "accounting funds manage" on public.accounting_funds for all to authenticated using (public.has_permission('accounting.manage')) with check (public.has_permission('accounting.manage'));
create policy "accounting periods read" on public.accounting_periods for select to authenticated using (public.has_permission('accounting.view'));
create policy "accounting periods manage" on public.accounting_periods for all to authenticated using (public.has_permission('accounting.manage')) with check (public.has_permission('accounting.manage'));
create policy "chart accounts read" on public.chart_of_accounts for select to authenticated using (public.has_permission('accounting.view'));
create policy "chart accounts manage" on public.chart_of_accounts for all to authenticated using (public.has_permission('accounting.manage')) with check (public.has_permission('accounting.manage'));
create policy "journals scoped read" on public.journal_entries for select to authenticated using (public.has_permission('accounting.view') and (status = 'posted' or created_by = auth.uid() or public.has_permission('accounting.manage') or public.has_permission('accounting.approve')));
create policy "journals create draft" on public.journal_entries for insert to authenticated with check (created_by = auth.uid() and public.has_permission('accounting.manage') and status in ('draft','pending_approval'));
create policy "journals edit draft" on public.journal_entries for update to authenticated using (public.has_permission('accounting.manage') and status in ('draft','pending_approval')) with check (public.has_permission('accounting.manage'));
create policy "journal lines read" on public.journal_lines for select to authenticated using (exists(select 1 from public.journal_entries j where j.id=journal_entry_id));
create policy "journal lines draft manage" on public.journal_lines for all to authenticated using (public.has_permission('accounting.manage') and exists(select 1 from public.journal_entries j where j.id=journal_entry_id and j.status in ('draft','pending_approval'))) with check (public.has_permission('accounting.manage') and exists(select 1 from public.journal_entries j where j.id=journal_entry_id and j.status in ('draft','pending_approval')));
create policy "accounting audit read" on public.accounting_audit_log for select to authenticated using (public.has_permission('accounting.view'));

create or replace function public.post_journal_entry(target_entry uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare entry public.journal_entries%rowtype; total_debits numeric(16,2); total_credits numeric(16,2);
begin
  if not public.has_permission('accounting.approve') then raise exception 'Permission denied'; end if;
  select * into entry from public.journal_entries where id=target_entry for update;
  if not found or entry.status not in ('pending_approval','draft') then raise exception 'Journal entry is not awaiting posting'; end if;
  if not exists(select 1 from public.accounting_periods p where p.id=entry.period_id and p.status='open' and entry.entry_date between p.starts_on and p.ends_on) then raise exception 'Accounting period is closed or date is outside the period'; end if;
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into total_debits,total_credits from public.journal_lines where journal_entry_id=target_entry;
  if total_debits <= 0 or total_debits <> total_credits or (select count(*) from public.journal_lines where journal_entry_id=target_entry) < 2 then raise exception 'Journal entry must contain at least two balanced lines'; end if;
  update public.journal_entries set status='posted', approved_by=auth.uid(), approved_at=now(), updated_at=now() where id=target_entry;
  insert into public.accounting_audit_log(actor_id,journal_entry_id,action,detail) values(auth.uid(),target_entry,'posted',jsonb_build_object('debits',total_debits,'credits',total_credits));
end $$;
revoke all on function public.post_journal_entry(uuid) from public;
grant execute on function public.post_journal_entry(uuid) to authenticated;

create or replace function public.create_journal_entry(
  entry_description text, entry_reference text, entry_date date, target_period uuid,
  debit_account uuid, credit_account uuid, entry_amount numeric
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare new_entry uuid;
begin
  if not public.has_permission('accounting.manage') then raise exception 'Permission denied'; end if;
  if entry_amount <= 0 or debit_account = credit_account then raise exception 'Journal lines must use different accounts and a positive amount'; end if;
  if not exists(select 1 from public.accounting_periods p where p.id=target_period and p.status='open' and entry_date between p.starts_on and p.ends_on) then raise exception 'Accounting period is closed or date is outside the period'; end if;
  if not exists(select 1 from public.chart_of_accounts where id=debit_account and is_active) or not exists(select 1 from public.chart_of_accounts where id=credit_account and is_active) then raise exception 'Choose active accounts'; end if;
  insert into public.journal_entries(description,reference,period_id,entry_date,status,created_by)
    values(entry_description,entry_reference,target_period,entry_date,'pending_approval',auth.uid()) returning id into new_entry;
  insert into public.journal_lines(journal_entry_id,account_id,description,debit,credit) values
    (new_entry,debit_account,entry_description,entry_amount,0),
    (new_entry,credit_account,entry_description,0,entry_amount);
  insert into public.accounting_audit_log(actor_id,journal_entry_id,action) values(auth.uid(),new_entry,'created');
  return new_entry;
end $$;
revoke all on function public.create_journal_entry(text,text,date,uuid,uuid,uuid,numeric) from public;
grant execute on function public.create_journal_entry(text,text,date,uuid,uuid,uuid,numeric) to authenticated;

insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p on p.key in ('accounting.view','accounting.reports')
where r.name in ('Super Administrator','Management','Finance Officer') on conflict do nothing;
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p on p.key in ('accounting.manage','accounting.approve')
where r.name in ('Super Administrator','Finance Officer') on conflict do nothing;
