// lib/engine/db.ts
// Focus Studio Pipeline Engine
// Database client for Supabase
// Reads from existing: brokers, partners, prospects, activities, touch_log
// Writes to new: signals, drafts, watchlist, agent_runs

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ============================================================
// CONTACTS - reads from existing tables
// ============================================================

export async function getBrokersDueForTouch() {
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('brokers')
    .select('*')
    .neq('tier', 'D')
    .neq('status', 'inactive')
    .lte('next_due', today)
    .order('tier', { ascending: true })
    .order('next_due', { ascending: true });

  if (error) throw new Error(`getBrokersDueForTouch: ${error.message}`);
  return data || [];
}

export async function getPartnersDueForTouch() {
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('partners')
    .select('*')
    .neq('tier', 'D')
    .lte('next_due', today)
    .order('tier', { ascending: true })
    .order('next_due', { ascending: true });

  if (error) throw new Error(`getPartnersDueForTouch: ${error.message}`);
  return data || [];
}

export async function getBrokerById(id: string) {
  const { data, error } = await supabase
    .from('brokers')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return null;
  return data;
}

export async function findBrokerByFirmOrName(name: string, firm?: string) {
  let query = supabase.from('brokers').select('*');

  if (firm) {
    query = query.ilike('firm', `%${firm}%`);
  } else {
    query = query.or(`first_name.ilike.%${name}%,last_name.ilike.%${name}%`);
  }

  const { data } = await query.limit(1);
  return data?.[0] || null;
}

// Check crossing-over: has this contact had recent activity by anyone?
export async function getRecentActivity(contactId: string) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data } = await supabase
    .from('touch_log')
    .select('*')
    .eq('contact_id', contactId)
    .gte('date', thirtyDaysAgo.toISOString().split('T')[0])
    .order('date', { ascending: false })
    .limit(1);

  return data?.[0] || null;
}

// Check if contact has an open task in activities
export async function hasOpenTask(contactKey: string) {
  const { data } = await supabase
    .from('activities')
    .select('*')
    .eq('contact_key', contactKey)
    .eq('status', 'pending')
    .limit(1);

  return (data?.length || 0) > 0;
}

// ============================================================
// SIGNALS
// ============================================================

export async function saveSignal(signal: {
  signal_type: string;
  tier_recommendation: string;
  contact_id?: string;
  contact_table?: string;
  company_name?: string;
  summary: string;
  source_url?: string;
  source_name?: string;
  signal_date?: string;
}) {
  const { data, error } = await supabase
    .from('signals')
    .insert(signal)
    .select()
    .single();

  if (error) {
    console.error('saveSignal error:', error.message);
    return null;
  }
  return data;
}

export async function updateSignalStatus(id: string, status: string, score: number) {
  const { data } = await supabase
    .from('signals')
    .update({ status, iq_score: score })
    .eq('id', id)
    .select()
    .single();
  return data;
}

export async function addToWatchlist(item: {
  signal_id: string;
  company_name?: string;
  contact_id?: string;
  contact_table?: string;
  reason: string;
  check_date: string;
}) {
  const { data } = await supabase
    .from('watchlist')
    .insert(item)
    .select()
    .single();
  return data;
}

// ============================================================
// DRAFTS
// ============================================================

export async function saveDraft(draft: {
  contact_id?: string;
  contact_table?: string;
  contact_name?: string;
  contact_company?: string;
  signal_id?: string;
  channel: string;
  subject?: string;
  body: string;
  draft_type: string;
  signal_summary?: string;
}) {
  const { data, error } = await supabase
    .from('drafts')
    .insert({ ...draft, status: 'pending' })
    .select()
    .single();

  if (error) {
    console.error('saveDraft error:', error.message);
    return null;
  }
  return data;
}

export async function getPendingDrafts() {
  const { data, error } = await supabase
    .from('drafts')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) throw new Error(`getPendingDrafts: ${error.message}`);
  return data || [];
}

export async function updateDraftStatus(
  id: string,
  status: 'approved' | 'edited' | 'killed' | 'sent',
  editedBody?: string
) {
  const update: any = { status };
  if (editedBody) update.edited_body = editedBody;
  if (status === 'sent') update.sent_at = new Date().toISOString();

  const { data } = await supabase
    .from('drafts')
    .update(update)
    .eq('id', id)
    .select()
    .single();
  return data;
}

// ============================================================
// AGENT RUNS
// ============================================================

export async function logAgentRun(run: {
  agentName: string;
  status: string;
  signalsFound: number;
  draftsCreated: number;
  contactsFlagged: number;
  errors?: string;
  runtimeMs: number;
}) {
  await supabase.from('agent_runs').insert({
    agent_name: run.agentName,
    status: run.status,
    signals_found: run.signalsFound,
    drafts_created: run.draftsCreated,
    contacts_flagged: run.contactsFlagged,
    errors: run.errors || null,
    runtime_ms: run.runtimeMs
  });
}
