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
      case 'register': return await register(body, publicAuth, admin);
      case 'login': return await login(body, publicAuth, admin);
      case 'reset_password': return await resetPassword(body, publicAuth, admin);
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

async function register(body: Record<string, unknown>, publicAuth: SupabaseClient, admin: SupabaseClient) {
  const userId = normalizeId(body.user_id);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!idPattern.test(userId) || password.length < 10 || password.length > 128) {
    return json({ error: 'Enter a valid employee ID and a password with at least 10 characters.' }, 400);
  }

  // Release a stale reservation if a prior signup request was interrupted.
  const expiredAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  await admin.from('employee_registration_codes').update({ status: 'issued', reserved_at: null })
    .eq('user_id', userId).eq('status', 'reserved').lt('reserved_at', expiredAt);
  const { data: code, error: reserveError } = await admin.from('employee_registration_codes')
    .update({ status: 'reserved', reserved_at: new Date().toISOString() })
    .eq('user_id', userId).eq('status', 'issued')
    .select('user_id,email,full_name,role_id').maybeSingle();
  if (reserveError || !code) return json({ error: 'This employee ID is invalid, already used, or unavailable.' }, 400);

  const { data, error } = await admin.auth.admin.createUser({
    email: code.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: code.full_name },
  });
  if (error || !data.user) {
    await admin.from('employee_registration_codes').update({ status: 'issued', reserved_at: null }).eq('user_id', userId).eq('status', 'reserved');
    return json({ error: 'Registration could not be completed. Check the employee ID or contact your administrator.' }, 400);
  }

  const { error: claimError } = await admin.from('employee_registration_codes').update({
    status: 'claimed', reserved_at: null, claimed_by: data.user.id, claimed_at: new Date().toISOString(),
  }).eq('user_id', userId).eq('status', 'reserved');
  if (claimError) return json({ error: 'Your account was created but the ID could not be finalized. Contact an administrator.' }, 500);

  if (code.role_id) {
    const { error: roleError } = await admin.from('profile_roles').insert({ profile_id: data.user.id, role_id: code.role_id });
    if (roleError) return json({ error: 'Your account was created but its role needs administrator setup.' }, 500);
  }

  const { data: signIn, error: signInError } = await publicAuth.auth.signInWithPassword({ email: code.email, password });
  if (signInError || !signIn.session) return json({ error: 'Your account was created. Sign in with your employee ID and password.' }, 201);
  return json({ registered: true, session: {
    access_token: signIn.session.access_token, refresh_token: signIn.session.refresh_token,
  } }, 201);
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
