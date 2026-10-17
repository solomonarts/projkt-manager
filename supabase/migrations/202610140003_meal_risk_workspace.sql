-- MEAL and risk workspace extensions. Existing records remain intact.
alter table public.indicators add column if not exists disaggregation jsonb not null default '[]'::jsonb;
alter table public.indicators add column if not exists collection_method text;
alter table public.indicators add column if not exists schedule_notes text;
alter table public.evaluations add column if not exists objectives text;
alter table public.evaluations add column if not exists questions jsonb not null default '[]'::jsonb;
alter table public.evaluations add column if not exists scheduled_on date;
alter table public.evaluations add column if not exists published_at timestamptz;
alter table public.recommendations add column if not exists evidence text;
alter table public.recommendations add column if not exists follow_up_notes text;
alter table public.recommendations add column if not exists updated_at timestamptz not null default now();
alter table public.risks add column if not exists category text;
alter table public.risks add column if not exists identified_on date not null default current_date;
alter table public.risks add column if not exists due_date date;
alter table public.risks add column if not exists escalation_level text not null default 'team';
alter table public.risks add column if not exists evidence text;
alter table public.risks add column if not exists related_activity_id uuid references public.project_activities(id) on delete set null;
alter table public.risks add column if not exists related_task_id uuid references public.tasks(id) on delete set null;
alter table public.risks add column if not exists is_issue boolean not null default false;
alter table public.issues add column if not exists category text;

create table if not exists public.meal_form_templates (
  id uuid primary key default gen_random_uuid(), name text not null, description text,
  project_id uuid references public.projects(id) on delete cascade,
  questions jsonb not null default '[]'::jsonb, created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create table if not exists public.meal_form_responses (
  id uuid primary key default gen_random_uuid(), template_id uuid not null references public.meal_form_templates(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb, submitted_by uuid not null references public.profiles(id),
  submitted_at timestamptz not null default now()
);
create table if not exists public.meal_feedback (
  id uuid primary key default gen_random_uuid(), project_id uuid references public.projects(id) on delete set null,
  category text not null, message text not null, confidential boolean not null default false,
  status text not null default 'received' check(status in ('received','under_review','actioned','closed')),
  assigned_to uuid references public.profiles(id), resolution text, submitted_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.meal_actions (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  source_type text not null check(source_type in ('recommendation','feedback','risk','evaluation')),
  source_id uuid, title text not null, description text, action_type text not null default 'corrective' check(action_type in ('corrective','preventive','learning')),
  owner_id uuid references public.profiles(id), due_date date, status text not null default 'open' check(status in ('open','in_progress','complete','overdue','cancelled')),
  evidence text, created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

insert into public.permissions(key,description) values
('meal.feedback.manage','Manage MEAL feedback records'),('meal.feedback.sensitive','View confidential MEAL feedback'),('meal.forms.manage','Create reusable MEAL forms'),('risks.manage','Create and update project risks and issues')
on conflict(key) do nothing;
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r cross join public.permissions p
where (r.name='MEAL Officer' and p.key in ('meal.feedback.manage','meal.feedback.sensitive','meal.forms.manage','risks.manage'))
or (r.name='Project Manager' and p.key in ('risks.manage','meal.feedback.manage'))
or r.name='Super Administrator'
on conflict do nothing;

do $$ declare t text; begin
 foreach t in array array['meal_form_templates','meal_form_responses','meal_feedback','meal_actions'] loop
  execute format('alter table public.%I enable row level security',t);
 end loop;
end $$;
create policy "meal form templates scoped read" on public.meal_form_templates for select to authenticated using (project_id is null or (public.can_access_project(project_id) and public.has_permission('evaluations.view')));
create policy "meal form templates scoped manage" on public.meal_form_templates for all to authenticated using (public.has_permission('meal.forms.manage') or public.has_permission('system.manage')) with check ((public.has_permission('meal.forms.manage') or public.has_permission('system.manage')) and (project_id is null or public.can_access_project(project_id)) and created_by=auth.uid());
create policy "meal form responses scoped" on public.meal_form_responses for select to authenticated using (submitted_by=auth.uid() or (public.can_access_project(project_id) and public.has_permission('evaluations.conduct')));
create policy "meal form response submit" on public.meal_form_responses for insert to authenticated with check (submitted_by=auth.uid() and public.has_permission('evaluations.conduct') and public.can_access_project(project_id));
create policy "meal feedback restricted read" on public.meal_feedback for select to authenticated using (submitted_by=auth.uid() or (not confidential and project_id is not null and public.can_access_project(project_id) and public.has_permission('meal.feedback.manage')) or (confidential and public.has_permission('meal.feedback.sensitive')));
create policy "meal feedback submit" on public.meal_feedback for insert to authenticated with check (submitted_by=auth.uid() and public.has_permission('reports.create') and (project_id is null or public.can_access_project(project_id)));
create policy "meal feedback authorized manage" on public.meal_feedback for update to authenticated using ((not confidential and public.has_permission('meal.feedback.manage')) or (confidential and public.has_permission('meal.feedback.sensitive'))) with check ((not confidential and public.has_permission('meal.feedback.manage')) or (confidential and public.has_permission('meal.feedback.sensitive')));
create policy "meal actions scoped" on public.meal_actions for select to authenticated using (owner_id=auth.uid() or (public.can_access_project(project_id) and public.has_permission('evaluations.view')));
create policy "meal actions create" on public.meal_actions for insert to authenticated with check (created_by=auth.uid() and public.can_access_project(project_id) and (public.has_permission('evaluations.edit') or public.has_permission('risks.manage')));
create policy "meal actions update" on public.meal_actions for update to authenticated using (public.can_access_project(project_id) and (public.has_permission('evaluations.edit') or public.has_permission('risks.manage'))) with check (public.can_access_project(project_id) and (public.has_permission('evaluations.edit') or public.has_permission('risks.manage')));
-- Updates on legacy risk records require explicit risk management or project editing.
drop policy if exists "risks scoped" on public.risks;
create policy "risks scoped" on public.risks for select to authenticated using (owner_id=auth.uid() or (public.can_access_project(project_id) and public.has_permission('projects.view')));
create policy "risks authorized insert" on public.risks for insert to authenticated with check (public.can_access_project(project_id) and (public.has_permission('risks.manage') or public.has_permission('projects.edit')));
create policy "risks authorized update" on public.risks for update to authenticated using (public.can_access_project(project_id) and (public.has_permission('risks.manage') or public.has_permission('projects.edit'))) with check (public.can_access_project(project_id) and (public.has_permission('risks.manage') or public.has_permission('projects.edit')));
