// lib/engine/db.ts
// Focus Studio Pipeline Engine
// Database client for Supabase
// Reads from existing: brokers, partners, prospects, activities, touch_log
// Writes to new: signals, drafts, watchlist, agent_runs
// NOTE: next_due and last_touch are stored as TEXT in brokers/partners

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Lazily create the client on first use. Instantiating at module load made the
// client construct during Next.js's build-time "Collecting page data" phase,
// which throws when env vars aren't present and forces these routes to be
// evaluated at build instead of request time.
let _client: SupabaseClient | null = null;
function getClient(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  return _client;
}

const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getClient() as unknown as Record<string | symbol, unknown>;
    const value = client[prop];
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(client) : value;
  },
});

// ============================================================
// CONTACTS - reads from existing tables
// ============================================================

export async function getBrokersDueForTouch() {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  const { data, error } = await supabase
    .from('brokers')
    .select('*')
    .neq('tier', 'D')
    .neq('status', 'inactive')
    .order('tier', { ascending: true });

  if (error) throw new Error(`getBrokersDueForTouch: ${error.message}`);
  
  // Filter in JS since next_due is stored as text
  const due = (data || []).filter(b => {
    if (!b.next_due) return true; // never touched, always due
    return b.next_due <= today;
  });

  return due;
}

export async function getPartnersDueForTouch() {
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('partners')
    .select('*')
    .neq('tier', 'D')
    .order('tier', { ascending: true });

  if (error) throw new Error(`getPartnersDueForTouch: ${error.message}`);

  const due = (data || []).filter(p => {
    if (!p.next_due) return true;
    return p.next_due <= today;
  });

  return due;
}

export async function getBrokerById(id: string) {
  const { data } = await supabase
    .from('brokers')
    .select('*')
    .eq('id', id)
    .single();
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

export async function getRecentActivity(contactId: string) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoff = thirtyDaysAgo.toISOString().split('T')[0];

  const { data } = await supabase
    .from('touch_log')
    .select('*')
    .eq('contact_id', contactId)
    .gte('date', cutoff)
    .order('date', { ascending: false })
    .limit(1);

  return data?.[0] || null;
}

export async function hasOpenTask(contactId: string) {
  const { data } = await supabase
    .from('activities')
    .select('id')
    .eq('contact_id', contactId)
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
