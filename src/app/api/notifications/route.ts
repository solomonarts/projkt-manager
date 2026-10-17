import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const { data, error } = await supabase.from('notifications').select('id,kind,title,body,entity_type,entity_id,read_at,created_at').order('created_at', { ascending: false }).limit(30);
  if (error) return NextResponse.json({ error: 'Could not load notifications' }, { status: 500 });
  return NextResponse.json({ notifications: data ?? [] });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  let body: { id?: unknown; all?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }
  let query = supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
  if (body.all !== true) {
    if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)) return NextResponse.json({ error: 'A valid notification id is required' }, { status: 400 });
    query = query.eq('id', body.id);
  }
  const { error } = await query;
  if (error) return NextResponse.json({ error: 'Could not update notification' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
