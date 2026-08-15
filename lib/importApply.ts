// Executes an ImportPlan (lib/importEngine.ts) against Supabase, and backs
// the Import Review tab: listing unresolved activity rows and applying the
// human's decision (link to a candidate / create a contact / mark junk).
//
// Write order matters: contacts are created first, then enriched, then
// activity rows land — so every activity row that claims a linkage points at
// a contact that already exists.

import { supabase } from './supabase';
import {
  buildNewContactRow,
  computeEnrichment,
  type ActivityUpsert,
  type ImportPlan,
} from './importEngine';
import type { ContactTable } from './identity';

const BATCH = 100;

export type ApplyResult = {
  created: number;
  updated: number;
  activities: number;
  review: number;
  errors: string[];
};

// Existing activity rows must merge, not be clobbered: comments concatenate,
// the newer date's activity fields win, and a linkage a human (or the app's
// own logger) already established is never downgraded by a re-import.
function mergeWithExisting(
  incoming: ActivityUpsert,
  existing: Record<string, unknown> | undefined
): ActivityUpsert {
  if (!existing) return incoming;
  const merged = { ...incoming };

  const prevComments = String(existing.comments || '');
  if (prevComments && merged.comments && !prevComments.includes(merged.comments)) {
    merged.comments = `${prevComments} | ${merged.comments}`;
  } else if (prevComments && !merged.comments) {
    merged.comments = prevComments;
  }

  const prevDate = String(existing.date || '');
  if (prevDate && (!merged.date || prevDate > merged.date)) {
    merged.date = prevDate;
    merged.subject = String(existing.subject || '') || merged.subject;
    merged.activity_type = String(existing.activity_type || '') || merged.activity_type;
    merged.status = String(existing.status || '') || merged.status;
    merged.priority = String(existing.priority || '') || merged.priority;
  }

  merged.email = merged.email || (existing.email as string | null) || null;
  merged.mobile = merged.mobile || (existing.mobile as string | null) || null;

  // Human and in-app resolutions outrank anything the matcher re-derives.
  const prevMethod = String(existing.match_method || '');
  const prevStatus = String(existing.match_status || '');
  const keepPrev =
    prevMethod === 'manual' || prevMethod === 'logged' ||
    (prevStatus === 'matched' && merged.match_status !== 'matched');
  if (keepPrev && prevStatus) {
    merged.contact_table = (existing.contact_table as string | null) || null;
    merged.contact_id = (existing.contact_id as string | null) || null;
    merged.match_status = prevStatus;
    merged.match_method = prevMethod || null;
    merged.match_confidence = (existing.match_confidence as number | null) ?? null;
    merged.match_candidates = null;
  }
  return merged;
}

export async function applyImportPlan(plan: ImportPlan): Promise<ApplyResult> {
  const result: ApplyResult = {
    created: 0, updated: 0, activities: 0,
    review: plan.review.length, errors: [],
  };

  // 1. Create new contacts.
  const byTable = new Map<ContactTable, Record<string, unknown>[]>();
  for (const c of plan.creates) {
    const list = byTable.get(c.table) || [];
    list.push(c.row);
    byTable.set(c.table, list);
  }
  for (const [table, rows] of byTable) {
    for (let i = 0; i < rows.length; i += BATCH) {
      const { error } = await supabase.from(table).upsert(rows.slice(i, i + BATCH));
      if (error) result.errors.push(`${table} create: ${error.message}`);
      else result.created += Math.min(BATCH, rows.length - i);
    }
  }

  // 2. Enrich matched contacts (targeted column updates only).
  for (const u of plan.updates) {
    const { error } = await supabase.from(u.table).update(u.set).eq('id', u.id);
    if (error) result.errors.push(`${u.table}/${u.id}: ${error.message}`);
    else result.updated++;
  }

  // 3. Merge + upsert activity rows.
  const keys = plan.activities.map((a) => a.contact_key);
  const existingByKey = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < keys.length; i += BATCH) {
    const { data, error } = await supabase
      .from('activities')
      .select('contact_key, comments, date, subject, activity_type, status, priority, email, mobile, contact_table, contact_id, match_status, match_method, match_confidence')
      .in('contact_key', keys.slice(i, i + BATCH));
    if (error) {
      result.errors.push(`activities read: ${error.message}`);
      continue;
    }
    for (const row of data || []) existingByKey.set(String(row.contact_key), row);
  }

  const merged = plan.activities.map((a) => mergeWithExisting(a, existingByKey.get(a.contact_key)));
  for (let i = 0; i < merged.length; i += BATCH) {
    const { error } = await supabase.from('activities').upsert(merged.slice(i, i + BATCH));
    if (error) result.errors.push(`activities write: ${error.message}`);
    else result.activities += Math.min(BATCH, merged.length - i);
  }

  return result;
}

// ============ IMPORT REVIEW QUEUE ============

export type ReviewCandidate = { table: ContactTable; id: string; name: string; company: string };

export type ReviewRecord = {
  contactKey: string;
  name: string;
  company: string;
  email: string | null;
  mobile: string | null;
  date: string | null;
  comments: string | null;
  reason: 'ambiguous' | 'needs_type';
  candidates: ReviewCandidate[];
};

// Unresolved rows: ambiguous matches (import or backfill) and clean new
// people the CSV couldn't type. Junk and matched rows never show here.
export async function getReviewRecords(): Promise<ReviewRecord[]> {
  const { data, error } = await supabase
    .from('activities')
    .select('contact_key, full_name, company, email, mobile, date, comments, match_status, match_method, match_candidates')
    .or('match_status.eq.ambiguous,and(match_status.eq.new,match_method.eq.needs_type)')
    .order('date', { ascending: false });
  if (error) {
    console.error('getReviewRecords:', error);
    return [];
  }
  return (data || []).map((r) => ({
    contactKey: String(r.contact_key),
    name: String(r.full_name || ''),
    company: String(r.company || ''),
    email: (r.email as string | null) || null,
    mobile: (r.mobile as string | null) || null,
    date: (r.date as string | null) || null,
    comments: (r.comments as string | null) || null,
    reason: r.match_status === 'ambiguous' ? 'ambiguous' : 'needs_type',
    candidates: Array.isArray(r.match_candidates) ? (r.match_candidates as ReviewCandidate[]) : [],
  }));
}

async function linkActivity(
  contactKey: string,
  table: ContactTable,
  id: string
): Promise<string | null> {
  const { error } = await supabase
    .from('activities')
    .update({
      contact_table: table,
      contact_id: id,
      match_status: 'matched',
      match_method: 'manual',
      match_confidence: 1,
      match_candidates: null,
    })
    .eq('contact_key', contactKey);
  return error ? error.message : null;
}

// Human picked a candidate: link the activity row to it and apply the same
// fill-empty enrichment an automatic match would have applied.
export async function resolveReviewLink(
  rec: ReviewRecord,
  candidate: { table: ContactTable; id: string }
): Promise<string | null> {
  const { data: contact, error } = await supabase
    .from(candidate.table)
    .select('*')
    .eq('id', candidate.id)
    .single();
  if (error || !contact) return `Could not load ${candidate.table}/${candidate.id}: ${error?.message || 'not found'}`;

  const linkErr = await linkActivity(rec.contactKey, candidate.table, candidate.id);
  if (linkErr) return linkErr;

  const upd = computeEnrichment(candidate.table, contact, {
    email: rec.email || '',
    mobile: rec.mobile || '',
    company: rec.company || '',
    date: rec.date || '',
  });
  if (upd) {
    const { error: updErr } = await supabase.from(upd.table).update(upd.set).eq('id', upd.id);
    if (updErr) return `Linked, but enrichment failed: ${updErr.message}`;
  }
  return null;
}

// Human typed the new person: create the contact and link the activity row.
export async function resolveReviewCreate(
  rec: ReviewRecord,
  table: ContactTable
): Promise<string | null> {
  const row = buildNewContactRow(table, {
    fullName: rec.name,
    company: rec.company,
    email: rec.email || '',
    mobile: rec.mobile || '',
    date: rec.date || '',
    comments: rec.comments || '',
  });
  const { error } = await supabase.from(table).upsert(row);
  if (error) return `Create failed: ${error.message}`;
  return linkActivity(rec.contactKey, table, String(row.id));
}

// Human says this row isn't a contact at all.
export async function resolveReviewJunk(rec: ReviewRecord): Promise<string | null> {
  const { error } = await supabase
    .from('activities')
    .update({
      match_status: 'junk',
      match_method: 'manual',
      contact_table: null,
      contact_id: null,
      match_candidates: null,
    })
    .eq('contact_key', rec.contactKey);
  return error ? error.message : null;
}

// Counts for the tab badge / header.
export async function getReviewCount(): Promise<number> {
  const { count, error } = await supabase
    .from('activities')
    .select('contact_key', { count: 'exact', head: true })
    .or('match_status.eq.ambiguous,and(match_status.eq.new,match_method.eq.needs_type)');
  if (error) return 0;
  return count || 0;
}

// Loads the four contact tables in the raw row shape planImport expects.
export async function loadExistingContacts(): Promise<Record<ContactTable, Record<string, unknown>[]>> {
  const [brokers, partners, prospects, coldBrokers] = await Promise.all(
    (['brokers', 'partners', 'prospects', 'cold_brokers'] as const).map(async (table) => {
      const { data, error } = await supabase.from(table).select('*');
      if (error) throw new Error(`${table}: ${error.message}`);
      return data || [];
    })
  );
  return { brokers, partners, prospects, cold_brokers: coldBrokers };
}
