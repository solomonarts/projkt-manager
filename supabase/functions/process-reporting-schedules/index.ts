import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

function addCadence(date: string, cadence: string) {
  const next = new Date(`${date}T12:00:00Z`);
  if (cadence === 'weekly') next.setUTCDate(next.getUTCDate() + 7);
  else if (cadence === 'monthly') next.setUTCMonth(next.getUTCMonth() + 1);
  else if (cadence === 'quarterly') next.setUTCMonth(next.getUTCMonth() + 3);
  else return null;
  return next.toISOString().slice(0, 10);
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const expected = Deno.env.get('REPORTING_CRON_SECRET');
  const supplied = request.headers.get('x-reporting-cron-secret');
  if (!expected || !supplied || supplied !== expected) return json({ error: 'Unauthorized.' }, 401);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'Server configuration is missing.' }, 500);
  const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const today = new Date().toISOString().slice(0, 10);

  try {
    const { data: schedules, error: scheduleError } = await db.from('team_reporting_schedules')
      .select('id,team_id,project_id,report_type,cadence,period_start,period_end,next_due_on,created_by')
      .eq('active', true).lte('next_due_on', today).order('next_due_on').limit(100);
    if (scheduleError) throw scheduleError;

    const completed: string[] = [];
    for (const schedule of schedules ?? []) {
      const dueOn = schedule.next_due_on;
      const reportStart = schedule.period_start;
      let tasks: unknown[] = [];
      let contributions: unknown[] = [];

      if (schedule.report_type === 'team_progress') {
        const { data, error } = await db.from('tasks')
          .select('id,title,status,priority,progress,due_date,updated_at')
          .eq('team_id', schedule.team_id).eq('project_id', schedule.project_id)
          .gte('updated_at', `${reportStart}T00:00:00Z`).lte('updated_at', `${dueOn}T23:59:59Z`)
          .order('due_date');
        if (error) throw error;
        tasks = data ?? [];
      } else {
        const { data, error } = await db.from('meal_team_assignments')
          .select('id,evaluation_id,due_date,contribution_instructions,meal_team_contributions(id,author_id,summary,observations,status,submitted_at)')
          .eq('team_id', schedule.team_id).eq('project_id', schedule.project_id)
          .gte('due_date', reportStart).lte('due_date', dueOn);
        if (error) throw error;
        contributions = (data ?? []).flatMap((item) => item.meal_team_contributions ?? [])
          .filter((item) => item.status === 'approved');
      }

      const report = {
        reporting_schedule_id: schedule.id,
        reporting_due_on: dueOn,
        title: schedule.report_type === 'meal_collective' ? 'Scheduled collective MEAL report' : 'Scheduled team progress report',
        report_type: schedule.report_type === 'meal_collective' ? 'meal_collective' : 'team_weekly',
        team_id: schedule.team_id,
        project_id: schedule.project_id,
        author_id: schedule.created_by,
        period_start: reportStart,
        period_end: dueOn,
        status: 'submitted',
        submission_date: today,
        submitted_at: new Date().toISOString(),
        verified: false,
        activities: tasks,
        outputs: contributions,
        achievements: schedule.report_type === 'meal_collective'
          ? `${contributions.length} MEAL contributions collected for the scheduled evaluation.`
          : `${tasks.length} team tasks updated during this reporting period.`,
        planned_activities: schedule.report_type === 'meal_collective'
          ? 'Team contributions requested for the scheduled evaluation.'
          : 'Approved workplan activities and deliverables for this reporting period.',
      };

      let { data: created, error: insertError } = await db.from('reports').insert(report).select('id').single();
      if (insertError?.code === '23505') {
        const existing = await db.from('reports').select('id').eq('reporting_schedule_id', schedule.id).eq('reporting_due_on', dueOn).single();
        created = existing.data;
        insertError = existing.error;
      }
      if (insertError || !created) throw insertError ?? new Error('Collective report could not be created.');

      if (schedule.report_type === 'meal_collective' && contributions.length) {
        const sourceLinks = (contributions as Array<{ id?: string }>).filter((item) => item.id).map((item) => ({ report_id: created.id, contribution_id: item.id }));
        if (sourceLinks.length) {
          const { error } = await db.from('team_collective_report_sources').upsert(sourceLinks, { onConflict: 'report_id,contribution_id', ignoreDuplicates: true });
          if (error) throw error;
        }
      }

      if (schedule.cadence === 'once') {
        const { error } = await db.from('team_reporting_schedules').update({ active: false }).eq('id', schedule.id);
        if (error) throw error;
      } else {
        const nextDue = addCadence(dueOn, schedule.cadence);
        const nextPeriodStart = new Date(`${dueOn}T12:00:00Z`);
        nextPeriodStart.setUTCDate(nextPeriodStart.getUTCDate() + 1);
        const periodStart = nextPeriodStart.toISOString().slice(0, 10);
        const active = Boolean(nextDue && nextDue <= schedule.period_end);
        const { error } = await db.from('team_reporting_schedules').update({
          next_due_on: nextDue ?? dueOn,
          period_start: periodStart,
          active,
        }).eq('id', schedule.id);
        if (error) throw error;
      }
      completed.push(created.id);
    }
    return json({ processed: completed.length, report_ids: completed });
  } catch (error) {
    console.error('Reporting schedule processing failed', error instanceof Error ? error.message : 'unknown error');
    return json({ error: 'Scheduled reports could not be processed.' }, 500);
  }
});
