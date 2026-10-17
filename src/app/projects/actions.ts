'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/authz';

export async function createProject(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim();
  const code = String(formData.get('code') ?? '').trim().toUpperCase();
  const start = String(formData.get('start_date') ?? '') || null;
  const end = String(formData.get('end_date') ?? '') || null;
  if (!name || !code || (start && end && start > end)) throw new Error('Enter a project name and reference code, and check the project dates.');
  const { supabase, user } = await requirePermission('projects.create');
  const { error } = await supabase.from('projects').insert({
    name, code, start_date: start, end_date: end,
    location: String(formData.get('location') ?? '').trim() || null,
    funding_source: String(formData.get('funding_source') ?? '').trim() || null,
    description: String(formData.get('description') ?? '').trim() || null,
    created_by: user.id, manager_id: user.id,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/projects');
}
