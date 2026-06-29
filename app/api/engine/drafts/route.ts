// app/api/engine/drafts/route.ts
// Returns pending drafts for the dashboard
// Dashboard polls this to show George what needs review

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// GET /api/engine/drafts - fetch pending drafts
export async function GET() {
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
