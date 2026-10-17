import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const authorization = request.headers.get('Authorization');
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!authorization?.startsWith('Bearer ') || !url || !anonKey || !serviceKey) {
    return json({ error: 'Authentication or server configuration is missing.' }, 401);
  }

  try {
    const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: authError } = await callerClient.auth.getUser();
    if (authError || !user) return json({ error: 'Sign in before inviting a member.' }, 401);
    const { data: canCreate, error: createCheckError } = await callerClient.rpc('has_permission', { permission_key: 'users.create' });
    if (createCheckError || canCreate !== true) return json({ error: 'You do not have permission to invite members.' }, 403);

    const payload = await request.json();
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    const fullName = typeof payload.full_name === 'string' ? payload.full_name.trim() : '';
    const roleId = typeof payload.role_id === 'string' && payload.role_id ? payload.role_id : null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !fullName || fullName.length > 160) {
      return json({ error: 'Enter a valid email and a name up to 160 characters.' }, 400);
    }

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    if (roleId) {
      const { data: canAssign, error: assignCheckError } = await callerClient.rpc('has_permission', { permission_key: 'users.assign_roles' });
      if (assignCheckError || canAssign !== true) return json({ error: 'You do not have permission to assign a role.' }, 403);
      const { data: role, error: roleError } = await admin.from('roles').select('id,name').eq('id', roleId).maybeSingle();
      if (roleError || !role) return json({ error: 'The selected role does not exist.' }, 400);
      const protectedKeys = ['system.manage', 'users.assign_roles', 'users.create', 'users.edit', 'users.disable'];
      const { data: protectedPermissions, error: protectedPermissionError } = await admin.from('permissions').select('id').in('key', protectedKeys);
      if (protectedPermissionError) return json({ error: 'Could not validate the selected role.' }, 500);
      const permissionIds = (protectedPermissions ?? []).map((permission) => permission.id);
      const { data: elevatedRolePermissions, error: rolePermissionError } = permissionIds.length
        ? await admin.from('role_permissions').select('permission_id').eq('role_id', roleId).in('permission_id', permissionIds)
        : { data: [], error: null };
      if (rolePermissionError) return json({ error: 'Could not validate the selected role.' }, 500);
      if (elevatedRolePermissions?.length) {
        const { data: canManage } = await callerClient.rpc('has_permission', { permission_key: 'system.manage' });
        if (canManage !== true) return json({ error: 'Only a system administrator may assign a role with administrative permissions.' }, 403);
      }
    }

    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let registrationId = '';
    for (let attempt = 0; attempt < 8; attempt++) {
      registrationId = Array.from(crypto.getRandomValues(new Uint8Array(7)), (byte) => alphabet[byte % alphabet.length]).join('');
      const { error } = await admin.from('employee_registration_codes').insert({
        user_id: registrationId, email, full_name: fullName, role_id: roleId,
        created_by: user.id,
      });
      if (!error) break;
      if (error.code !== '23505') return json({ error: 'Could not issue an employee ID.' }, 500);
      const { data: duplicateEmail, error: lookupError } = await admin.from('employee_registration_codes').select('user_id')
        .eq('email', email).in('status', ['issued','reserved','claimed']).maybeSingle();
      if (lookupError) return json({ error: 'Could not validate the employee ID.' }, 500);
      if (duplicateEmail) return json({ error: 'An active employee ID already exists for that email address.' }, 409);
      registrationId = '';
    }
    if (!registrationId) return json({ error: 'Could not generate a unique employee ID. Try again.' }, 503);

    const redirectTo = Deno.env.get('INVITE_REDIRECT_URL');
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName, employee_user_id: registrationId },
      ...(redirectTo ? { redirectTo } : {}),
    });
    if (inviteError || !invited.user) {
      await admin.from('employee_registration_codes').delete().eq('user_id', registrationId).eq('status', 'issued');
      return json({ error: inviteError?.message ?? 'Invitation failed.' }, 400);
    }

    const { error: claimError } = await admin.from('employee_registration_codes').update({
      status: 'claimed', claimed_by: invited.user.id, claimed_at: new Date().toISOString(),
    }).eq('user_id', registrationId).eq('status', 'issued');
    if (claimError) {
      await admin.auth.admin.deleteUser(invited.user.id);
      await admin.from('employee_registration_codes').delete().eq('user_id', registrationId);
      return json({ error: 'The invitation was rolled back because its employee ID could not be finalized.' }, 500);
    }

    if (roleId) {
      // Auth-user insert provisions public.profiles through the migration trigger.
      const { error: roleAssignmentError } = await admin.from('profile_roles').insert({ profile_id: invited.user.id, role_id: roleId });
      if (roleAssignmentError) {
        return json({ invited: true, user_id: invited.user.id, employee_id: registrationId, role_assigned: false, warning: 'The invitation and ID were created, but the role needs administrator setup.' }, 201);
      }
    }
    return json({ invited: true, user_id: invited.user.id, employee_id: registrationId, role_assigned: Boolean(roleId) }, 201);
  } catch {
    return json({ error: 'Invalid request or invitation could not be completed.' }, 400);
  }
});
