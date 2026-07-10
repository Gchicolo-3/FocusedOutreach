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

// Lowercased alphanumeric-and-spaces form of free text, for name-in-summary
// matching. Collapses whitespace so "J.  Smith" and "j smith" compare equal.
export function normalizeText(text?: string | null): string {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// True when the summary text actually names this person. This is the
// confidence gate for attaching a signal to a broker: a firm-name match alone
// is not enough to know WHICH person at the firm the news is about.
export function summaryMentionsName(
  summary: string,
  firstName?: string | null,
  lastName?: string | null
): boolean {
  const first = normalizeText(firstName);
  const last = normalizeText(lastName);
  if (!first || !last) return false;
  const haystack = ` ${normalizeText(summary)} `;
  return haystack.includes(` ${first} ${last} `);
}

// Match a signal to a broker only when we're confident it's about that
// specific person: the company must resemble their firm AND the summary must
// name them. Anything less returns null and the signal stays unattached —
// a missed match costs a warm angle; a false match drafts a message to the
// wrong human about someone else's deal.
export async function findBrokerForSignal(companyName: string, summary: string) {
  const company = normalizeText(companyName);
  if (company.length < 3 || !summary) return null;

  // ilike is substring-only, so candidates are broad; the name gate below is
  // what makes the final match safe. Strip ilike wildcards from the input.
  const pattern = `%${companyName.replace(/[%_]/g, ' ').trim()}%`;
  const { data, error } = await supabase
    .from('brokers')
    .select('*')
    .ilike('firm', pattern)
    .limit(50);

  if (error) {
    console.error('findBrokerForSignal:', error.message);
    return null;
  }

  return (
    (data || []).find((b) => summaryMentionsName(summary, b.first_name, b.last_name)) || null
  );
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

// Lowercased alphanumeric form of a contact name, so "Peter Shikar",
// "peter shikar" and "Peter  Shikar" all dedupe to the same key.
export function normalizeContactName(name?: string | null): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Dedup keys (contact ids AND normalized names) for contacts that already
// have a pending (unreviewed) draft. Name keys catch the same person existing
// under different ids (e.g. a row in both brokers and partners), which
// id-only dedup missed.
export async function getPendingDraftKeys(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('drafts')
    .select('contact_id, contact_name')
    .eq('status', 'pending');

  if (error) {
    console.error('getPendingDraftKeys:', error.message);
    return new Set();
  }

  const keys = new Set<string>();
  for (const r of data || []) {
    if (r.contact_id) keys.add(String(r.contact_id));
    const nameKey = normalizeContactName(r.contact_name);
    if (nameKey) keys.add(`name:${nameKey}`);
  }
  return keys;
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
