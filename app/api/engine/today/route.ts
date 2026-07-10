// app/api/engine/today/route.ts
// Returns today's ranked priority list for the dashboard
// This is what George sees first thing in the morning

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isEngineRequestAuthorized } from '@/lib/engine/auth';

// Reads live data from Supabase on every request — never prerender at build time.
export const dynamic = 'force-dynamic';

// Service role key so this keeps working once RLS locks these tables down;
// anon fallback preserves dev setups without the service key.
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function GET(request: Request) {
  if (!isEngineRequestAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  const today = new Date().toISOString().split('T')[0];

  // Get pending drafts
  const { data: drafts } = await supabase
    .from('drafts')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  // Get new signals from today
  const { data: signals } = await supabase
    .from('signals')
    .select('*')
    .eq('status', 'actionable')
    .gte('created_at', `${today}T00:00:00`)
    .order('iq_score', { ascending: false });

  // Get brokers overdue for touch
  const { data: brokers } = await supabase
    .from('brokers')
    .select('id, first_name, last_name, firm, tier, last_touch, next_due, status')
    .lte('next_due', today)
    .neq('status', 'inactive')
    .in('tier', ['A', 'B'])
    .order('tier', { ascending: true })
    .order('next_due', { ascending: true })
    .limit(10);

  // Get last engine run
  const { data: lastRun } = await supabase
    .from('agent_runs')
    .select('run_date, status, signals_found, drafts_created, contacts_flagged')
    .order('run_date', { ascending: false })
    .limit(1)
    .single();

  return NextResponse.json({
    date: today,
    summary: {
      pendingDrafts: drafts?.length || 0,
      newSignals: signals?.length || 0,
      overdueContacts: brokers?.length || 0,
      lastRun: lastRun || null
    },
    drafts: drafts || [],
    signals: signals || [],
    overdueContacts: brokers || []
  });
}
