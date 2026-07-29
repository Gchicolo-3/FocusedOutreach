// app/api/engine/drafts/route.ts
// Returns pending drafts and records approve/edit/kill decisions.
// Requires the engine Bearer secret: drafts carry contact PII and PATCH
// mutates review state. Dashboard access must go through a server-side
// proxy that injects the secret (see app/api/engine/trigger/route.ts).

import { NextResponse } from 'next/server';
import { isEngineRequestAuthorized } from '@/lib/engine/auth';
import { getServerSupabase } from '@/lib/serverSupabase';

// Reads/writes live Supabase data on every request — never prerender at build time.
export const dynamic = 'force-dynamic';

// Service-role client (required in production) so this keeps working with RLS
// locked down — see lib/serverSupabase.ts.
function getSupabase() {
  return getServerSupabase();
}

// GET /api/engine/drafts - fetch pending drafts
export async function GET(request: Request) {
  if (!isEngineRequestAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('drafts')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ drafts: data || [] });
}

// PATCH /api/engine/drafts - approve, edit, or kill a draft
export async function PATCH(request: Request) {
  if (!isEngineRequestAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  const body = await request.json();
  const { id, status, edited_body } = body;

  if (!id || !status) {
    return NextResponse.json({ error: 'id and status required' }, { status: 400 });
  }

  const validStatuses = ['approved', 'edited', 'killed', 'sent'];
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: 'invalid status' }, { status: 400 });
  }

  const update: any = { status };
  if (edited_body) update.edited_body = edited_body;
  if (status === 'sent') update.sent_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('drafts')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ draft: data });
}
