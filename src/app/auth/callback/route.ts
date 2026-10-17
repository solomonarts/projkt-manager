import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const destination = url.searchParams.get('next');
  const nextPath = destination === '/update-password' ? '/update-password' : '/';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(nextPath, url.origin));
  }
  const recovery = nextPath === '/update-password';
  const failure = new URL(recovery ? '/update-password' : '/login', url.origin);
  failure.searchParams.set('error', recovery ? 'recovery_link_invalid' : 'invite_link_invalid');
  return NextResponse.redirect(failure);
}
