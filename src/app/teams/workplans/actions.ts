'use server';

import { revalidatePath } from 'next/cache';
import { requireAuth, requirePermission, requireScopedPermission } from '@/lib/authz';

function dateValue(value: FormDataEntryValue | null) { return String(value ?? '') || null; }
async function invokeWorkflow(supabase: Awaited<ReturnType<typeof requireAuth>>['supabase'], payload: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('team-workflows', { body: payload });
  if (error) {
    const context = (error as Error & { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      try { const body = await context.json(); throw new Error(body.error || error.message); } catch (cause) { if (cause instanceof Error && cause.message !== error.message) throw cause; }
    }
    throw new Error(error.message);
  }
  if (data?.error) throw new Error(String(data.error));
  return data;
}

export async function submitWorkplan(formData: FormData) {
  const teamId = String(formData.get('team_id') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const start = String(formData.get('period_start') ?? '');
  const end = String(formData.get('period_end') ?? '');
  const cadence = String(formData.get('reporting_cadence') ?? 'weekly');
  if (!teamId || !title || !start || !end || end < start || !['weekly','monthly','quarterly'].includes(cadence)) throw new Error('Complete the workplan title, period and reporting cadence.');
  const { supabase, user } = await requireScopedPermission('workplans.submit', 'team', teamId);
  const { data: team, error: teamError } = await supabase.from('teams').select('default_project_id').eq('id', teamId).single();
  if (teamError || !team?.default_project_id) throw new Error('This team does not have a project assigned. Ask a project manager to set it up.');
  const templateId = String(formData.get('template_id') ?? '') || null;
  const pdf = formData.get('workplan_pdf');
  let uploadPath: string | null = null;
  if (pdf instanceof File && pdf.size) {
    if (pdf.type !== 'application/pdf' || pdf.size > 15 * 1024 * 1024) throw new Error('Upload a PDF no larger than 15 MB.');
    uploadPath = `${teamId}/${user.id}/${crypto.randomUUID()}-${pdf.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-90)}`;
    const { error } = await supabase.storage.from('team-workplans').upload(uploadPath, pdf, { contentType: 'application/pdf' });
    if (error) throw new Error(error.message);
  }
  const lines = String(formData.get('items') ?? '').split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length > 100) { if (uploadPath) await supabase.storage.from('team-workplans').remove([uploadPath]); throw new Error('A workplan can include up to 100 activities.'); }
  let items: Array<{title:string;expected_deliverable:string|null;due_date:string|null}>;
  try {
    items = lines.map((line, i) => {
      const [itemTitle, deliverable, dueDate] = line.split('|').map(part => part?.trim() ?? '');
      if (!itemTitle || (dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || dueDate < start || dueDate > end))) throw new Error(`Workplan line ${i + 1} needs a title and due date inside the workplan period.`);
      return { title: itemTitle.slice(0, 180), expected_deliverable: deliverable.slice(0, 1000) || null, due_date: dateValue(dueDate || null) };
    });
  } catch (error) { if (uploadPath) await supabase.storage.from('team-workplans').remove([uploadPath]); throw error; }
  try { await invokeWorkflow(supabase, { action:'submit_workplan', team_id:teamId, title, period_start:start, period_end:end, reporting_cadence:cadence, template_id:templateId, upload_path:uploadPath, items }); }
  catch (error) { if (uploadPath) await supabase.storage.from('team-workplans').remove([uploadPath]); throw error; }
  revalidatePath('/teams/workplans'); revalidatePath('/teams');
}

export async function createTeamTemplate(formData: FormData) {
  const teamId = String(formData.get('team_id') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const detail = String(formData.get('role_deliverables') ?? '').trim();
  if (!teamId || !title || !detail) throw new Error('Add a template title and role or deliverable guidance.');
  const { supabase, user } = await requireScopedPermission('workplans.templates.manage', 'team', teamId);
  let deliverables: unknown;
  try { deliverables = JSON.parse(detail); if (!Array.isArray(deliverables) || deliverables.length > 100) throw new Error(); }
  catch { deliverables = detail.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => ({ guidance: line })); }
  const pdf = formData.get('template_pdf');
  let storagePath: string | null = null;
  if (pdf instanceof File && pdf.size) {
    if (pdf.type !== 'application/pdf' || pdf.size > 15 * 1024 * 1024) throw new Error('Template upload must be a PDF no larger than 15 MB.');
    storagePath = `${teamId}/templates/${crypto.randomUUID()}-${pdf.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-90)}`;
    const { error } = await supabase.storage.from('team-workplans').upload(storagePath, pdf, { contentType: 'application/pdf' });
    if (error) throw new Error(error.message);
  }
  try { await invokeWorkflow(supabase, { action:'publish_team_template', team_id:teamId, title, description:String(formData.get('description') ?? '').trim(), role_deliverables:deliverables, storage_path:storagePath }); }
  catch (error) { if (storagePath) await supabase.storage.from('team-workplans').remove([storagePath]); throw error; }
  revalidatePath('/teams/workplans');
}

export async function reviewWorkplan(formData: FormData) {
  const id = String(formData.get('workplan_id') ?? '');
  const decision = String(formData.get('decision') ?? '');
  const comment = String(formData.get('comment') ?? '').trim();
  if (!id || !['approve','changes_requested'].includes(decision)) throw new Error('Choose a valid review decision.');
  const { supabase, user } = await requirePermission('workplans.approve');
  const { data: plan, error } = await supabase.from('workplans').select('id,team_id,project_id,status').eq('id', id).single();
  if (error || !plan || !['submitted','changes_requested'].includes(plan.status)) throw new Error('This workplan is not available for review.');
  await invokeWorkflow(supabase, { action:'review_workplan', workplan_id:id, decision, comment });
  revalidatePath('/teams/workplans'); revalidatePath('/tasks'); revalidatePath('/reports');
}

export async function requestScheduleChange(formData: FormData) {
  const scheduleId = String(formData.get('schedule_id') ?? '');
  const start = String(formData.get('period_start') ?? ''); const end = String(formData.get('period_end') ?? ''); const due = String(formData.get('next_due_on') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (!scheduleId || !start || !end || !due || end < start || due < start || due > end || !reason) throw new Error('Provide a valid reporting period, due date and reason.');
  const { supabase } = await requirePermission('reporting.schedule.change');
  await invokeWorkflow(supabase, { action:'request_schedule_change', schedule_id:scheduleId, period_start:start, period_end:end, next_due_on:due, reason });
  revalidatePath('/teams/workplans');
}

export async function reviewScheduleChange(formData: FormData) {
  const changeId = String(formData.get('change_id') ?? '');
  const decision = String(formData.get('decision') ?? 'approve');
  if (!changeId || !['approve','reject'].includes(decision)) throw new Error('Choose a valid schedule review decision.');
  const { supabase } = await requirePermission('reporting.schedule.approve');
  await invokeWorkflow(supabase, { action:'review_schedule_change', change_id:changeId, decision, comment:String(formData.get('comment') ?? '').trim() });
  revalidatePath('/teams/workplans');
}

export async function getWorkplanDownload(formData: FormData) {
  const teamId = String(formData.get('team_id') ?? ''); const path = String(formData.get('storage_path') ?? '');
  if (!teamId || !path.startsWith(`${teamId}/`)) throw new Error('Invalid team file.');
  await requireScopedPermission('workplans.view', 'team', teamId);
  const { supabase } = await requireAuth();
  const { data, error } = await supabase.storage.from('team-workplans').createSignedUrl(path, 60);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'File could not be opened.');
  return data.signedUrl;
}
