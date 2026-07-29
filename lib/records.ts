// Data layer for the single-screen records view: partial field updates,
// bucket moves, cross-table moves, and the activities/touch_log CSV export.
//
// All writes here are targeted UPDATEs (or a single INSERT+DELETE for a
// cross-table move) — never a bulk upsert — so nothing outside the edited
// record can be touched.

import { supabase } from './supabase';
import { Bucket, RelationshipTier } from '@/types';
import { computeNextDue, computeStatus } from './cadence';

export type RecordSource = 'broker' | 'partner' | 'prospect' | 'cold_broker';

export const TABLE_FOR_SOURCE: Record<RecordSource, string> = {
  broker: 'brokers',
  partner: 'partners',
  prospect: 'prospects',
  cold_broker: 'cold_brokers',
};

export const BUCKET_OPTIONS: Array<{ value: Bucket; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'cold', label: 'Cold' },
  { value: 'not_worth_pursuing', label: 'Not Worth Pursuing' },
  { value: 'blast_only', label: 'Blast Only' },
];

// ============ PARTIAL UPDATES ============

// Update a single record with already-snake_cased column values. Returns an
// error message or null on success.
export async function updateRecordColumns(
  source: RecordSource,
  id: string,
  columns: Record<string, unknown>
): Promise<string | null> {
  if (Object.keys(columns).length === 0) return null;
  const { error } = await supabase
    .from(TABLE_FOR_SOURCE[source])
    .update(columns)
    .eq('id', id);
  if (error) {
    console.error('updateRecordColumns:', source, id, error);
    return error.message;
  }
  return null;
}

// One update moves a record between buckets — that's the whole point of the
// bucket field. cold_brokers has no bucket column (the table itself is the
// cold list).
export async function setBucket(
  source: Exclude<RecordSource, 'cold_broker'>,
  id: string,
  bucket: Bucket
): Promise<string | null> {
  return updateRecordColumns(source, id, { bucket });
}

// ============ CROSS-TABLE MOVES ============

// Intermediate shape a row from any of the four tables normalizes into,
// so any source table can map onto any target table.
type NormalizedRecord = {
  firstName: string;
  lastName: string;
  company: string;
  title: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  linkedin: string | null;
  tier: RelationshipTier;
  notes: string;
  lastTouch: string;
  bucket: Bucket;
  persona: string | null;
};

type RawRow = Record<string, unknown>;
const s = (v: unknown): string => (typeof v === 'string' ? v : '');
const sOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
}

function relTier(v: unknown): RelationshipTier {
  if (v === 'A' || v === 'B' || v === 'C') return v;
  // Prospect tiers are numeric 1/2/3 — map onto A/B/C.
  if (v === 1) return 'A';
  if (v === 2) return 'B';
  return 'C';
}

function prospectTier(t: RelationshipTier): 1 | 2 | 3 {
  return t === 'A' ? 1 : t === 'B' ? 2 : 3;
}

function normalize(row: RawRow, source: RecordSource): NormalizedRecord {
  const bucket = (row.bucket as Bucket) || 'active';
  const persona = sOrNull(row.persona);
  const base = {
    email: sOrNull(row.email),
    phone: sOrNull(row.phone),
    mobile: sOrNull(row.mobile),
    linkedin: sOrNull(row.linkedin),
    title: s(row.title),
    notes: '',
    lastTouch: s(row.last_touch),
    bucket,
    persona,
  };
  if (source === 'broker') {
    return {
      ...base,
      firstName: s(row.first_name), lastName: s(row.last_name),
      company: s(row.firm), tier: relTier(row.tier), notes: s(row.notes),
    };
  }
  if (source === 'partner') {
    return {
      ...base,
      firstName: s(row.first_name), lastName: s(row.last_name),
      company: s(row.company), tier: relTier(row.tier), notes: s(row.notes),
    };
  }
  if (source === 'prospect') {
    const { first, last } = splitName(s(row.contact));
    return {
      ...base,
      firstName: first, lastName: last,
      company: s(row.company), tier: relTier(row.tier), notes: s(row.comments),
      lastTouch: s(row.last_touch) || s(row.date),
    };
  }
  // cold_broker — no bucket/persona columns; a promoted cold broker starts active.
  const { first, last } = splitName(s(row.name));
  return {
    ...base,
    firstName: first, lastName: last,
    company: s(row.firm), tier: 'B', bucket: 'active', persona: null,
  };
}

function toTargetRow(n: NormalizedRecord, id: string, target: RecordSource): RawRow {
  if (target === 'broker') {
    return {
      id, first_name: n.firstName, last_name: n.lastName,
      firm: n.company || 'Unknown', title: n.title || 'Broker',
      email: n.email, phone: n.phone, mobile: n.mobile, linkedin: n.linkedin,
      tier: n.tier, deal_count: 0, deal_names: [],
      last_touch: n.lastTouch, next_due: computeNextDue(n.lastTouch, n.tier),
      notes: n.notes, status: computeStatus(n.lastTouch, n.tier),
      bucket: n.bucket, persona: n.persona,
    };
  }
  if (target === 'partner') {
    return {
      id, first_name: n.firstName, last_name: n.lastName,
      company: n.company || 'Unknown', title: n.title, partner_type: 'other',
      tier: n.tier, referral_count: 0,
      last_touch: n.lastTouch, next_due: computeNextDue(n.lastTouch, n.tier),
      notes: n.notes, email: n.email, phone: n.phone,
      bucket: n.bucket, persona: n.persona,
    };
  }
  // prospect
  return {
    id, company: n.company || 'Unknown',
    contact: `${n.firstName} ${n.lastName}`.trim(),
    subject: '', activity_type: '', date: n.lastTouch, status: '',
    priority: '', comments: n.notes, tier: prospectTier(n.tier),
    channel: 'email', last_touch: n.lastTouch,
    email: n.email, phone: n.phone,
    bucket: n.bucket, is_enterprise: false,
  };
}

// Move a record to a different table in ONE action, keeping the same id so
// history keyed by that id (touch_log, done/snoozed/pinned entries, drafts)
// stays attached. Copies into the target table first and only then removes
// the source row, so a failure can never lose the record.
// Returns an error message or null on success.
export async function moveRecord(
  id: string,
  from: RecordSource,
  to: Exclude<RecordSource, 'cold_broker'>
): Promise<string | null> {
  if (from === (to as RecordSource)) return null;

  const { data: row, error: readErr } = await supabase
    .from(TABLE_FOR_SOURCE[from])
    .select('*')
    .eq('id', id)
    .single();
  if (readErr || !row) return `Could not load record: ${readErr?.message || 'not found'}`;

  // Refuse rather than overwrite if the target table already has this id.
  const { data: clash, error: clashErr } = await supabase
    .from(TABLE_FOR_SOURCE[to])
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (clashErr) return `Could not check target table: ${clashErr.message}`;
  if (clash) return `A record with this id already exists in ${TABLE_FOR_SOURCE[to]}`;

  const targetRow = toTargetRow(normalize(row, from), id, to);
  const { error: insErr } = await supabase.from(TABLE_FOR_SOURCE[to]).insert(targetRow);
  if (insErr) return `Move failed (nothing changed): ${insErr.message}`;

  if (from === 'cold_broker') {
    // Keep the cold_brokers row as a breadcrumb instead of deleting it —
    // matches the existing "promoted" flow, and the Cold Brokers tab hides
    // active_broker rows by default.
    const { error } = await supabase
      .from('cold_brokers')
      .update({ status: 'active_broker' })
      .eq('id', id);
    if (error) return `Moved, but couldn't mark the cold broker promoted: ${error.message}`;
    return null;
  }

  const { error: delErr } = await supabase.from(TABLE_FOR_SOURCE[from]).delete().eq('id', id);
  if (delErr) {
    // The copy exists in both tables now — surface it instead of guessing.
    return `Copied to ${TABLE_FOR_SOURCE[to]}, but couldn't remove the original from ${TABLE_FOR_SOURCE[from]}: ${delErr.message}`;
  }
  return null;
}

// ============ CSV EXPORT (activities + touch_log) ============

// Contact dates are stored as text in mixed formats ("2026-06-16" and
// "6/23/2026"). Normalize to ISO before range-comparing; unparseable rows are
// included so bad data surfaces in the reconciliation export instead of
// silently vanishing.
function toIso(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const mdy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  const parsed = new Date(trimmed);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function inRange(dateText: string | null | undefined, start: string, end: string): boolean {
  const iso = toIso(dateText);
  if (!iso) return true; // keep unparseable dates visible
  return iso >= start && iso <= end;
}

function csvEscape(v: unknown): string {
  const str = v == null ? '' : String(v);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function downloadCSV(filename: string, header: string[], rows: unknown[][]): void {
  const csv = [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Downloads two CSVs (activities + touch log) filtered to the date range,
// for manual reconciliation against Salesforce. Dates are inclusive ISO
// YYYY-MM-DD. Returns row counts, or an error message.
export async function exportActivitiesAndTouchLog(
  start: string,
  end: string
): Promise<{ activities: number; touches: number } | { error: string }> {
  const [actRes, touchRes] = await Promise.all([
    supabase.from('activities').select('*'),
    supabase.from('touch_log').select('*'),
  ]);
  if (actRes.error) return { error: `activities: ${actRes.error.message}` };
  if (touchRes.error) return { error: `touch_log: ${touchRes.error.message}` };

  const activities = (actRes.data || []).filter((r) => inRange(r.date, start, end));
  const touches = (touchRes.data || []).filter((r) => inRange(r.date, start, end));

  const range = `${start}_to_${end}`;
  downloadCSV(
    `activities-${range}.csv`,
    ['contact_key', 'full_name', 'company', 'subject', 'activity_type', 'date', 'status', 'priority', 'comments', 'created_at'],
    activities.map((r) => [
      r.contact_key, r.full_name, r.company, r.subject, r.activity_type,
      r.date, r.status, r.priority, r.comments, r.created_at,
    ])
  );
  downloadCSV(
    `touch-log-${range}.csv`,
    ['contact_id', 'date', 'channel', 'spoke', 'notes', 'created_at'],
    touches.map((r) => [r.contact_id, r.date, r.channel, r.spoke, r.notes, r.created_at])
  );

  return { activities: activities.length, touches: touches.length };
}
