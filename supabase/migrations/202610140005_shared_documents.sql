create table if not exists public.documents (
 id uuid primary key default gen_random_uuid(), title text not null, description text, category text not null default 'general',
 classification text not null default 'standard' check(classification in ('standard','confidential','safeguarding','financial')),
 project_id uuid references public.projects(id) on delete set null,
 entity_type text check(entity_type in ('project','task','report','evaluation','transaction')),
 entity_id uuid, storage_path text not null unique, file_name text not null, mime_type text not null,
 file_size bigint not null check(file_size>0), current_version integer not null default 1,
 uploaded_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check ((entity_type is null)=(entity_id is null))
);
create table if not exists public.document_versions (
 id uuid primary key default gen_random_uuid(), document_id uuid not null references public.documents(id) on delete cascade,
 version_number integer not null check(version_number>0), storage_path text not null unique, file_name text not null,
 mime_type text not null, file_size bigint not null check(file_size>0), uploaded_by uuid not null references public.profiles(id),
 change_note text, created_at timestamptz not null default now(), unique(document_id,version_number)
);
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
create or replace function public.can_view_document(target_document uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.documents d where d.id=target_document and public.sensitivity_accessible(d.classification) and (
   d.uploaded_by=auth.uid()
   or (d.entity_type='project' and d.project_id is not null and public.can_access_project(d.project_id) and public.has_scoped_permission('documents.view','project',d.project_id))
   or (d.entity_type='task' and d.project_id is not null and public.can_access_project(d.project_id) and (public.has_scoped_permission('documents.view','project',d.project_id) or public.has_scoped_permission('tasks.view','project',d.project_id)))
   or (d.entity_type='report' and d.entity_id is not null and exists(select 1 from public.reports r where r.id=d.entity_id and (r.author_id=auth.uid() or (r.project_id is not null and public.can_access_project(r.project_id) and public.has_scoped_permission('reports.view','project',r.project_id)))))
   or (d.entity_type='evaluation' and d.entity_id is not null and exists(select 1 from public.evaluations e where e.id=d.entity_id and public.can_access_project(e.project_id) and public.has_scoped_permission('evaluations.view','project',e.project_id)))
   or (d.entity_type='transaction' and public.has_permission('accounting.view'))
   or (d.entity_type is null and d.project_id is not null and public.can_access_project(d.project_id) and public.has_scoped_permission('documents.view','project',d.project_id))
   or (d.entity_type is null and d.project_id is null and public.has_permission('documents.view'))
 ));
$$;
create policy "documents authorized read" on public.documents for select to authenticated using (public.can_view_document(id));
create policy "documents authorized create" on public.documents for insert to authenticated with check (uploaded_by=auth.uid() and public.sensitivity_accessible(classification) and ((project_id is not null and public.can_access_project(project_id) and public.has_scoped_permission('documents.create','project',project_id)) or (project_id is null and public.has_permission('documents.create'))));
create policy "documents metadata update" on public.documents for update to authenticated using (uploaded_by=auth.uid() or public.has_permission('documents.edit')) with check (public.sensitivity_accessible(classification) and (uploaded_by=auth.uid() or public.has_permission('documents.edit')));
create policy "documents controlled delete" on public.documents for delete to authenticated using (public.has_permission('documents.delete'));
create policy "document versions read" on public.document_versions for select to authenticated using (public.can_view_document(document_id));
create policy "document versions upload" on public.document_versions for insert to authenticated with check (uploaded_by=auth.uid() and exists(select 1 from public.documents d where d.id=document_id and public.sensitivity_accessible(d.classification) and ((d.project_id is not null and public.can_access_project(d.project_id) and public.has_scoped_permission('documents.create','project',d.project_id)) or (d.project_id is null and public.has_permission('documents.create')))));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('documents-private','documents-private',false,20971520,array['application/pdf','image/jpeg','image/png','image/webp','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy "private documents owner upload" on storage.objects for insert to authenticated with check(bucket_id='documents-private' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "private documents authorized read" on storage.objects for select to authenticated using(bucket_id='documents-private' and exists(select 1 from public.documents d where d.storage_path=name and public.can_view_document(d.id)));
create policy "private documents authorized delete" on storage.objects for delete to authenticated using(bucket_id='documents-private' and public.has_permission('documents.delete'));

create trigger audit_document_change after insert or update or delete on public.documents for each row execute function public.audit_access_control_change();
create trigger audit_document_version after insert on public.document_versions for each row execute function public.audit_access_control_change();
