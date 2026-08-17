import { supabase } from './supabase';
import {
  Lead, Broker, Partner, ColdBroker, UncategorizedContact,
  DoneEntry, SnoozedEntry, NoteEntry, TouchLogEntry,
  UserTag, Channel, RelationshipTier, ContactType,
} from '@/types';
import { computeNextDue, computeStatus } from './cadence';
export type { ActivityRecord } from './parseCSV';
import type { ActivityRecord } from './parseCSV';
import { normalizeContactKey } from './parseCSV';
import { canonicalKey } from './identity';

// Records the last data-load failure so the UI can surface a real error instead
// of silently rendering an empty dashboard when a Supabase read fails.
let lastLoadError: string | null = null;
export function getLastLoadError(): string | null {
  return lastLoadError;
}
export function clearLoadError(): void {
  lastLoadError = null;
}
function noteLoadError(where: string, error: unknown): void {
  const msg = (error as { message?: string })?.message || String(error);
  lastLoadError = `${where}: ${msg}`;
  console.error(where, error);
}

// ============ PROSPECTS ============
export async function getProspects(): Promise<Lead[]> {
  const { data, error } = await supabase.from('prospects').select('*');
  if (error) { noteLoadError('getProspects', error); return []; }
  return (data || []).map(r => ({
    id: r.id, company: r.company, contact: r.contact,
    subject: r.subject, activityType: r.activity_type, date: r.date,
    status: r.status, priority: r.priority, comments: r.comments,
    tier: r.tier, broker: r.broker, channel: r.channel,
    lastTouch: r.last_touch, nextDue: r.next_due, email: r.email, phone: r.phone,
    dismissed: r.dismissed ?? false,
    bucket: r.bucket ?? 'active', isEnterprise: r.is_enterprise ?? false,
  }));
}

export async function setProspects(leads: Lead[]): Promise<void> {
  if (leads.length === 0) return;
  const rows = leads.map(l => ({
    id: l.id, company: l.company, contact: l.contact,
    subject: l.subject, activity_type: l.activityType, date: l.date,
    status: l.status, priority: l.priority, comments: l.comments,
    tier: l.tier, broker: l.broker || null, channel: l.channel,
    last_touch: l.lastTouch || null, email: l.email || null, phone: l.phone || null,
    canonical_key: canonicalKey(l.contact, l.company) || null,
  }));
  // Upsert in batches of 100
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await supabase.from('prospects').upsert(rows.slice(i, i + 100));
    if (error) console.error('setProspects batch error:', error);
  }
}

// ============ BROKERS ============
export async function getBrokers(): Promise<Broker[]> {
  const { data, error } = await supabase.from('brokers').select('*');
  if (error) { noteLoadError('getBrokers', error); return []; }
  return (data || []).map(r => ({
    id: r.id, firstName: r.first_name, lastName: r.last_name,
    firm: r.firm, title: r.title, email: r.email, phone: r.phone,
    mobile: r.mobile, linkedin: r.linkedin, tier: r.tier,
    dealCount: r.deal_count, dealNames: r.deal_names || [],
    lastTouch: r.last_touch, nextDue: r.next_due, notes: r.notes,
    status: r.status, dismissed: r.dismissed ?? false,
    bucket: r.bucket ?? 'active', persona: r.persona ?? null,
  }));
}

export async function setBrokers(brokers: Broker[]): Promise<void> {
  if (brokers.length === 0) return;
  const rows = brokers.map(b => ({
    id: b.id, first_name: b.firstName, last_name: b.lastName,
    firm: b.firm, title: b.title, email: b.email || null,
    phone: b.phone || null, mobile: b.mobile || null,
    linkedin: b.linkedin || null, tier: b.tier,
    deal_count: b.dealCount, deal_names: b.dealNames,
    last_touch: b.lastTouch, next_due: b.nextDue,
    notes: b.notes, status: b.status,
    canonical_key: canonicalKey(`${b.firstName} ${b.lastName}`, b.firm) || null,
  }));
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await supabase.from('brokers').upsert(rows.slice(i, i + 100));
    if (error) console.error('setBrokers batch error:', error);
  }
}

export async function updateBroker(id: string, updates: Partial<Broker>): Promise<void> {
  const brokers = await getBrokers();
  const b = brokers.find(x => x.id === id);
  if (!b) return;
  const merged = { ...b, ...updates };
  merged.nextDue = computeNextDue(merged.lastTouch, merged.tier);
  merged.status = computeStatus(merged.lastTouch, merged.tier);
  const { error } = await supabase.from('brokers').upsert({
    id: merged.id, first_name: merged.firstName, last_name: merged.lastName,
    firm: merged.firm, title: merged.title, email: merged.email || null,
    phone: merged.phone || null, mobile: merged.mobile || null,
    tier: merged.tier, deal_count: merged.dealCount, deal_names: merged.dealNames,
    last_touch: merged.lastTouch, next_due: merged.nextDue,
    notes: merged.notes, status: merged.status,
    canonical_key: canonicalKey(`${merged.firstName} ${merged.lastName}`, merged.firm) || null,
  });
  if (error) console.error(error);
}

export async function logBrokerTouch(id: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  await updateBroker(id, { lastTouch: today });
  await logTouch(id, today, 'text');
}

// ============ PARTNERS ============
export async function getPartners(): Promise<Partner[]> {
  const { data, error } = await supabase.from('partners').select('*');
  if (error) { noteLoadError('getPartners', error); return []; }
  return (data || []).map(r => ({
    id: r.id, firstName: r.first_name, lastName: r.last_name,
    company: r.company, title: r.title, partnerType: r.partner_type,
    tier: r.tier, referralCount: r.referral_count,
    lastTouch: r.last_touch, nextDue: r.next_due, notes: r.notes,
    email: r.email, phone: r.phone, dismissed: r.dismissed ?? false,
    bucket: r.bucket ?? 'active', persona: r.persona ?? null,
  }));
}

export async function setPartners(partners: Partner[]): Promise<void> {
  if (partners.length === 0) return;
  const rows = partners.map(p => ({
    id: p.id, first_name: p.firstName, last_name: p.lastName,
    company: p.company, title: p.title, partner_type: p.partnerType,
    tier: p.tier, referral_count: p.referralCount,
    last_touch: p.lastTouch, next_due: p.nextDue, notes: p.notes,
    email: p.email || null, phone: p.phone || null,
    canonical_key: canonicalKey(`${p.firstName} ${p.lastName}`, p.company) || null,
  }));
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await supabase.from('partners').upsert(rows.slice(i, i + 100));
    if (error) console.error('setPartners batch error:', error);
  }
}

export async function updatePartner(id: string, updates: Partial<Partner>): Promise<void> {
  const partners = await getPartners();
  const p = partners.find(x => x.id === id);
  if (!p) return;
  const merged = { ...p, ...updates };
  merged.nextDue = computeNextDue(merged.lastTouch, merged.tier);
  await supabase.from('partners').upsert({
    id: merged.id, first_name: merged.firstName, last_name: merged.lastName,
    company: merged.company, title: merged.title, partner_type: merged.partnerType,
    tier: merged.tier, referral_count: merged.referralCount,
    last_touch: merged.lastTouch, next_due: merged.nextDue, notes: merged.notes,
    email: merged.email || null, phone: merged.phone || null,
    canonical_key: canonicalKey(`${merged.firstName} ${merged.lastName}`, merged.company) || null,
  });
}

export async function logPartnerTouch(id: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  await updatePartner(id, { lastTouch: today });
  await logTouch(id, today, 'text');
}

// ============ COLD BROKERS ============
export async function getColdBrokers(): Promise<ColdBroker[]> {
  const { data, error } = await supabase.from('cold_brokers').select('*');
  if (error) { noteLoadError('getColdBrokers', error); return []; }
  return data || [];
}

export async function setColdBrokers(brokers: ColdBroker[]): Promise<void> {
  if (brokers.length === 0) return;
  const rows = brokers.map(b => ({
    ...b,
    canonical_key: canonicalKey(b.name, b.firm) || null,
  }));
  const { error } = await supabase.from('cold_brokers').upsert(rows);
  if (error) console.error(error);
}

export async function updateColdBroker(id: string, updates: Partial<ColdBroker>): Promise<void> {
  const { error } = await supabase.from('cold_brokers').update(updates).eq('id', id);
  if (error) console.error(error);
}

// ============ UNCATEGORIZED ============
export async function getUncategorized(): Promise<UncategorizedContact[]> {
  return [];
}
export async function setUncategorized(_contacts: UncategorizedContact[]): Promise<void> {}

// ============ DONE ============
export async function getDone(): Promise<DoneEntry[]> {
  const { data, error } = await supabase.from('done_entries').select('*');
  if (error) { console.error(error); return []; }
  return data || [];
}

export async function markDone(id: string, date: string): Promise<void> {
  const { error } = await supabase.from('done_entries').upsert({ id, date });
  if (error) console.error(error);
}

// ============ SNOOZED ============
export async function getSnoozed(): Promise<SnoozedEntry[]> {
  const { data, error } = await supabase.from('snoozed_entries').select('*');
  if (error) { console.error(error); return []; }
  return data || [];
}

export async function snoozeLead(id: string, days: number): Promise<void> {
  const until = new Date();
  until.setDate(until.getDate() + days);
  const { error } = await supabase.from('snoozed_entries')
    .upsert({ id, until: until.toISOString().split('T')[0] });
  if (error) console.error(error);
}

// ============ TOUCH LOG ============
export async function getTouchLog(): Promise<TouchLogEntry[]> {
  const { data, error } = await supabase.from('touch_log').select('*');
  if (error) { console.error(error); return []; }
  return (data || []).map(r => ({ id: r.contact_id, date: r.date, channel: r.channel }));
}

export async function logTouch(id: string, date: string, channel: Channel): Promise<void> {
  const { error } = await supabase.from('touch_log').insert({ contact_id: id, date, channel });
  if (error) console.error(error);
}

// ============ PINNED (manually added to Today's queue) ============
export type PinnedEntry = { id: string; date: string; source: string };

// Contacts the user pinned to today's Do This Now queue. One row per contact
// (PK is id); re-pinning moves it to today, unpinning deletes it.
export async function getPinnedToday(): Promise<PinnedEntry[]> {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('pinned_entries')
    .select('id, date, source')
    .eq('date', today);
  if (error) { console.error('getPinnedToday:', error); return []; }
  return data || [];
}

export async function pinToToday(id: string, source: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const { error } = await supabase
    .from('pinned_entries')
    .upsert({ id, date: today, source });
  if (error) console.error('pinToToday:', error);
}

export async function unpinToday(id: string): Promise<void> {
  const { error } = await supabase.from('pinned_entries').delete().eq('id', id);
  if (error) console.error('unpinToday:', error);
}

// ============ DISMISSED (manually marked not a fit) ============
export type ContactSource = 'broker' | 'partner' | 'prospect' | 'cold_broker';
const tableForSource: Record<ContactSource, string> = {
  broker: 'brokers',
  partner: 'partners',
  prospect: 'prospects',
  cold_broker: 'cold_brokers',
};

// Mark a contact "not a fit" — drops them from the cadence engine, Do This Now,
// and the default Contacts view. Reversible via restoreContact.
export async function dismissContact(id: string, source: ContactSource, reason?: string): Promise<void> {
  const table = tableForSource[source];
  if (!table) return;
  const { error } = await supabase
    .from(table)
    .update({ dismissed: true, dismissed_reason: reason || null })
    .eq('id', id);
  if (error) console.error('dismissContact:', error);
}

export async function restoreContact(id: string, source: ContactSource): Promise<void> {
  const table = tableForSource[source];
  if (!table) return;
  const { error } = await supabase
    .from(table)
    .update({ dismissed: false, dismissed_reason: null })
    .eq('id', id);
  if (error) console.error('restoreContact:', error);
}

// Schedule the next follow-up (sets next_due, YYYY-MM-DD). Due prospect
// follow-ups surface at the top of Do This Now.
export async function setFollowUp(id: string, source: ContactSource, dateISO: string): Promise<void> {
  const table = tableForSource[source];
  if (!table) return;
  const { error } = await supabase.from(table).update({ next_due: dateISO }).eq('id', id);
  if (error) console.error('setFollowUp:', error);
}

// Clear a scheduled follow-up (removes it from the "due" list in Do This Now).
export async function clearFollowUp(id: string, source: ContactSource): Promise<void> {
  const table = tableForSource[source];
  if (!table) return;
  const { error } = await supabase.from(table).update({ next_due: null }).eq('id', id);
  if (error) console.error('clearFollowUp:', error);
}

// ============ ENGINE DRAFTS (review queue) ============
export type EngineDraft = {
  id: string;
  contactId: string | null;
  contactTable: string | null;
  contactName: string | null;
  contactCompany: string | null;
  channel: string;
  subject: string | null;
  body: string;
  draftType: string | null;
  signalId: string | null;
  signalSummary: string | null;
  // Audit outcome: true = clean/auto-corrected, false = an issue survived,
  // null = not audited yet.
  auditPassed: boolean | null;
  auditFindings: string | null;
};

// Pending drafts the engine generated, for the review queue. edited_body wins
// if George already tweaked it.
export async function getPendingEngineDrafts(limit = 60): Promise<EngineDraft[]> {
  const { data, error } = await supabase
    .from('drafts')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.error('getPendingEngineDrafts:', error); return []; }
  return (data || []).map((r) => ({
    id: r.id,
    contactId: r.contact_id,
    contactTable: r.contact_table,
    contactName: r.contact_name,
    contactCompany: r.contact_company,
    channel: r.channel,
    subject: r.subject,
    body: r.edited_body || r.body,
    draftType: r.draft_type,
    signalId: r.signal_id,
    signalSummary: r.signal_summary,
    auditPassed: r.audit_passed ?? null,
    auditFindings: r.audit_findings ?? null,
  }));
}

// Source attribution for signals (the article the signal came from), keyed by
// signal id. The columns have existed since the prospectors started writing
// them; this just surfaces them in the UI.
export type SignalSource = { url: string; name: string };

export async function getSignalSources(signalIds: string[]): Promise<Map<string, SignalSource>> {
  const ids = signalIds.filter(Boolean);
  const out = new Map<string, SignalSource>();
  if (!ids.length) return out;
  const { data, error } = await supabase
    .from('signals')
    .select('id, source_url, source_name')
    .in('id', ids);
  if (error) { console.error('getSignalSources:', error); return out; }
  for (const r of data || []) {
    if (!r.source_url) continue;
    out.set(r.id, { url: r.source_url, name: r.source_name || 'Source' });
  }
  return out;
}

export async function setEngineDraftStatus(
  id: string,
  status: 'approved' | 'edited' | 'killed' | 'sent'
): Promise<void> {
  const update: Record<string, unknown> = { status };
  if (status === 'sent') update.sent_at = new Date().toISOString();
  const { error } = await supabase.from('drafts').update(update).eq('id', id);
  if (error) console.error('setEngineDraftStatus:', error);
}

// ============ VOICE SAMPLES ============
export type VoiceSample = { id: string; channel: string | null; text: string };

// Real messages George has written, used as few-shot examples so generated
// drafts match his voice. Newest first.
export async function getVoiceSamples(limit = 8): Promise<VoiceSample[]> {
  const { data, error } = await supabase
    .from('voice_samples')
    .select('id, channel, text')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.error('getVoiceSamples:', error); return []; }
  return data || [];
}

export async function saveVoiceSample(
  channel: string,
  text: string,
  opts?: { mode?: string; source?: string; contactName?: string }
): Promise<void> {
  const t = (text || '').trim();
  if (!t) return;
  const { error } = await supabase.from('voice_samples').insert({
    channel: channel || null,
    text: t,
    mode: opts?.mode || null,
    source: opts?.source || null,
    contact_name: opts?.contactName || null,
  });
  if (error) console.error('saveVoiceSample:', error);
}

// ============ NOTES ============
export async function getNotes(): Promise<NoteEntry[]> {
  const { data, error } = await supabase.from('notes').select('*');
  if (error) { console.error(error); return []; }
  return data || [];
}

export async function setNote(id: string, text: string): Promise<void> {
  const { error } = await supabase.from('notes').upsert({ id, text });
  if (error) console.error(error);
}

export async function getNote(id: string): Promise<string> {
  const { data, error } = await supabase.from('notes').select('text').eq('id', id).single();
  if (error) return '';
  return data?.text || '';
}

// ============ USER TAGS ============
export function getUserTags(): UserTag[] { return []; }
export function setUserTag(_id: string, _type: ContactType, _tier?: RelationshipTier): void {}

// ============ LAST IMPORT ============
export function getLastImport(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('fs_last_import');
}
export function setLastImport(date: string): void {
  if (typeof window !== 'undefined') localStorage.setItem('fs_last_import', date);
}
export function getLastActivityImport(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('fs_last_activity_import');
}
export function setLastActivityImport(date: string): void {
  if (typeof window !== 'undefined') localStorage.setItem('fs_last_activity_import', date);
}

// ============ ACTIVITIES ============
export async function getActivities(): Promise<Record<string, ActivityRecord>> {
  const { data, error } = await supabase.from('activities').select('*');
  if (error) { console.error(error); return {}; }
  const result: Record<string, ActivityRecord> = {};
  for (const r of data || []) {
    result[r.contact_key] = {
      contactKey: r.contact_key, fullName: r.full_name,
      company: r.company, subject: r.subject,
      activityType: r.activity_type, date: r.date,
      status: r.status, priority: r.priority, comments: r.comments,
    };
  }
  return result;
}

export async function setActivities(activities: Record<string, ActivityRecord>): Promise<void> {
  const rows = Object.entries(activities).map(([key, r]) => ({
    contact_key: key, full_name: r.fullName, company: r.company,
    subject: r.subject, activity_type: r.activityType, date: r.date,
    status: r.status, priority: r.priority, comments: r.comments,
  }));
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await supabase.from('activities').upsert(rows.slice(i, i + 100));
    if (error) console.error('setActivities batch error:', error);
  }
}

export async function mergeActivities(
  incoming: Record<string, ActivityRecord>
): Promise<Record<string, ActivityRecord>> {
  const existing = await getActivities();
  const merged = { ...existing };
  for (const key of Object.keys(incoming)) {
    const prev = merged[key];
    const next = incoming[key];
    if (!prev) {
      merged[key] = next;
    } else {
      const mergedComments = [prev.comments, next.comments].filter(Boolean).join(' | ');
      const newer = next.date && (!prev.date || next.date > prev.date);
      merged[key] = {
        ...prev, comments: mergedComments,
        subject: newer ? next.subject || prev.subject : prev.subject,
        activityType: newer ? next.activityType || prev.activityType : prev.activityType,
        date: newer ? next.date : prev.date,
        status: newer ? next.status || prev.status : prev.status,
        priority: newer ? next.priority || prev.priority : prev.priority,
      };
    }
  }
  await setActivities(merged);
  return merged;
}

// Logs a single outreach activity for a broker/partner and resets their
// cadence (lastTouch -> today, which recomputes nextDue + status, and appends
// to touch_log). Upserts one row in `activities` keyed by the contact's
// normalized name, merging comments with any existing row for that contact.
export async function logActivity(params: {
  contactId: string;
  contactType: 'broker' | 'partner';
  fullName: string;
  company: string;
  subject: string;
  comments: string;
  activityType?: string;
}): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const key = normalizeContactKey(params.fullName);

  if (key) {
    const { data: existing } = await supabase
      .from('activities')
      .select('comments, priority')
      .eq('contact_key', key)
      .maybeSingle();

    const mergedComments = [existing?.comments, params.comments]
      .filter(Boolean)
      .join(' | ');

    const { error } = await supabase.from('activities').upsert({
      contact_key: key,
      full_name: params.fullName,
      company: params.company,
      subject: params.subject,
      activity_type: params.activityType || 'Email',
      date: today,
      status: 'logged',
      priority: existing?.priority || '',
      comments: mergedComments,
      // The caller knows exactly which contact this touch belongs to — record
      // the resolved identity so the row never joins the orphan pile.
      canonical_key: canonicalKey(params.fullName, params.company) || null,
      contact_table: params.contactType === 'broker' ? 'brokers' : 'partners',
      contact_id: params.contactId,
      match_status: 'matched',
      match_method: 'logged',
      match_confidence: 1,
    });
    if (error) console.error('logActivity error:', error);
  }

  // Reset cadence for the underlying contact.
  if (params.contactType === 'broker') {
    await logBrokerTouch(params.contactId);
  } else {
    await logPartnerTouch(params.contactId);
  }
}

// ============ TEXT SENT ============
export function getTextSent(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem('fs_text_sent') || '{}'); } catch { return {}; }
}
export function markTextSent(id: string): void {
  if (typeof window === 'undefined') return;
  const sent = getTextSent();
  sent[id] = new Date().toISOString();
  localStorage.setItem('fs_text_sent', JSON.stringify(sent));
}

// ============ EXPORT ============
export async function exportAllToCSV(): Promise<void> {
  const [prospects, brokers, partners] = await Promise.all([
    getProspects(), getBrokers(), getPartners()
  ]);

  const rows: string[] = [
    'Type,First Name,Last Name,Company,Email,Phone,Tier,Last Touch,Next Due,Notes,Status'
  ];

  for (const p of prospects) {
    const name = p.contact.split(' ');
    const first = name[0] || '';
    const last = name.slice(1).join(' ') || '';
    const notes = (p.comments || p.subject || '').replace(/,/g, ';').replace(/\n/g, ' ');
    rows.push(`Prospect,${first},${last},${p.company},${p.email || ''},${p.phone || ''},${p.tier},${p.lastTouch || ''},,${notes},`);
  }
  for (const b of brokers) {
    const notes = (b.notes || '').replace(/,/g, ';').replace(/\n/g, ' ');
    rows.push(`Broker,${b.firstName},${b.lastName},${b.firm},${b.email || ''},${b.mobile || ''},${b.tier},${b.lastTouch},${b.nextDue},${notes},${b.status}`);
  }
  for (const p of partners) {
    const notes = (p.notes || '').replace(/,/g, ';').replace(/\n/g, ' ');
    rows.push(`Partner,${p.firstName},${p.lastName},${p.company},${p.email || ''},${p.phone || ''},${p.tier},${p.lastTouch},${p.nextDue},${notes},`);
  }

  const csv = rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `focus-studio-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============ INIT DEFAULTS ============
export async function initDefaultBrokers(): Promise<void> {
  clearLoadError();
  const existing = await getBrokers();
  // Bail on a failed read too — an empty result from a network/API error must
  // not be mistaken for an empty table, or the starter seed upserts over live
  // rows (broker-1..8 share ids with the seed data).
  if (existing.length > 0 || getLastLoadError()) return;

  const starters = [
    { firstName: 'Peter', lastName: 'Shikar', firm: 'CBRE', tier: 'A' as RelationshipTier, dealCount: 7, lastTouch: '2026-03-10' },
    { firstName: 'Brenden', lastName: 'McBride', firm: 'Savills', tier: 'A' as RelationshipTier, dealCount: 3, lastTouch: '2026-03-20' },
    { firstName: 'Joe', lastName: 'DeVries', firm: 'Various', tier: 'A' as RelationshipTier, dealCount: 7, lastTouch: '2026-03-24' },
    { firstName: 'Melissa', lastName: 'Isman', firm: 'Various', tier: 'B' as RelationshipTier, dealCount: 4, lastTouch: '2026-03-24' },
    { firstName: 'Conor', lastName: 'Ryan', firm: 'MRH Real Estate', tier: 'B' as RelationshipTier, dealCount: 4, lastTouch: '2026-01-28' },
    { firstName: 'Alex', lastName: 'Dombrowski', firm: 'Blau & Berg', tier: 'B' as RelationshipTier, dealCount: 2, lastTouch: '2026-01-28' },
    { firstName: 'Jason', lastName: 'Horowitz', firm: 'Triforce Commercial', tier: 'B' as RelationshipTier, dealCount: 1, lastTouch: '2026-03-25' },
    { firstName: 'Tom', lastName: 'Chilenski', firm: 'Cedarcrest PM', tier: 'B' as RelationshipTier, dealCount: 1, lastTouch: '2026-03-31' },
  ];

  const brokers: Broker[] = starters.map((s, idx) => ({
    id: `broker-${idx + 1}`,
    firstName: s.firstName, lastName: s.lastName,
    firm: s.firm, title: 'Broker', tier: s.tier,
    dealCount: s.dealCount, dealNames: [],
    lastTouch: s.lastTouch,
    nextDue: computeNextDue(s.lastTouch, s.tier),
    notes: '', status: computeStatus(s.lastTouch, s.tier),
  }));

  await setBrokers(brokers);
}

export async function initDefaultColdBrokers(): Promise<void> {
  clearLoadError();
  const existing = await getColdBrokers();
  // Same guard as initDefaultBrokers: a failed read is not an empty table.
  // Seeding on error would reset the status of every zi-* row to 'new'.
  if (existing.length > 0 || getLastLoadError()) return;

  const defaults: ColdBroker[] = [
    { id: 'zi-1', name: 'Jon Sarkisian', title: 'EVP', firm: 'CBRE', email: 'jon.sarkisian@cbre.com', phone: '(609) 257-8100', mobile: '(609) 257-8100', status: 'new' },
    { id: 'zi-2', name: 'Nick Savage', title: 'SVP', firm: 'CBRE', email: 'nick.savage@cbre.com', phone: '(201) 712-5887', status: 'new' },
    { id: 'zi-3', name: 'Meghan McGrath', title: 'SVP', firm: 'Cushman & Wakefield', email: 'megan.mcgrath@cushmanwakefield.com', phone: '', mobile: '(917) 902-0226', status: 'new' },
    { id: 'zi-4', name: 'Chat Stacey', title: 'Sr Sales Coordinator', firm: 'JLL', email: 'chat.stacey@jll.com', phone: '(212) 812-5728', status: 'new' },
    { id: 'zi-5', name: 'Jeff Arnold', title: 'Managing Member', firm: 'Forge Commercial Real Estate', email: 'jarnold@forgecre.com', phone: '', status: 'new' },
    { id: 'zi-6', name: 'Glenn Beyer', title: 'Senior Managing Director', firm: 'Newmark', email: 'glenn.beyer@nmrk.com', phone: '(973) 222-7133', status: 'new' },
    { id: 'zi-7', name: 'Michael Kuzmuk', title: 'Senior Managing Director', firm: 'Newmark', email: 'michael.kuzmuk@nmrk.com', phone: '(973) 699-8357', status: 'new' },
    { id: 'zi-8', name: 'Edward Duenas', title: 'Executive Director', firm: 'Cushman & Wakefield', email: 'edward.duenas@cushmanwakefield.com', phone: '(201) 207-1398', status: 'new' },
    { id: 'zi-9', name: 'Eric Staar', title: 'SVP', firm: 'JLL', email: 'eric.staar@jll.com', phone: '(973) 944-8931', status: 'new' },
    { id: 'zi-10', name: 'Colby Scruggs', title: 'SVP', firm: 'Newmark', email: 'colby.scruggs@nmrk.com', phone: '(201) 528-0846', status: 'new' },
  ];

  await setColdBrokers(defaults);
}
