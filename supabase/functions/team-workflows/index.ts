import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});
type Payload = Record<string, unknown> & { action?: string };
const str = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value: string) => uuidPattern.test(value);

async function allowed(db: SupabaseClient, permission: string, scope?: { kind: string; id: string }) {
  const { data, error } = scope
    ? await db.rpc('has_scoped_permission', { permission_key: permission, scope_kind: scope.kind, target_scope: scope.id })
    : await db.rpc('has_permission', { permission_key: permission });
  return !error && data === true;
}
function fail(error: unknown) {
  console.error('Team workflow error', error instanceof Error ? error.message : 'unknown error');
  return json({ error: error instanceof Error ? error.message : 'Workflow could not be completed.' }, 400);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const authorization = request.headers.get('Authorization');
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!authorization?.startsWith('Bearer ') || !url || !anonKey) return json({ error: 'Authentication or server configuration is missing.' }, 401);

  try {
    const db = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: authError } = await db.auth.getUser();
    if (authError || !user) return json({ error: 'Sign in to continue.' }, 401);
    let payload: Payload;
    try { payload = await request.json() as Payload; } catch { return json({ error: 'Request body must be valid JSON.' }, 400); }
    switch (payload.action) {
      case 'submit_workplan': return await submitWorkplan(db, user.id, payload);
      case 'publish_team_template': return await publishTemplate(db, user.id, payload);
      case 'review_workplan': return await reviewWorkplan(db, user.id, payload);
      case 'request_schedule_change': return await requestScheduleChange(db, user.id, payload);
      case 'review_schedule_change': return await reviewScheduleChange(db, user.id, payload);
      case 'assign_meal_contribution': return await assignMeal(db, user.id, payload);
      case 'submit_meal_contribution': return await submitContribution(db, user.id, payload);
      case 'review_meal_contribution': return await reviewContribution(db, user.id, payload);
      default: return json({ error: 'Unknown team workflow action.' }, 400);
    }
  } catch (error) { return fail(error); }
});

async function submitWorkplan(db: SupabaseClient, userId: string, body: Payload) {
  const teamId = str(body.team_id), title = str(body.title), start = str(body.period_start), end = str(body.period_end);
  const cadence = str(body.reporting_cadence), templateId = str(body.template_id) || null, uploadPath = str(body.upload_path) || null;
  const items = body.items;
  if (!isUuid(teamId) || !title || title.length > 180 || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start || !['weekly','monthly','quarterly'].includes(cadence)) return json({ error: 'Workplan details are invalid.' }, 400);
  if (templateId && !isUuid(templateId)) return json({ error: 'Template is invalid.' }, 400);
  if (!Array.isArray(items) || items.length > 100 || items.some((item) => !item || typeof item !== 'object' || !str((item as Record<string, unknown>).title) || str((item as Record<string, unknown>).title).length > 180)) return json({ error: 'Add up to 100 valid workplan activities.' }, 400);
  const validatedItems = items.map((item, index) => {
    const row = item as Record<string, unknown>;
    const due = str(row.due_date), plannedStart = str(row.planned_start);
    if (due && (!/^\d{4}-\d{2}-\d{2}$/.test(due) || due < start || due > end)) throw new Error(`Activity ${index + 1} due date must be within the workplan period.`);
    if (plannedStart && (!/^\d{4}-\d{2}-\d{2}$/.test(plannedStart) || plannedStart < start || plannedStart > end || (due && plannedStart > due))) throw new Error(`Activity ${index + 1} start date must be within the workplan period and before its due date.`);
    return { title: str(row.title), description: str(row.description) || null, expected_deliverable: str(row.expected_deliverable) || null, planned_start: plannedStart || null, due_date: due || null, sort_order: index };
  });
  if (uploadPath && !uploadPath.startsWith(`${teamId}/${userId}/`)) return json({ error: 'Workplan upload path is outside your team folder.' }, 400);
  if (!await allowed(db, 'workplans.submit', { kind: 'team', id: teamId })) return json({ error: 'You cannot submit a workplan for this team.' }, 403);
  const { data: team, error: teamError } = await db.from('teams').select('default_project_id').eq('id', teamId).single();
  if (teamError || !team?.default_project_id) return json({ error: 'This team needs an assigned project before workplans can be submitted.' }, 400);
  const { data: plan, error: insertError } = await db.from('workplans').insert({
    team_id: teamId, project_id: team.default_project_id, template_id: templateId, submitted_by: userId,
    title, period_start: start, period_end: end, reporting_cadence: cadence, status: 'draft', upload_path: uploadPath,
  }).select('id').single();
  if (insertError || !plan) throw insertError ?? new Error('Workplan could not be created.');
  const rows = validatedItems.map((item) => ({ workplan_id: plan.id, ...item }));
  if (rows.length) {
    const { error } = await db.from('workplan_items').insert(rows);
    if (error) { await db.from('workplans').delete().eq('id', plan.id); if (uploadPath) await db.storage.from('team-workplans').remove([uploadPath]); throw error; }
  }
  const { error } = await db.from('workplans').update({ status: 'submitted', submitted_at: new Date().toISOString() }).eq('id', plan.id);
  if (error) { await db.from('workplans').delete().eq('id', plan.id); if (uploadPath) await db.storage.from('team-workplans').remove([uploadPath]); throw error; }
  return json({ submitted: true, workplan_id: plan.id }, 201);
}

async function reviewWorkplan(db: SupabaseClient, userId: string, body: Payload) {
  const id = str(body.workplan_id), decision = str(body.decision), comment = str(body.comment);
  if (!isUuid(id) || !['approve','changes_requested'].includes(decision)) return json({ error: 'Workplan review details are invalid.' }, 400);
  if (!await allowed(db, 'workplans.approve')) return json({ error: 'You cannot review workplans.' }, 403);
  const { data: plan, error } = await db.from('workplans').select('id,team_id,project_id,status').eq('id', id).single();
  if (error || !plan || !['submitted','changes_requested'].includes(plan.status)) return json({ error: 'Workplan is unavailable for review.' }, 404);
  if (decision === 'changes_requested') {
    if (!comment) return json({ error: 'Explain which changes are needed.' }, 400);
    const result = await db.from('workplans').update({ status: 'changes_requested', review_comment: comment }).eq('id', id);
    if (result.error) throw result.error;
  } else {
    const [{ data: membership }, { data: project }, { data: isAdmin }] = await Promise.all([
      db.from('team_members').select('team_role').eq('team_id', plan.team_id).eq('profile_id', userId).maybeSingle(),
      db.from('projects').select('manager_id').eq('id', plan.project_id).single(),
      db.rpc('has_permission', { permission_key: 'system.manage' }),
    ]);
    const now = new Date().toISOString(); const patch: Record<string, string> = { review_comment: comment };
    if (isAdmin) { patch.team_lead_approved_by=userId; patch.team_lead_approved_at=now; patch.project_manager_approved_by=userId; patch.project_manager_approved_at=now; }
    else if (membership?.team_role === 'lead') { patch.team_lead_approved_by=userId; patch.team_lead_approved_at=now; }
    else if (project?.manager_id === userId) { patch.project_manager_approved_by=userId; patch.project_manager_approved_at=now; }
    else return json({ error: 'Only this team lead or project manager can approve the workplan.' }, 403);
    const result = await db.from('workplans').update(patch).eq('id', id);
    if (result.error) throw result.error;
  }
  return json({ reviewed: true });
}

async function publishTemplate(db: SupabaseClient, userId: string, body: Payload) {
  const teamId = str(body.team_id), title = str(body.title), description = str(body.description) || null;
  const storagePath = str(body.storage_path) || null, deliverables = body.role_deliverables;
  if (!isUuid(teamId) || !title || title.length > 180 || !Array.isArray(deliverables) || deliverables.length > 100) return json({ error: 'Template details are invalid.' }, 400);
  if (storagePath && !storagePath.startsWith(`${teamId}/templates/`)) return json({ error: 'Template file path is outside its team folder.' }, 400);
  if (!await allowed(db, 'workplans.templates.manage', { kind: 'team', id: teamId })) return json({ error: 'You cannot manage this team template.' }, 403);
  const { data, error } = await db.rpc('publish_team_workplan_template', {
    target_team: teamId, template_title: title, template_description: description,
    deliverables, template_storage_path: storagePath,
  }).single();
  if (error) throw error;
  return json({ published: true, template_id: data.template_id, version: data.template_version }, 201);
}

async function requestScheduleChange(db: SupabaseClient, userId: string, body: Payload) {
  const scheduleId = str(body.schedule_id), start = str(body.period_start), end = str(body.period_end), due = str(body.next_due_on), reason = str(body.reason);
  if (!isUuid(scheduleId) || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || !/^\d{4}-\d{2}-\d{2}$/.test(due) || end < start || due < start || due > end || !reason) return json({ error: 'Proposed reporting dates or reason are invalid.' }, 400);
  const { data: schedule, error } = await db.from('team_reporting_schedules').select('team_id').eq('id', scheduleId).single();
  if (error || !schedule) return json({ error: 'Reporting schedule is unavailable.' }, 404);
  if (!await allowed(db, 'reporting.schedule.change', { kind: 'team', id: schedule.team_id })) return json({ error: 'You cannot request changes to this schedule.' }, 403);
  const result = await db.from('team_reporting_schedule_changes').insert({ schedule_id: scheduleId, requested_by: userId, proposed_period_start: start, proposed_period_end: end, proposed_next_due_on: due, reason });
  if (result.error) throw result.error;
  return json({ requested: true }, 201);
}

async function reviewScheduleChange(db: SupabaseClient, userId: string, body: Payload) {
  const id = str(body.change_id), decision = str(body.decision), comment = str(body.comment);
  if (!isUuid(id) || !['approve','reject'].includes(decision)) return json({ error: 'Schedule review details are invalid.' }, 400);
  if (!await allowed(db, 'reporting.schedule.approve')) return json({ error: 'You cannot review schedule changes.' }, 403);
  const { data: change, error } = await db.from('team_reporting_schedule_changes').select('id,schedule_id,status').eq('id', id).single();
  if (error || !change || change.status !== 'pending') return json({ error: 'Schedule change is unavailable.' }, 404);
  const { data: schedule } = await db.from('team_reporting_schedules').select('team_id,project_id').eq('id', change.schedule_id).single();
  if (!schedule) return json({ error: 'Reporting schedule is unavailable.' }, 404);
  if (decision === 'reject') {
    const result = await db.from('team_reporting_schedule_changes').update({ status: 'rejected', review_comment: comment }).eq('id', id);
    if (result.error) throw result.error;
  } else {
    const [{ data: membership }, { data: project }, { data: isAdmin }] = await Promise.all([
      db.from('team_members').select('team_role').eq('team_id', schedule.team_id).eq('profile_id', userId).maybeSingle(),
      db.from('projects').select('manager_id').eq('id', schedule.project_id).single(),
      db.rpc('has_permission', { permission_key: 'system.manage' }),
    ]);
    const now = new Date().toISOString(); const patch: Record<string, string> = { review_comment: comment };
    if (isAdmin) { patch.team_lead_approved_by=userId; patch.team_lead_approved_at=now; patch.project_manager_approved_by=userId; patch.project_manager_approved_at=now; }
    else if (membership?.team_role === 'lead') { patch.team_lead_approved_by=userId; patch.team_lead_approved_at=now; }
    else if (project?.manager_id === userId) { patch.project_manager_approved_by=userId; patch.project_manager_approved_at=now; }
    else return json({ error: 'Only this team lead or project manager can approve this schedule change.' }, 403);
    const result = await db.from('team_reporting_schedule_changes').update(patch).eq('id', id);
    if (result.error) throw result.error;
  }
  return json({ reviewed: true });
}

async function assignMeal(db: SupabaseClient, userId: string, body: Payload) {
  const evaluationId = str(body.evaluation_id), teamId = str(body.team_id), due = str(body.due_date), instructions = str(body.contribution_instructions);
  if (!isUuid(evaluationId) || !isUuid(teamId) || !/^\d{4}-\d{2}-\d{2}$/.test(due) || !instructions) return json({ error: 'MEAL assignment details are invalid.' }, 400);
  const { data: evaluation, error } = await db.from('evaluations').select('project_id').eq('id', evaluationId).single();
  if (error || !evaluation) return json({ error: 'Evaluation is unavailable.' }, 404);
  if (!await allowed(db, 'meal.team.assign', { kind: 'project', id: evaluation.project_id })) return json({ error: 'You cannot assign MEAL contributions to this project.' }, 403);
  const result = await db.from('meal_team_assignments').insert({ evaluation_id: evaluationId, team_id: teamId, project_id: evaluation.project_id, due_date: due, contribution_instructions: instructions, assigned_by: userId });
  if (result.error) throw result.error;
  return json({ assigned: true }, 201);
}

async function submitContribution(db: SupabaseClient, userId: string, body: Payload) {
  const assignmentId = str(body.assignment_id), summary = str(body.summary), observations = body.observations ?? {};
  if (!isUuid(assignmentId) || !summary || summary.length > 10000 || typeof observations !== 'object' || observations === null || Array.isArray(observations)) return json({ error: 'MEAL contribution details are invalid.' }, 400);
  if (!await allowed(db, 'meal.contribute')) return json({ error: 'You cannot submit MEAL contributions.' }, 403);
  const { data: existing } = await db.from('meal_team_contributions').select('id,status').eq('assignment_id', assignmentId).eq('author_id', userId).maybeSingle();
  const contribution = { assignment_id: assignmentId, author_id: userId, summary, observations, status: 'submitted', submitted_at: new Date().toISOString(), reviewed_by: null, review_comment: null };
  const result = existing?.status === 'returned'
    ? await db.from('meal_team_contributions').update(contribution).eq('id', existing.id)
    : existing ? { error: new Error('Your contribution is already submitted or approved.') } : await db.from('meal_team_contributions').insert(contribution);
  if (result.error) throw result.error;
  return json({ submitted: true }, existing ? 200 : 201);
}

async function reviewContribution(db: SupabaseClient, userId: string, body: Payload) {
  const id = str(body.contribution_id), status = str(body.status), comment = str(body.review_comment);
  if (!isUuid(id) || !['approved','returned'].includes(status) || (status === 'returned' && !comment)) return json({ error: 'MEAL review details are invalid.' }, 400);
  const { data: existing, error } = await db.from('meal_team_contributions').select('id,status,author_id').eq('id', id).single();
  if (error || !existing || existing.author_id === userId || existing.status !== 'submitted') return json({ error: 'Contribution is unavailable for review.' }, 404);
  const result = await db.from('meal_team_contributions').update({ status, reviewed_by: userId, review_comment: comment || null }).eq('id', id);
  if (result.error) throw result.error;
  return json({ reviewed: true });
}
