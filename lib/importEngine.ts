// Salesforce CSV import engine (Phase 2 of the data-layer fix).
//
// Pure logic: parse CSV text -> normalize rows -> resolve each person via
// lib/identity -> produce an ImportPlan describing exactly what will be
// written (activity upserts, contact enrichment updates, contact creates,
// review items). No I/O here — lib/importApply.ts executes the plan.
//
// Two known export formats, detected from headers:
//   A "contacts export":  Subject / Account Name / First Name / Last Name /
//                         Email / Mobile / Date / Comments / Contact Type
//   B "activity export":  Date / Company / Contact / Activity Type / Subject
//
// The import never guesses: ambiguous matches and new-but-untyped people go
// to the review list instead of silently creating or updating the wrong row.

import {
  buildContactIndex,
  canonicalKey,
  contactRefFromRow,
  nameKey,
  resolveContact,
  type ContactRef,
  type ContactTable,
} from './identity';
import { computeNextDue, computeStatus, defaultTierForBroker, defaultTierForPartner } from './cadence';
import { prioritizeLead, assignChannel } from './prioritize';
import type { Lead, RelationshipTier } from '@/types';

// ============ CSV PARSING ============

// Parse the WHOLE text as one state machine instead of splitting on newlines
// first. The old parser split lines before handling quotes, so any quoted
// multi-line field (email bodies pasted into Comments) shredded into fake
// rows — that is where the 2,868 junk "contacts" in activities came from.
export function parseCSVText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let sawAny = false;

  const pushField = () => {
    row.push(field.trim());
    field = '';
  };
  const pushRow = () => {
    pushField();
    // Skip fully-empty rows (trailing newlines, blank lines between records).
    if (row.some((f) => f !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      sawAny = true;
    } else if (ch === ',') {
      pushField();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      pushRow();
    } else {
      field += ch;
      sawAny = true;
    }
  }
  if (sawAny && (field !== '' || row.length > 0)) pushRow();
  return rows;
}

// ============ HEADER MAPPING ============

type ColumnKey =
  | 'company' | 'contact' | 'firstName' | 'lastName' | 'email' | 'mobile'
  | 'subject' | 'activityType' | 'date' | 'status' | 'priority' | 'comments'
  | 'contactType';

const COLUMN_MAP: Record<string, ColumnKey> = {
  'subject': 'subject',
  'first name': 'firstName',
  'firstname': 'firstName',
  'last name': 'lastName',
  'lastname': 'lastName',
  'email': 'email',
  'mobile': 'mobile',
  'phone': 'mobile',
  'phone number': 'mobile',
  'company': 'company',
  'account': 'company',
  'account name': 'company',
  'contact': 'contact',
  'contact name': 'contact',
  'full name': 'contact',
  'activity type': 'activityType',
  'activitytype': 'activityType',
  'date': 'date',
  'activity date': 'date',
  'status': 'status',
  'priority': 'priority',
  'comments': 'comments',
  'description': 'comments',
  'contact type': 'contactType',
  'focus_type__c': 'contactType',
  'focus type': 'contactType',
  'focus_type': 'contactType',
};

export type ImportFormat = 'contacts_export' | 'activity_export';

// One normalized inbound row, whichever format it came from.
export type ImportRow = {
  fullName: string;
  company: string;
  email: string;
  mobile: string;
  contactType: string;   // raw CSV value; '' when the format has no type column
  subject: string;
  activityType: string;
  date: string;          // ISO YYYY-MM-DD or ''
  status: string;
  priority: string;
  comments: string;
};

function cleanValue(v: string | undefined): string {
  const t = (v || '').trim();
  return t.toLowerCase() === 'nan' ? '' : t;
}

// Contact dates arrive as "6/23/2026" or "2026-06-23"; normalize to ISO so
// "is this newer" comparisons work as strings.
export function toIsoDate(value: string): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const mdy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  const parsed = new Date(trimmed);
  return isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

export function parseImportCSV(text: string): { format: ImportFormat; rows: ImportRow[] } {
  const table = parseCSVText(text || '');
  if (table.length < 2) throw new Error('No data rows found in the CSV.');

  const headers = table[0].map((h) => h.toLowerCase().trim());
  const indices: Partial<Record<ColumnKey, number>> = {};
  headers.forEach((h, i) => {
    const mapped = COLUMN_MAP[h];
    if (mapped !== undefined && indices[mapped] === undefined) indices[mapped] = i;
  });

  const hasSplitName = indices.firstName !== undefined || indices.lastName !== undefined;
  if (!hasSplitName && indices.contact === undefined) {
    throw new Error(
      `Unrecognized CSV format — no name column found. Headers: ${headers.join(', ')}`
    );
  }
  const format: ImportFormat = hasSplitName ? 'contacts_export' : 'activity_export';

  const rows: ImportRow[] = [];
  for (let i = 1; i < table.length; i++) {
    const fields = table[i];
    const get = (key: ColumnKey): string => {
      const idx = indices[key];
      return idx !== undefined && idx < fields.length ? cleanValue(fields[idx]) : '';
    };

    const fullName = (
      get('contact') || `${get('firstName')} ${get('lastName')}`.trim()
    ).replace(/\s+/g, ' ');
    const email = get('email').toLowerCase();
    if (!fullName && !email) continue;

    rows.push({
      fullName,
      company: get('company'),
      email: email.includes('@') ? email : '',
      mobile: get('mobile'),
      contactType: get('contactType'),
      subject: get('subject'),
      activityType: get('activityType'),
      date: toIsoDate(get('date')),
      status: get('status'),
      priority: get('priority'),
      comments: get('comments'),
    });
  }
  return { format, rows };
}

// ============ CONTACT TYPE ============

// Which table a CSV "Contact Type" value maps to; null = untyped (goes to
// review rather than guessing a table).
export function tableForContactType(raw: string): ContactTable | null {
  const v = (raw || '').toLowerCase();
  if (!v) return null;
  if (v.includes('referral')) return 'partners';
  if (v.includes('broker') || v.includes('property manager')) return 'brokers';
  if (v.includes('prospect') || v.includes('client') || v.includes('customer') || v.includes('landlord')) {
    return 'prospects';
  }
  return null;
}

// ============ PLAN TYPES ============

type Row = Record<string, unknown>;

export type ActivityUpsert = {
  contact_key: string;
  full_name: string;
  company: string;
  subject: string;
  activity_type: string;
  date: string;
  status: string;
  priority: string;
  comments: string;
  email: string | null;
  mobile: string | null;
  canonical_key: string | null;
  contact_table: string | null;
  contact_id: string | null;
  match_status: string;
  match_method: string | null;
  match_confidence: number | null;
  match_candidates: Row[] | null;
};

export type ContactUpdate = {
  table: ContactTable;
  id: string;
  name: string;
  set: Row;               // only the columns being changed
  filledFields: string[]; // for the summary ("email, mobile")
};

export type ContactCreate = {
  table: ContactTable;
  row: Row;
  name: string;
};

export type ReviewItem = {
  contactKey: string;
  name: string;
  company: string;
  email: string | null;
  mobile: string | null;
  reason: 'ambiguous' | 'needs_type';
  candidates: Array<{ table: string; id: string; name: string; company: string }>;
};

export type ImportPlan = {
  format: ImportFormat;
  activities: ActivityUpsert[];
  updates: ContactUpdate[];
  creates: ContactCreate[];
  review: ReviewItem[];
  counts: {
    rows: number;          // raw CSV data rows
    people: number;        // distinct contact_keys after grouping
    matched: number;
    created: number;
    updated: number;
    ambiguous: number;
    needsType: number;
    junk: number;
  };
};

// ============ GROUPING ============

// The activities table is one row per contact_key (slugified name) — the
// existing model. Collapse the file the same way: comments concatenate,
// newest date wins for subject/type/status/priority, first non-empty wins
// for company/email/mobile/contactType.
type PersonGroup = ImportRow & { contactKey: string };

function groupRows(rows: ImportRow[]): PersonGroup[] {
  const groups = new Map<string, PersonGroup>();
  for (const r of rows) {
    const key = nameKey(r.fullName);
    if (!key) continue;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { ...r, contactKey: key });
      continue;
    }
    const newer = !!r.date && (!g.date || r.date > g.date);
    g.comments = [g.comments, r.comments].filter(Boolean).join(' | ');
    if (newer) {
      g.date = r.date;
      g.subject = r.subject || g.subject;
      g.activityType = r.activityType || g.activityType;
      g.status = r.status || g.status;
      g.priority = r.priority || g.priority;
    }
    g.company = g.company || r.company;
    g.email = g.email || r.email;
    g.mobile = g.mobile || r.mobile;
    g.contactType = g.contactType || r.contactType;
  }
  return [...groups.values()];
}

// ============ ENRICHMENT ============

const isEmptyCompany = (v: unknown): boolean =>
  !v || (typeof v === 'string' && (v.trim() === '' || v.trim().toLowerCase() === 'unknown'));

const empty = (v: unknown): boolean => !v || (typeof v === 'string' && v.trim() === '');

// Column that stores the cell number, per table.
const MOBILE_COLUMN: Record<ContactTable, string> = {
  brokers: 'mobile',
  partners: 'phone',
  prospects: 'phone',
  cold_brokers: 'mobile',
};

const COMPANY_COLUMN: Record<ContactTable, string> = {
  brokers: 'firm',
  partners: 'company',
  prospects: 'company',
  cold_brokers: 'firm',
};

// Fill-empty enrichment: the CSV only ever ADDS data (missing email, missing
// mobile, "Unknown" company) and moves last_touch forward. It never
// overwrites a non-empty field with a different value — that kind of
// conflict is review-territory, not silent-write territory.
// Exported so the review UI can apply the same enrichment when a human links
// an activity row to a contact by hand.
export function computeEnrichment(
  table: ContactTable,
  existing: Row,
  g: Pick<ImportRow, 'email' | 'mobile' | 'company' | 'date'>
): ContactUpdate | null {
  const set: Row = {};
  const filled: string[] = [];

  if (g.email && empty(existing.email)) {
    set.email = g.email;
    filled.push('email');
  }
  const mobileCol = MOBILE_COLUMN[table];
  if (g.mobile && empty(existing[mobileCol])) {
    set[mobileCol] = g.mobile;
    filled.push(mobileCol);
  }
  const companyCol = COMPANY_COLUMN[table];
  if (g.company && isEmptyCompany(existing[companyCol])) {
    set[companyCol] = g.company;
    filled.push(companyCol);
    // Company changed -> canonical key changes with it.
    const ref = contactRefFromRow(table, existing);
    set.canonical_key = canonicalKey(ref.name, g.company) || null;
  }

  if (table !== 'cold_brokers' && g.date) {
    const prev = toIsoDate(String(existing.last_touch || ''));
    if (!prev || g.date > prev) {
      set.last_touch = g.date;
      filled.push('last_touch');
      const tier = existing.tier;
      // Prospect tiers are numeric; next_due recompute only applies to the
      // A/B/C cadence tables, and never to the D tier the engine excludes.
      if (tier === 'A' || tier === 'B' || tier === 'C') {
        set.next_due = computeNextDue(g.date, tier as RelationshipTier);
        if (table === 'brokers') {
          set.status = computeStatus(g.date, tier as RelationshipTier);
        }
      }
    }
  }

  if (filled.length === 0) return null;
  const ref = contactRefFromRow(table, existing);
  return { table, id: String(existing.id), name: ref.name, set, filledFields: filled };
}

// ============ NEW CONTACT ROWS ============

// Same id convention the tables already use: email slug when there's an
// email, name-company slug otherwise.
export function newContactId(g: { email: string; fullName: string; company: string }): string {
  if (g.email) return g.email.replace(/[^a-z0-9]/g, '_');
  return (
    `${g.fullName}-${g.company}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') ||
    `contact-${nameKey(g.fullName)}`
  );
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
}

export function buildNewContactRow(table: ContactTable, g: {
  fullName: string; company: string; email: string; mobile: string;
  subject?: string; activityType?: string; date?: string; comments?: string;
}): Row {
  const id = newContactId(g);
  const { first, last } = splitName(g.fullName);
  const ck = canonicalKey(g.fullName, g.company) || null;
  const date = g.date || '';

  if (table === 'brokers') {
    const tier = defaultTierForBroker(0);
    return {
      id, first_name: first, last_name: last, firm: g.company || 'Unknown',
      title: 'Broker', email: g.email || null, mobile: g.mobile || null,
      tier, deal_count: 0, deal_names: [],
      last_touch: date, next_due: computeNextDue(date, tier),
      notes: g.subject || '', status: computeStatus(date, tier),
      canonical_key: ck,
    };
  }
  if (table === 'partners') {
    const tier = defaultTierForPartner('other');
    return {
      id, first_name: first, last_name: last, company: g.company || 'Unknown',
      title: '', partner_type: 'other', tier, referral_count: 0,
      last_touch: date, next_due: computeNextDue(date, tier),
      notes: g.subject || '', email: g.email || null, phone: g.mobile || null,
      canonical_key: ck,
    };
  }
  if (table === 'cold_brokers') {
    return {
      id, name: g.fullName, title: 'Broker', firm: g.company || 'Unknown',
      email: g.email || '', phone: '', mobile: g.mobile || null,
      status: 'new', canonical_key: ck,
    };
  }
  // prospects — reuse the existing tiering/channel heuristics.
  const lead: Lead = {
    id, company: g.company || 'Unknown', contact: g.fullName,
    subject: g.subject || '', activityType: g.activityType || '', date,
    status: '', priority: '', comments: g.comments || '', tier: 3,
    channel: 'email', lastTouch: date,
    email: g.email || undefined, phone: g.mobile || undefined,
  };
  lead.tier = prioritizeLead(lead);
  lead.channel = assignChannel(lead);
  return {
    id, company: lead.company, contact: lead.contact, subject: lead.subject,
    activity_type: lead.activityType, date: lead.date, status: lead.status,
    priority: lead.priority, comments: lead.comments, tier: lead.tier,
    channel: lead.channel, last_touch: date,
    email: lead.email || null, phone: lead.phone || null,
    canonical_key: ck,
  };
}

// ============ THE PLAN ============

export type ExistingContacts = Record<ContactTable, Row[]>;

export function planImport(
  format: ImportFormat,
  rows: ImportRow[],
  existing: ExistingContacts
): ImportPlan {
  const refs: ContactRef[] = [];
  const rowByRef = new Map<string, Row>();
  for (const table of Object.keys(existing) as ContactTable[]) {
    for (const row of existing[table]) {
      const ref = contactRefFromRow(table, row);
      if (!ref.id) continue;
      refs.push(ref);
      rowByRef.set(`${table}:${ref.id}`, row);
    }
  }
  const index = buildContactIndex(refs);

  const plan: ImportPlan = {
    format,
    activities: [],
    updates: [],
    creates: [],
    review: [],
    counts: {
      rows: rows.length, people: 0, matched: 0, created: 0,
      updated: 0, ambiguous: 0, needsType: 0, junk: 0,
    },
  };

  // Merge enrichment across groups that resolve to the same contact
  // ("Joe DeVries" and "Joseph DeVries" rows both feeding one broker).
  const updateByContact = new Map<string, ContactUpdate>();
  // Dedupe creates by id (same new person appearing under two name spellings
  // still collides on email-derived id).
  const createById = new Map<string, ContactCreate>();

  const groups = groupRows(rows);
  plan.counts.people = groups.length;

  for (const g of groups) {
    const base: ActivityUpsert = {
      contact_key: g.contactKey,
      full_name: g.fullName,
      company: g.company,
      subject: g.subject,
      activity_type: g.activityType,
      date: g.date,
      status: g.status,
      priority: g.priority,
      comments: g.comments,
      email: g.email || null,
      mobile: g.mobile || null,
      canonical_key: canonicalKey(g.fullName, g.company) || null,
      contact_table: null,
      contact_id: null,
      match_status: 'new',
      match_method: null,
      match_confidence: null,
      match_candidates: null,
    };

    const result = resolveContact(index, {
      name: g.fullName, company: g.company, email: g.email,
    });

    if (result.status === 'junk') {
      base.match_status = 'junk';
      plan.counts.junk++;
      plan.activities.push(base);
      continue;
    }

    if (result.status === 'matched' && result.match) {
      const m = result.match;
      base.match_status = 'matched';
      base.match_method = result.method || null;
      base.match_confidence = result.confidence ?? null;
      base.contact_table = m.table;
      base.contact_id = m.id;
      plan.counts.matched++;

      const existingRow = rowByRef.get(`${m.table}:${m.id}`);
      if (existingRow) {
        const upd = computeEnrichment(m.table, existingRow, g);
        if (upd) {
          const key = `${m.table}:${m.id}`;
          const prev = updateByContact.get(key);
          if (!prev) {
            updateByContact.set(key, upd);
          } else {
            // Fill-empty semantics across groups too: first writer wins,
            // except last_touch/next_due/status where the newest date wins.
            for (const [col, val] of Object.entries(upd.set)) {
              const isDateCol = col === 'last_touch' || col === 'next_due' || col === 'status';
              if (isDateCol) {
                if (col === 'last_touch' && String(val) > String(prev.set.last_touch || '')) {
                  prev.set.last_touch = val;
                }
                if (col === 'next_due' && upd.set.last_touch &&
                    String(upd.set.last_touch) > String(prev.set.last_touch || '')) {
                  prev.set.next_due = val;
                }
                if (col === 'status' && upd.set.last_touch &&
                    String(upd.set.last_touch) > String(prev.set.last_touch || '')) {
                  prev.set.status = val;
                }
              } else if (!(col in prev.set)) {
                prev.set[col] = val;
                prev.filledFields.push(...upd.filledFields.filter((f) => !prev.filledFields.includes(f)));
              }
            }
          }
        }
      }
      plan.activities.push(base);
      continue;
    }

    if (result.status === 'ambiguous') {
      const candidates = (result.candidates || []).map((c) => ({
        table: c.table, id: c.id, name: c.name, company: c.company,
      }));
      base.match_status = 'ambiguous';
      base.match_method = result.method || null;
      base.match_candidates = candidates;
      plan.counts.ambiguous++;
      plan.activities.push(base);
      plan.review.push({
        contactKey: g.contactKey, name: g.fullName, company: g.company,
        email: g.email || null, mobile: g.mobile || null,
        reason: 'ambiguous', candidates,
      });
      continue;
    }

    // status === 'new'
    const table = tableForContactType(g.contactType);
    if (table) {
      const row = buildNewContactRow(table, g);
      const id = String(row.id);
      if (!createById.has(id)) {
        createById.set(id, { table, row, name: g.fullName });
        plan.counts.created++;
      }
      base.match_status = 'matched';
      base.match_method = 'created';
      base.match_confidence = 1;
      base.contact_table = table;
      base.contact_id = id;
      plan.activities.push(base);
    } else {
      base.match_status = 'new';
      base.match_method = 'needs_type';
      plan.counts.needsType++;
      plan.activities.push(base);
      plan.review.push({
        contactKey: g.contactKey, name: g.fullName, company: g.company,
        email: g.email || null, mobile: g.mobile || null,
        reason: 'needs_type', candidates: [],
      });
    }
  }

  plan.updates = [...updateByContact.values()];
  plan.creates = [...createById.values()];
  plan.counts.updated = plan.updates.length;
  return plan;
}

// Human-readable summary for the pre-apply confirmation.
export function summarizePlan(plan: ImportPlan): string {
  const c = plan.counts;
  const lines = [
    `${c.rows} rows -> ${c.people} people (${plan.format === 'contacts_export' ? 'contact export' : 'activity export'})`,
    `• ${c.matched} matched to existing contacts (${c.updated} will be enriched)`,
    `• ${c.created} new contacts will be created`,
    `• ${c.ambiguous} ambiguous -> review list (no changes made)`,
    `• ${c.needsType} new but untyped -> review list (no contact created)`,
  ];
  if (c.junk) lines.push(`• ${c.junk} non-contact rows (logged as junk)`);
  return lines.join('\n');
}
