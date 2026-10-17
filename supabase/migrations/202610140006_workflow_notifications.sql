-- Workflow notifications are written transactionally by trusted database triggers.
-- Messages intentionally avoid protected record details; record access remains governed by RLS.
create or replace function public.notify_task_assignee()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='INSERT' then
    insert into public.notifications(profile_id,kind,title,body,entity_type,entity_id)
    values(new.profile_id,'task_assigned','New task assigned','A task has been assigned to you.', 'task',new.task_id);
  end if;
  return new;
end $$;
drop trigger if exists task_assignment_notification on public.task_assignments;
create trigger task_assignment_notification after insert on public.task_assignments
for each row execute function public.notify_task_assignee();

create or replace function public.notify_report_workflow()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare recipient uuid;
begin
  if new.status='submitted' and (tg_op='INSERT' or (tg_op='UPDATE' and old.status is distinct from new.status)) then
    if new.team_id is not null then
      for recipient in select tm.profile_id from public.team_members tm where tm.team_id=new.team_id and tm.team_role='lead' and tm.profile_id<>new.author_id loop
        insert into public.notifications(profile_id,kind,title,body,entity_type,entity_id)
        values(recipient,'report_review','Report awaiting review','A report from your team is ready for review.','report',new.id);
      end loop;
    end if;
    if new.project_id is not null then
      select p.manager_id into recipient from public.projects p where p.id=new.project_id;
      if recipient is not null and recipient<>new.author_id and not exists(select 1 from public.team_members tm where tm.team_id=new.team_id and tm.profile_id=recipient and tm.team_role='lead') then
        insert into public.notifications(profile_id,kind,title,body,entity_type,entity_id)
        values(recipient,'report_review','Project report awaiting review','A project report is ready for review.','report',new.id);
      end if;
    end if;
  elsif tg_op='UPDATE' and new.status='returned' and old.status is distinct from new.status then
    insert into public.notifications(profile_id,kind,title,body,entity_type,entity_id)
    values(new.author_id,'report_returned','Report returned for correction','A submitted report needs updates. Review the feedback in the Reports workspace.','report',new.id);
  end if;
  return new;
end $$;
drop trigger if exists report_workflow_notification on public.reports;
create trigger report_workflow_notification after insert or update of status on public.reports
for each row execute function public.notify_report_workflow();

create or replace function public.notify_risk_owner()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare recipient uuid;
begin
  if new.owner_id is not null and (tg_op='INSERT' or old.owner_id is distinct from new.owner_id) then
    insert into public.notifications(profile_id,kind,title,body,entity_type,entity_id)
    values(new.owner_id,'risk_assigned','Risk follow-up assigned','A risk or issue follow-up has been assigned to you.','risk',new.id);
  end if;
  if new.probability is not null and new.impact is not null and new.probability*new.impact>=20 and (tg_op='INSERT' or old.probability*old.impact<20) then
    select manager_id into recipient from public.projects where id=new.project_id;
    if recipient is not null and recipient is distinct from new.owner_id then
      insert into public.notifications(profile_id,kind,title,body,entity_type,entity_id)
      values(recipient,'risk_escalated','High risk needs attention','A project risk has reached a high severity level.','risk',new.id);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists risk_notification on public.risks;
create trigger risk_notification after insert or update of owner_id,probability,impact on public.risks
for each row execute function public.notify_risk_owner();

create or replace function public.notify_action_owner()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.owner_id is not null then
    insert into public.notifications(profile_id,kind,title,body,entity_type,entity_id)
    values(new.owner_id,'follow_up_assigned','MEAL follow-up assigned','A monitoring or evaluation follow-up has been assigned to you.','evaluation',new.id);
  end if;
  return new;
end $$;
drop trigger if exists meal_action_notification on public.meal_actions;
create trigger meal_action_notification after insert on public.meal_actions
for each row execute function public.notify_action_owner();

create or replace function public.notify_finance_approvers()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status='pending_approval' and (tg_op='INSERT' or (tg_op='UPDATE' and old.status is distinct from new.status)) then
    insert into public.notifications(profile_id,kind,title,body,entity_type,entity_id)
    select distinct p.id,'approval_pending','Financial entry awaiting approval','A financial entry is waiting for an authorized approver.','transaction',new.id
    from public.profiles p
    where p.is_active and p.id<>new.created_by and (
      exists(select 1 from public.user_permissions up join public.permissions x on x.id=up.permission_id where up.profile_id=p.id and x.key='accounting.approve' and up.granted)
      or (exists(select 1 from public.profile_roles pr join public.permissions x on x.key='accounting.approve' join public.role_permissions rp on rp.permission_id=x.id and rp.role_id=pr.role_id where pr.profile_id=p.id)
        and not exists(select 1 from public.user_permissions up join public.permissions x on x.id=up.permission_id where up.profile_id=p.id and x.key='accounting.approve' and not up.granted))
    );
  end if;
  return new;
end $$;
drop trigger if exists journal_approval_notification on public.journal_entries;
create trigger journal_approval_notification after insert or update of status on public.journal_entries
for each row execute function public.notify_finance_approvers();

-- Keep old document versions downloadable only through the same RLS-checked signed URL path.
drop policy if exists "private documents authorized read" on storage.objects;
create policy "private documents authorized read" on storage.objects for select to authenticated using(
  bucket_id='documents-private' and (
    exists(select 1 from public.documents d where d.storage_path=name and public.can_view_document(d.id))
    or exists(select 1 from public.document_versions v where v.storage_path=name and public.can_view_document(v.document_id))
  )
);
-- Permit cleanup of an uploader's own orphaned file after a metadata insert fails.
create policy "private documents owner cleanup" on storage.objects for delete to authenticated using(
  bucket_id='documents-private' and (storage.foldername(name))[1]=auth.uid()::text
);

-- Individual document grants are useful for confidential evidence that has no broader project grant.
drop policy if exists "documents authorized read" on public.documents;
create policy "documents authorized read" on public.documents for select to authenticated using(
  public.can_view_document(id) or
  (public.sensitivity_accessible(classification) and public.has_scoped_permission('documents.view','record',id))
);
drop policy if exists "documents metadata update" on public.documents;
create policy "documents metadata update" on public.documents for update to authenticated
using(uploaded_by=auth.uid() or public.has_permission('documents.edit') or public.has_scoped_permission('documents.edit','record',id))
with check(public.sensitivity_accessible(classification) and (uploaded_by=auth.uid() or public.has_permission('documents.edit') or public.has_scoped_permission('documents.edit','record',id)));
drop policy if exists "documents controlled delete" on public.documents;
create policy "documents controlled delete" on public.documents for delete to authenticated
using(public.has_permission('documents.delete') or public.has_scoped_permission('documents.delete','record',id));
