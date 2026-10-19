import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const origin = Deno.env.get('APP_ORIGIN') ?? '*';
const cors = {
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const idPattern = /^[A-HJ-NP-Z2-9]{7}$/;
const normalizeId = (value: unknown) => typeof value === 'string' ? value.trim().toUpperCase() : '';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) return json({ error: 'Authentication service is not configured.' }, 500);

  // Password recovery is initiated server-side by this function, so PKCE's
  // verifier would be stored here and unavailable in the user's browser.
  // Recovery therefore uses implicit tokens, which the update page consumes.
  const publicAuth = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false, flowType: 'implicit' } });
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: 'Request body must be valid JSON.' }, 400); }

  try {
    switch (body.action) {
      case 'issue_id': return await issueId(request, body, url, anonKey, admin);
      case 'registration_options': return await registrationOptions(admin);
      case 'register': return await register(body, admin);
      case 'login': return await login(body, publicAuth, admin);
      case 'reset_password': return await resetPassword(body, publicAuth, admin);
      case 'list_registration_requests': return await listRegistrationRequests(request, url, anonKey, admin);
      case 'review_registration': return await reviewRegistration(request, body, url, anonKey, admin);
      case 'assign_registration': return await assignRegistration(request, body, url, anonKey, admin);
      case 'issue_approved_employee_id': return await issueApprovedEmployeeId(request, body, url, anonKey, admin);
      default: return json({ error: 'Unknown authentication action.' }, 400);
    }
  } catch (error) {
    console.error('Employee authentication failed', error instanceof Error ? error.message : 'unknown error');
    return json({ error: 'The request could not be completed. Check the details or contact an administrator.' }, 400);
  }
});

async function issueId(request: Request, body: Record<string, unknown>, url: string, anonKey: string, admin: SupabaseClient) {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'Sign in to issue employee IDs.' }, 401);
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { autoRefreshToken: false, persistSession: false } });
  const { data: { user }, error: authError } = await caller.auth.getUser();
  if (authError || !user) return json({ error: 'Sign in to issue employee IDs.' }, 401);
  const { data: allowed, error: permissionError } = await caller.rpc('has_permission', { permission_key: 'users.create' });
  if (permissionError || allowed !== true) return json({ error: 'You do not have permission to issue employee IDs.' }, 403);

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : '';
  const roleId = typeof body.role_id === 'string' && body.role_id ? body.role_id : null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !fullName || fullName.length > 160) {
    return json({ error: 'Enter a valid employee email and a name up to 160 characters.' }, 400);
  }

  if (roleId) {
    const { data: canAssign, error } = await caller.rpc('has_permission', { permission_key: 'users.assign_roles' });
    if (error || canAssign !== true) return json({ error: 'You do not have permission to assign an initial role.' }, 403);
    const { data: role, error: roleError } = await admin.from('roles').select('id').eq('id', roleId).maybeSingle();
    if (roleError) return json({ error: 'Could not validate the selected role.' }, 500);
    if (!role) return json({ error: 'The selected role does not exist.' }, 400);
    const protectedKeys = ['system.manage', 'users.assign_roles', 'users.create', 'users.edit', 'users.disable'];
    const { data: protectedPermissions, error: protectedPermissionError } = await admin.from('permissions').select('id').in('key', protectedKeys);
    if (protectedPermissionError) return json({ error: 'Could not validate the selected role.' }, 500);
    const permissionIds = (protectedPermissions ?? []).map((permission) => permission.id);
    let elevated: Array<{ permission_id: string }> = [];
    if (permissionIds.length) {
      const result = await admin.from('role_permissions').select('permission_id').eq('role_id', roleId).in('permission_id', permissionIds);
      if (result.error) return json({ error: 'Could not validate the selected role.' }, 500);
      elevated = result.data ?? [];
    }
    if (elevated?.length) {
      const { data: canManage } = await caller.rpc('has_permission', { permission_key: 'system.manage' });
      if (canManage !== true) return json({ error: 'Only a system administrator may issue an ID with an administrative role.' }, 403);
    }
  }

  const { data: existing, error: existingError } = await admin.from('profiles').select('id,is_active').eq('email', email).maybeSingle();
  if (existingError) return json({ error: 'Could not check whether this email is already registered.' }, 500);
  if (existing && !existing.is_active) return json({ error: 'This employee account is inactive.' }, 409);

  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 8; attempt++) {
    const random = crypto.getRandomValues(new Uint8Array(7));
    const registrationId = Array.from(random, (byte) => alphabet[byte % alphabet.length]).join('');
    const { error } = await admin.from('employee_registration_codes').insert({
      user_id: registrationId, email, full_name: fullName, role_id: roleId, created_by: user.id,
      ...(existing ? { status: 'claimed', claimed_by: existing.id, claimed_at: new Date().toISOString() } : {}),
    });
    if (!error) {
      if (existing && roleId) {
        const { error: assignmentError } = await admin.from('profile_roles').upsert({ profile_id: existing.id, role_id: roleId });
        if (assignmentError) {
          await admin.from('employee_registration_codes').delete().eq('user_id', registrationId);
          return json({ error: 'The ID was generated but the selected role could not be assigned.' }, 500);
        }
      }
      return json({ issued: true, user_id: registrationId, existing_account: Boolean(existing) }, 201);
    }
    if (error.code !== '23505') throw error;
    // A duplicate email is not fixed by generating another ID.
    const { data: emailInUse, error: emailLookupError } = await admin.from('employee_registration_codes').select('user_id').eq('email', email).in('status', ['issued','reserved','claimed']).maybeSingle();
    if (emailLookupError) return json({ error: 'Could not issue the employee ID.' }, 500);
    if (emailInUse) return json({ error: 'An active registration ID already exists for that email address.' }, 409);
  }
  return json({ error: 'Could not generate a unique employee ID. Try again.' }, 503);
}

async function registrationOptions(admin: SupabaseClient) {
  const { data, error } = await admin.from('teams')
    .select('id,name,default_project_id,projects:projects!teams_default_project_id_fkey(id,name,code,status)')
    .not('default_project_id', 'is', null)
    .order('name')
    .limit(500);
  if (error) return json({ error: 'Registration options are temporarily unavailable.' }, 503);
  const teams = (data ?? []).flatMap((team: Record<string, unknown>) => {
    const related = team.projects;
    const project = Array.isArray(related) ? related[0] : related;
    if (!project || typeof project !== 'object') return [];
    const item = project as Record<string, unknown>;
    if (!['planning', 'active'].includes(String(item.status))) return [];
    return [{ id: team.id, name: team.name, project_id: team.default_project_id, project_name: item.name, project_code: item.code }];
  });
  return json({ teams });
}

async function register(body: Record<string, unknown>, admin: SupabaseClient) {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const teamId = typeof body.team_id === 'string' ? body.team_id : '';
  const projectId = typeof body.project_id === 'string' ? body.project_id : '';
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const hasTeam = Boolean(teamId);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !fullName || fullName.length > 160 ||
      password.length < 10 || password.length > 128 || (hasTeam && (!uuidPattern.test(teamId) || !uuidPattern.test(projectId))) || (!hasTeam && Boolean(projectId))) {
    return json({ error: 'Enter your name, a valid email, and a password of at least 10 characters. If selecting a team, choose a valid team and project.' }, 400);
  }

  if (hasTeam) {
    const { data: team, error: teamError } = await admin.from('teams').select('id,default_project_id').eq('id', teamId).maybeSingle();
    if (teamError) return json({ error: 'The selected team could not be verified.' }, 503);
    if (!team || team.default_project_id !== projectId) return json({ error: 'Select a team with an available project.' }, 400);
    const { data: project, error: projectError } = await admin.from('projects').select('id,status').eq('id', projectId).maybeSingle();
    if (projectError || !project) return json({ error: 'The selected project could not be verified.' }, 400);
    if (!['planning', 'active'].includes(project.status)) return json({ error: 'Applications are only open for planning or active projects.' }, 400);
  }

  const { data: existingApplication, error: existingApplicationError } = await admin.from('employee_registration_requests')
    .select('id,status').eq('email', email).neq('status', 'rejected').maybeSingle();
  if (existingApplicationError) return json({ error: 'Registration is temporarily unavailable. Apply again later.' }, 503);
  if (existingApplication) return json({ error: 'An application for this email is already in progress or has been approved.' }, 409);
  const { data: activeId, error: activeIdError } = await admin.from('employee_registration_codes').select('user_id')
    .eq('email', email).in('status', ['issued', 'reserved', 'claimed']).maybeSingle();
  if (activeIdError) return json({ error: 'Registration is temporarily unavailable. Apply again later.' }, 503);
  if (activeId) return json({ error: 'An employee account or invitation already exists for this email. Contact your administrator.' }, 409);

  const { data: authResult, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
    user_metadata: { full_name: fullName },
  });
  if (authError || !authResult.user) {
    console.error('Registration Auth user creation failed', authError?.message ?? 'no user returned');
    return json({ error: 'Could not submit registration. An account may already exist for this email.' }, 409);
  }

  const { error: deactivateError } = await admin.from('profiles').update({ is_active: false }).eq('id', authResult.user.id);
  if (deactivateError) {
    await admin.auth.admin.deleteUser(authResult.user.id);
    console.error('Pending registration profile could not be restricted', deactivateError.message);
    return json({ error: 'Could not safely submit the registration request. Try again later.' }, 500);
  }

  const { error: requestError } = await admin.from('employee_registration_requests').insert({
    user_id: authResult.user.id, email, full_name: fullName, team_id: hasTeam ? teamId : null, project_id: hasTeam ? projectId : null,
    status: hasTeam ? 'pending_team_approval' : 'pending_assignment',
  });
  if (requestError) {
    await admin.auth.admin.deleteUser(authResult.user.id);
    if (requestError.code === '23505') return json({ error: 'An application for this email is already in progress or has been approved.' }, 409);
    console.error('Registration request creation failed', requestError.message);
    return json({ error: 'Could not submit the registration request. Try again later.' }, 500);
  }
  return json({ registered: true, status: hasTeam ? 'pending_team_approval' : 'pending_assignment' }, 201);
}

async function getCaller(request: Request, url: string, anonKey: string) {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error } = await caller.auth.getUser();
  return error || !user ? null : { caller, user };
}

async function hasSystemManage(caller: SupabaseClient) {
  const { data, error } = await caller.rpc('has_permission', { permission_key: 'system.manage' });
  return !error && data === true;
}

async function isTeamLead(admin: SupabaseClient, profileId: string, teamId: string) {
  const { data, error } = await admin.from('team_members').select('profile_id')
    .eq('team_id', teamId).eq('profile_id', profileId).eq('team_role', 'lead').maybeSingle();
  return !error && Boolean(data);
}

async function isProjectManager(admin: SupabaseClient, profileId: string, projectId: string) {
  const { data, error } = await admin.from('projects').select('id')
    .eq('id', projectId).eq('manager_id', profileId).maybeSingle();
  return !error && Boolean(data);
}

async function listRegistrationRequests(request: Request, url: string, anonKey: string, admin: SupabaseClient) {
  const context = await getCaller(request, url, anonKey);
  if (!context) return json({ error: 'Sign in to review employee registrations.' }, 401);
  const [{ data: teamMemberships, error: teamError }, { data: managedProjects, error: projectError }, superAdmin] = await Promise.all([
    admin.from('team_members').select('team_id').eq('profile_id', context.user.id).eq('team_role', 'lead'),
    admin.from('projects').select('id').eq('manager_id', context.user.id),
    hasSystemManage(context.caller),
  ]);
  if (teamError || projectError) return json({ error: 'Registration requests could not be loaded.' }, 503);
  const teamIds = new Set((teamMemberships ?? []).map((item: { team_id: string }) => item.team_id));
  const projectIds = new Set((managedProjects ?? []).map((item: { id: string }) => item.id));
  const hasManagerRole = Boolean((teamMemberships?.length ?? 0) || (managedProjects?.length ?? 0));
  const { data, error } = await admin.from('employee_registration_requests')
    .select('id,email,full_name,team_id,project_id,status,team_decision,team_review_comment,team_reviewed_at,project_decision,project_review_comment,project_reviewed_at,employee_id,created_at,teams(name),projects(name,code)')
    .in('status', ['pending_assignment','pending_team_approval','pending_project_approval','approved_pending_id','approved_pending_email'])
    .order('created_at', { ascending: true }).limit(200);
  if (error) return json({ error: 'Registration requests could not be loaded.' }, 503);
  const requests = (data ?? []).filter((item: Record<string, unknown>) => superAdmin ||
    (item.status === 'pending_assignment' && hasManagerRole) || teamIds.has(String(item.team_id)) || projectIds.has(String(item.project_id)));
  return json({ requests });
}

async function assignRegistration(request: Request, body: Record<string, unknown>, url: string, anonKey: string, admin: SupabaseClient) {
  const context = await getCaller(request, url, anonKey);
  if (!context) return json({ error: 'Sign in to assign this registration.' }, 401);
  const requestId = typeof body.request_id === 'string' ? body.request_id : '';
  const teamId = typeof body.team_id === 'string' ? body.team_id : '';
  const projectId = typeof body.project_id === 'string' ? body.project_id : '';
  if (!requestId || !/^[0-9a-f-]{36}$/i.test(teamId) || !/^[0-9a-f-]{36}$/i.test(projectId)) return json({ error: 'Choose an available team and project.' }, 400);
  const { data: registration, error } = await admin.from('employee_registration_requests').select('id,status').eq('id', requestId).maybeSingle();
  if (error || !registration) return json({ error: 'Registration request not found.' }, 404);
  if (registration.status !== 'pending_assignment') return json({ error: 'This registration has already been assigned.' }, 409);
  const { data: team } = await admin.from('teams').select('id,default_project_id').eq('id', teamId).maybeSingle();
  const { data: project } = await admin.from('projects').select('id,status').eq('id', projectId).maybeSingle();
  if (!team || team.default_project_id !== projectId || !project || !['planning','active'].includes(project.status)) return json({ error: 'Choose a team and its available project.' }, 400);
  const authorized = await hasSystemManage(context.caller) || await isTeamLead(admin, context.user.id, teamId) || await isProjectManager(admin, context.user.id, projectId);
  if (!authorized) return json({ error: 'Only the selected team lead or project manager can assign this registration.' }, 403);
  const { data: updated, error: updateError } = await admin.from('employee_registration_requests').update({ team_id: teamId, project_id: projectId, status: 'pending_team_approval' })
    .eq('id', requestId).eq('status', 'pending_assignment').select('id').maybeSingle();
  if (updateError || !updated) return json({ error: 'Assignment could not be saved. Refresh and try again.' }, 409);
  return json({ assigned: true, status: 'pending_team_approval', message: 'Team and project assigned. The team lead must now review this application.' });
}

async function reviewRegistration(request: Request, body: Record<string, unknown>, url: string, anonKey: string, admin: SupabaseClient) {
  const context = await getCaller(request, url, anonKey);
  if (!context) return json({ error: 'Sign in to review employee registrations.' }, 401);
  const requestId = typeof body.request_id === 'string' ? body.request_id : '';
  const stage = body.stage === 'team' || body.stage === 'project' ? body.stage : '';
  const decision = body.decision === 'approve' || body.decision === 'reject' ? body.decision : '';
  const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 800) : '';
  if (!requestId || !stage || !decision) return json({ error: 'Choose a valid approval stage and decision.' }, 400);
  const { data: registration, error: requestError } = await admin.from('employee_registration_requests')
    .select('*').eq('id', requestId).maybeSingle();
  if (requestError || !registration) return json({ error: 'Registration request not found.' }, 404);
  const superAdmin = await hasSystemManage(context.caller);
  const authorized = superAdmin || (stage === 'team'
    ? Boolean(registration.team_id && await isTeamLead(admin, context.user.id, registration.team_id))
    : Boolean(registration.project_id && await isProjectManager(admin, context.user.id, registration.project_id)));
  if (!authorized) return json({ error: 'You are not authorized to approve this registration at this stage.' }, 403);

  const expectedStatus = stage === 'team' ? 'pending_team_approval' : 'pending_project_approval';
  if (registration.status !== expectedStatus || (stage === 'project' && registration.team_decision !== 'approved')) {
    return json({ error: 'This registration is no longer awaiting your approval.' }, 409);
  }
  const approved = decision === 'approve';
  const patch = stage === 'team'
    ? { team_decision: approved ? 'approved' : 'rejected', team_reviewed_by: context.user.id,
        team_reviewed_at: new Date().toISOString(), team_review_comment: comment || null,
        status: approved ? 'pending_project_approval' : 'rejected' }
    : { project_decision: approved ? 'approved' : 'rejected', project_reviewed_by: context.user.id,
        project_reviewed_at: new Date().toISOString(), project_review_comment: comment || null,
        status: approved ? 'approved_pending_id' : 'rejected' };
  const { data: updated, error: updateError } = await admin.from('employee_registration_requests')
    .update(patch).eq('id', requestId).eq('status', expectedStatus).select('*').maybeSingle();
  if (updateError || !updated) return json({ error: 'The approval could not be saved. Refresh and check the current status.' }, 409);

  if (approved) {
    const issued = await ensureRegistrationEmployeeId(updated, context.user.id, admin);
    if (issued.error || !issued.employeeId) {
      return json({ approved: true, employee_id_pending: true, error: issued.error ?? 'The approval was saved, but the employee ID could not be created.' }, 200);
    }
    updated.employee_id = issued.employeeId;

    if (stage === 'project') {
      const result = await finalizeAndEmailEmployeeId(updated, context.user.id, admin);
      if (result.error) return json({ approved: true, employee_id: issued.employeeId, employee_id_sent: false, error: result.error }, 200);
      return json({ approved: true, employee_id: issued.employeeId, employee_id_sent: true, message: `Both approvals are recorded. Employee ID ${issued.employeeId} was saved and its email was accepted by the email provider.` });
    }
    return json({ approved: true, employee_id: issued.employeeId, status: updated.status, message: `Approval recorded. Employee ID ${issued.employeeId} is saved; account access will activate after the remaining approval.` });
  }
  return json({ approved: true, status: updated.status, message: approved ? 'Approval recorded.' : 'Registration rejected.' });
}

async function issueApprovedEmployeeId(request: Request, body: Record<string, unknown>, url: string, anonKey: string, admin: SupabaseClient) {
  const context = await getCaller(request, url, anonKey);
  if (!context) return json({ error: 'Sign in to issue the approved employee ID.' }, 401);
  const requestId = typeof body.request_id === 'string' ? body.request_id : '';
  if (!requestId) return json({ error: 'Registration request is required.' }, 400);
  const { data: registration, error } = await admin.from('employee_registration_requests').select('*').eq('id', requestId).maybeSingle();
  if (error || !registration) return json({ error: 'Registration request not found.' }, 404);
  const superAdmin = await hasSystemManage(context.caller);
  const canReview = superAdmin || (registration.team_id && await isTeamLead(admin, context.user.id, registration.team_id)) || (registration.project_id && await isProjectManager(admin, context.user.id, registration.project_id));
  if (!canReview) return json({ error: 'You are not authorized to issue this employee ID.' }, 403);
  if (!['approved_pending_id', 'approved_pending_email'].includes(registration.status) ||
      registration.team_decision !== 'approved' || registration.project_decision !== 'approved') {
    return json({ error: 'Both required approvals must be completed before activating the account and sending the employee ID email.' }, 409);
  }
  const result = await finalizeAndEmailEmployeeId(registration, context.user.id, admin);
  if (result.error) return json({ error: result.error }, 503);
  return json({ issued: true, email_sent: true, message: 'The employee ID email was accepted by the email provider.' });
}

async function finalizeAndEmailEmployeeId(registration: Record<string, any>, actorId: string, admin: SupabaseClient): Promise<{ error?: string }> {
  if (!registration.team_id || !registration.project_id || registration.team_decision !== 'approved' || registration.project_decision !== 'approved') {
    return { error: 'Assign a team and project, then record both approvals before activating the account and sending the employee ID email.' };
  }
  const issued = await ensureRegistrationEmployeeId(registration, actorId, admin);
  if (issued.error || !issued.employeeId) return { error: issued.error ?? 'The employee ID could not be created.' };
  const employeeId = issued.employeeId;
  const { data: role, error: roleLookupError } = await admin.from('roles').select('id').eq('name', 'General Staff Member').maybeSingle();
  if (roleLookupError || !role) return { error: `Employee ID ${employeeId} is saved, but the default General Staff Member role is not configured.` };

  const { error: roleError } = await admin.from('profile_roles').upsert({ profile_id: registration.user_id, role_id: role.id });
  if (roleError) return { error: 'Employee ID exists, but the default role assignment needs repair before sending.' };
  const { error: teamError } = await admin.from('team_members').upsert(
    { team_id: registration.team_id, profile_id: registration.user_id, team_role: 'member' },
    { onConflict: 'team_id,profile_id' },
  );
  if (teamError) return { error: 'Employee ID exists, but team assignment needs repair before sending.' };
  const { error: projectError } = await admin.from('project_members').upsert(
    { project_id: registration.project_id, profile_id: registration.user_id, access_level: 'member' },
    { onConflict: 'project_id,profile_id' },
  );
  if (projectError) return { error: 'Employee ID exists, but project assignment needs repair before sending.' };

  const { error: profileActivationError } = await admin.from('profiles').update({ is_active: true }).eq('id', registration.user_id);
  if (profileActivationError) return { error: 'Employee ID exists, but the employee profile could not be activated.' };

  const { error: profileError } = await admin.from('employee_registration_requests').update({
    employee_id: employeeId, status: 'approved_pending_email',
  }).eq('id', registration.id).in('status', ['approved_pending_id','approved_pending_email']);
  if (profileError) return { error: 'Employee ID exists, but the application could not be updated for delivery.' };
  const { error: activateError } = await admin.auth.admin.updateUserById(registration.user_id, { email_confirm: true });
  if (activateError) {
    console.error('Approved account activation failed', activateError.message);
    return { error: 'Employee ID exists, but the employee account could not be activated. Retry after checking Auth.' };
  }

  const resendKey = Deno.env.get('RESEND_API_KEY');
  const emailFrom = Deno.env.get('EMPLOYEE_ID_EMAIL_FROM');
  if (!resendKey || !emailFrom) return { error: `Employee ID ${employeeId} is saved and the account is approved, but email delivery is not configured.` };

  const appOrigin = Deno.env.get('APP_ORIGIN');
  const loginUrl = appOrigin && appOrigin !== '*' ? `${appOrigin.replace(/\/$/, '')}/login` : 'the organization sign-in page';
  const safeName = escapeHtml(String(registration.full_name));
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: emailFrom,
      to: [registration.email],
      subject: 'Your VAI Project Manager employee ID',
      text: `Hello ${registration.full_name},\n\nYour registration has been approved. Your employee ID is ${employeeId}.\n\nUse this ID with the password you created to sign in at ${loginUrl}. Keep your employee ID private.`,
      html: `<p>Hello ${safeName},</p><p>Your registration has been approved.</p><p>Your employee ID is <strong>${employeeId}</strong>.</p><p>Use this ID with the password you created to sign in at <a href="${escapeHtml(loginUrl)}">VAI Project Manager</a>. Keep your employee ID private.</p>`,
    }),
  });
  if (!response.ok) {
    console.error('Employee ID email delivery failed', response.status, (await response.text()).slice(0, 500));
    return { error: 'The employee ID was created but the email could not be sent. Retry the email action after checking the email provider.' };
  }
  const { error: sentUpdateError } = await admin.from('employee_registration_requests').update({
    status: 'approved', employee_id_email_sent_at: new Date().toISOString(),
  }).eq('id', registration.id).eq('status', 'approved_pending_email');
  if (sentUpdateError) return { error: 'The employee ID email was sent, but delivery status could not be saved. Refresh before retrying.' };
  return {};
}

async function ensureRegistrationEmployeeId(registration: Record<string, any>, actorId: string, admin: SupabaseClient): Promise<{ employeeId?: string; error?: string }> {
  const { data: existing, error: existingError } = await admin.from('employee_registration_codes').select('user_id,status,claimed_by')
    .eq('email', registration.email).in('status', ['issued','reserved','claimed']).maybeSingle();
  if (existingError) return { error: 'Could not check for an existing employee ID.' };

  let employeeId = '';
  if (existing) {
    if (existing.status !== 'claimed' || existing.claimed_by !== registration.user_id) {
      return { error: 'An employee ID record already exists for this email. Ask an administrator to resolve the existing account.' };
    }
    employeeId = existing.user_id;
  } else {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 8 && !employeeId; attempt++) {
      const random = crypto.getRandomValues(new Uint8Array(7));
      const candidate = attempt === 0 && typeof registration.employee_id === 'string' && idPattern.test(registration.employee_id)
        ? registration.employee_id
        : Array.from(random, byte => alphabet[byte % alphabet.length]).join('');
      const { error: codeError } = await admin.from('employee_registration_codes').insert({
        user_id: candidate, email: registration.email, full_name: registration.full_name,
        status: 'claimed', claimed_by: registration.user_id, claimed_at: new Date().toISOString(), created_by: actorId,
      });
      if (!codeError) employeeId = candidate;
      else if (codeError.code === '23505') {
        const { data: racedCode, error: racedLookupError } = await admin.from('employee_registration_codes')
          .select('user_id,status,claimed_by').eq('email', registration.email)
          .in('status', ['issued','reserved','claimed']).maybeSingle();
        if (racedLookupError) return { error: 'Could not resolve a concurrent employee ID request.' };
        if (racedCode?.status === 'claimed' && racedCode.claimed_by === registration.user_id) employeeId = racedCode.user_id;
        else if (racedCode) return { error: 'An employee ID record already exists for this email. Ask an administrator to resolve it.' };
      } else {
        console.error('Approved employee ID creation failed', codeError.message);
        return { error: 'Approval was saved, but the employee ID could not be created.' };
      }
    }
    if (!employeeId) return { error: 'Could not generate a unique employee ID. Retry the approval.' };
  }

  const { error: saveError } = await admin.from('employee_registration_requests')
    .update({ employee_id: employeeId }).eq('id', registration.id).neq('status', 'rejected');
  if (saveError) return { error: 'The employee ID record exists, but it could not be attached to the application. Retry the approval.' };
  return { employeeId };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

async function login(body: Record<string, unknown>, publicAuth: SupabaseClient, admin: SupabaseClient) {
  const userId = normalizeId(body.user_id);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) return json({ error: 'Employee ID or password is incorrect.' }, 400);
  if (userId.includes('@')) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userId) || userId.length > 254) return json({ error: 'Employee ID or password is incorrect.' }, 401);
    const { data, error } = await publicAuth.auth.signInWithPassword({ email: userId.toLowerCase(), password });
    if (error || !data.session) return json({ error: 'Employee ID or password is incorrect.' }, 401);
    const identityClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: canManage, error: permissionError } = await identityClient.rpc('has_permission', { permission_key: 'system.manage' });
    if (permissionError || canManage !== true) return json({ error: 'Use the employee ID issued by your administrator.' }, 403);
    return json({ signed_in: true, session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token } });
  }
  if (!idPattern.test(userId)) return json({ error: 'Employee ID or password is incorrect.' }, 401);
  const { data: registration } = await admin.from('employee_registration_codes').select('email')
    .eq('user_id', userId).eq('status', 'claimed').maybeSingle();
  if (!registration) return json({ error: 'Employee ID or password is incorrect.' }, 400);
  const { data, error } = await publicAuth.auth.signInWithPassword({ email: registration.email, password });
  if (error || !data.session) return json({ error: 'Employee ID or password is incorrect.' }, 401);
  return json({ signed_in: true, session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token } });
}

async function resetPassword(body: Record<string, unknown>, publicAuth: SupabaseClient, admin: SupabaseClient) {
  const configuredRedirect = Deno.env.get('PASSWORD_RESET_REDIRECT_URL');
  const appOrigin = Deno.env.get('APP_ORIGIN');
  let redirectTo: string;
  try {
    if (configuredRedirect) {
      const redirect = new URL(configuredRedirect);
      if (!['/auth/callback', '/update-password'].includes(redirect.pathname)) throw new Error('Password reset redirect must use /update-password.');
      redirect.pathname = '/update-password';
      redirect.search = '';
      redirectTo = redirect.toString();
    } else if (appOrigin && appOrigin !== '*') {
      const appUrl = new URL(appOrigin);
      if (appUrl.protocol !== 'https:' && appUrl.hostname !== 'localhost') throw new Error('APP_ORIGIN must use HTTPS.');
      redirectTo = new URL('/update-password', appUrl.origin).toString();
    } else {
      console.error('Password reset is not configured: set PASSWORD_RESET_REDIRECT_URL or APP_ORIGIN.');
      return json({ error: 'Password recovery is not configured. Set PASSWORD_RESET_REDIRECT_URL to the app URL ending in /update-password.' }, 503);
    }
  } catch (error) {
    console.error('Invalid password reset redirect configuration', error instanceof Error ? error.message : 'unknown error');
    return json({ error: 'Password recovery redirect must be a full app URL ending in /update-password.' }, 503);
  }

  const userId = normalizeId(body.user_id);
  if (idPattern.test(userId)) {
    const { data: registration } = await admin.from('employee_registration_codes').select('email')
      .eq('user_id', userId).eq('status', 'claimed').maybeSingle();
    if (registration) {
      const { error } = await publicAuth.auth.resetPasswordForEmail(registration.email, { redirectTo });
      if (error) console.error('Supabase could not send the password recovery email', error.message);
    }
  }
  // Identical responses avoid revealing which employee IDs have an account.
  return json({ requested: true, message: 'If the employee ID matches an account, password reset instructions will be sent to its registered email.' });
}
