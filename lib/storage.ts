import { supabase } from './supabase';
import {
  Lead, Broker, Partner, ColdBroker, UncategorizedContact,
  DoneEntry, SnoozedEntry, NoteEntry, TouchLogEntry, PinnedEntry,
  UserTag, Channel, RelationshipTier, ContactType, TaskSource, ContactSearchResult,
} from '@/types';
import { computeNextDue, computeStatus, quickLogDays, addDaysISO } from './cadence';
export type { ActivityRecord } from './parseCSV';
import type { ActivityRecord } from './parseCSV';

export { supabaseConfigured } from './supabase';

// Supabase caps a single select at 1000 rows. Page through so growing tables
// (brokers is already ~460) never silently truncate.
async function fetchAll<T = Record<string, unknown>>(
  table: string
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(from, from + PAGE - 1);
    if (error) { console.error(`[fetchAll ${table}]`, error); break; }
    const rows = (data || []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

// Coercion helpers for loosely-typed DB rows.
const s = (v: unknown): string => (v == null ? '' : String(v));
const so = (v: unknown): string | undefined => {
  if (v == null) return undefined;
  const str = String(v);
  return str === '' ? undefined : str;
};
const n = (v: unknown): number => {
  const num = Number(v);
  return Number.isFinite(num) ? num : 0;
};

// ============ PROSPECTS ============
export async function getProspects(): Promise<Lead[]> {
  const data = await fetchAll('prospects');
  return data.map(r => ({
    id: s(r.id), company: s(r.company), contact: s(r.contact),
    subject: s(r.subject), activityType: s(r.activity_type), date: s(r.date),
    status: s(r.status), priority: s(r.priority), comments: s(r.comments),
    tier: (n(r.tier) || 3) as 1 | 2 | 3, broker: so(r.broker), channel: s(r.channel) as Channel,
    lastTouch: so(r.last_touch), nextDue: so(r.next_due), email: so(r.email), phone: so(r.phone),
  }));
}

export async function setProspects(leads: Lead[]): Promise<void> {
  if (leads.length === 0) return;
  const rows = leads.map(l => ({
    id: l.id, company: l.company, contact: l.contact,
    subject: l.subject, activity_type: l.activityType, date: l.date,
    status: l.status, priority: l.priority, comments: l.comments,
    tier: l.tier, broker: l.broker || null, channel: l.channel,
    last_touch: l.lastTouch || null, next_due: l.nextDue || null,
    email: l.email || null, phone: l.phone || null,
  }));
  // Upsert in batches of 100
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await supabase.from('prospects').upsert(rows.slice(i, i + 100));
    if (error) console.error('setProspects batch error:', error);
  }
}

export async function updateProspect(id: string, updates: Partial<Lead>): Promise<void> {
  const row: Record<string, unknown> = {};
  if (updates.lastTouch !== undefined) row.last_touch = updates.lastTouch || null;
  if (updates.nextDue !== undefined) row.next_due = updates.nextDue || null;
  if (updates.tier !== undefined) row.tier = updates.tier;
  if (updates.comments !== undefined) row.comments = updates.comments;
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase.from('prospects').update(row).eq('id', id);
  if (error) console.error('updateProspect error:', error);
}

// ============ BROKERS ============
export async function getBrokers(): Promise<Broker[]> {
  const data = await fetchAll('brokers');
  return data.map(r => ({
    id: s(r.id), firstName: s(r.first_name), lastName: s(r.last_name),
    firm: s(r.firm), title: s(r.title), email: so(r.email), phone: so(r.phone),
    mobile: so(r.mobile), linkedin: so(r.linkedin), tier: (s(r.tier) || 'C') as RelationshipTier,
    dealCount: n(r.deal_count), dealNames: (r.deal_names as string[]) || [],
    lastTouch: s(r.last_touch), nextDue: s(r.next_due), notes: s(r.notes),
    status: (s(r.status) || 'on_track') as Broker['status'],
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
  const data = await fetchAll('partners');
  return data.map(r => ({
    id: s(r.id), firstName: s(r.first_name), lastName: s(r.last_name),
    company: s(r.company), title: s(r.title), partnerType: (s(r.partner_type) || 'other') as Partner['partnerType'],
    tier: (s(r.tier) || 'C') as RelationshipTier, referralCount: n(r.referral_count),
    lastTouch: s(r.last_touch), nextDue: s(r.next_due), notes: s(r.notes),
    email: so(r.email), phone: so(r.phone),
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
  });
}

export async function logPartnerTouch(id: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  await updatePartner(id, { lastTouch: today });
  await logTouch(id, today, 'text');
}

// ============ COLD BROKERS ============
export async function getColdBrokers(): Promise<ColdBroker[]> {
  return fetchAll<ColdBroker>('cold_brokers');
}

export async function setColdBrokers(brokers: ColdBroker[]): Promise<void> {
  if (brokers.length === 0) return;
  const { error } = await supabase.from('cold_brokers').upsert(brokers);
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
  const data = await fetchAll('touch_log');
  return data.map(r => ({
    id: s(r.contact_id), date: s(r.date), channel: s(r.channel) as Channel,
    spoke: typeof r.spoke === 'boolean' ? r.spoke : undefined, notes: so(r.notes),
  }));
}

export async function logTouch(
  id: string, date: string, channel: Channel, spoke?: boolean, notes?: string
): Promise<void> {
  const { error } = await supabase.from('touch_log').insert({
    contact_id: id, date, channel,
    spoke: spoke ?? null, notes: notes || '',
  });
  if (error) console.error(error);
}

// Count consecutive "no answer" touches at the end of a contact's history.
// Resets to 0 the moment they were last reached (spoke = true).
export async function getConsecutiveNAs(id: string): Promise<number> {
  const { data, error } = await supabase
    .from('touch_log')
    .select('spoke,date,created_at')
    .eq('contact_id', id)
    .order('created_at', { ascending: false });
  if (error) { console.error(error); return 0; }
  let count = 0;
  for (const row of data || []) {
    if (row.spoke === false) count++;
    else if (row.spoke === true) break;
  }
  return count;
}

// ============ PINS (Do This Now — clear at midnight) ============
export async function getPins(): Promise<PinnedEntry[]> {
  const data = await fetchAll('pinned_entries');
  return data.map(r => ({ id: s(r.id), date: s(r.date), source: s(r.source) as TaskSource }));
}

// Pins pinned for today only. Stale (yesterday's) pins are ignored.
export async function getPinsToday(): Promise<PinnedEntry[]> {
  const today = new Date().toISOString().split('T')[0];
  const all = await getPins();
  return all.filter(p => p.date === today);
}

export async function addPin(id: string, source: TaskSource): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const { error } = await supabase.from('pinned_entries').upsert({ id, date: today, source });
  if (error) console.error('addPin error:', error);
}

export async function removePin(id: string): Promise<void> {
  const { error } = await supabase.from('pinned_entries').delete().eq('id', id);
  if (error) console.error('removePin error:', error);
}

// ============ QUICK LOG ============
// Logs an activity, advances last touch to today, and schedules the next
// follow up using George's cadence. Never auto-changes tiers or statuses.
export async function quickLog(opts: {
  id: string;
  source: TaskSource;
  channel: Channel;
  spoke: boolean;
  notes?: string;
  grade?: RelationshipTier;
  leadTier?: 1 | 2 | 3;
}): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const days = quickLogDays({
    source: opts.source, spoke: opts.spoke, grade: opts.grade, leadTier: opts.leadTier,
  });
  const nextDue = addDaysISO(days);

  await logTouch(opts.id, today, opts.channel, opts.spoke, opts.notes);

  if (opts.source === 'broker') {
    await updateBroker(opts.id, { lastTouch: today });
  } else if (opts.source === 'partner') {
    await updatePartner(opts.id, { lastTouch: today });
  } else if (opts.source === 'prospect') {
    await updateProspect(opts.id, { lastTouch: today, nextDue });
  }
  // cold_broker has no cadence row; the touch_log entry is the record.
}

// ============ CONTACT SEARCH (manual add) ============
export async function searchContacts(query: string): Promise<ContactSearchResult[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const [prospects, brokers, partners, cold] = await Promise.all([
    getProspects(), getBrokers(), getPartners(), getColdBrokers(),
  ]);
  const out: ContactSearchResult[] = [];
  for (const p of prospects) {
    if (`${p.contact} ${p.company}`.toLowerCase().includes(q))
      out.push({ id: p.id, source: 'prospect', name: p.contact, company: p.company, email: p.email, phone: p.phone });
  }
  for (const b of brokers) {
    if (`${b.firstName} ${b.lastName} ${b.firm}`.toLowerCase().includes(q))
      out.push({ id: b.id, source: 'broker', name: `${b.firstName} ${b.lastName}`, company: b.firm, email: b.email, phone: b.mobile || b.phone });
  }
  for (const p of partners) {
    if (`${p.firstName} ${p.lastName} ${p.company}`.toLowerCase().includes(q))
      out.push({ id: p.id, source: 'partner', name: `${p.firstName} ${p.lastName}`, company: p.company, email: p.email, phone: p.phone });
  }
  for (const c of cold) {
    if (`${c.name} ${c.firm}`.toLowerCase().includes(q))
      out.push({ id: c.id, source: 'cold_broker', name: c.name, company: c.firm, email: c.email, phone: c.mobile || c.phone });
  }
  return out.slice(0, 12);
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
// RFC-4180 style escaping so fields with commas/quotes/newlines survive a
// Salesforce import instead of being mangled.
function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}

export async function exportAllToCSV(): Promise<void> {
  const [prospects, brokers, partners, cold] = await Promise.all([
    getProspects(), getBrokers(), getPartners(), getColdBrokers(),
  ]);

  // Columns: Type, First Name, Last Name, Company, Email, Phone, Grade, Tier,
  // Last Touch, Next Due, Notes, Status — kept close to Salesforce import shape.
  const rows: string[] = [
    csvRow(['Type', 'First Name', 'Last Name', 'Company', 'Email', 'Phone',
      'Grade', 'Tier', 'Last Touch', 'Next Due', 'Notes', 'Status']),
  ];

  for (const p of prospects) {
    const parts = p.contact.split(' ');
    rows.push(csvRow([
      'Prospect', parts[0] || '', parts.slice(1).join(' '), p.company,
      p.email || '', p.phone || '', '', p.tier,
      p.lastTouch || '', p.nextDue || '', p.comments || p.subject || '', p.status || '',
    ]));
  }
  for (const b of brokers) {
    rows.push(csvRow([
      'Broker', b.firstName, b.lastName, b.firm, b.email || '', b.mobile || b.phone || '',
      b.tier, '', b.lastTouch || '', b.nextDue || '', b.notes || '', b.status || '',
    ]));
  }
  for (const p of partners) {
    rows.push(csvRow([
      'Referral Partner', p.firstName, p.lastName, p.company, p.email || '', p.phone || '',
      p.tier, '', p.lastTouch || '', p.nextDue || '', p.notes || '', '',
    ]));
  }
  for (const c of cold) {
    const parts = c.name.split(' ');
    rows.push(csvRow([
      'New Broker', parts[0] || '', parts.slice(1).join(' '), c.firm,
      c.email || '', c.mobile || c.phone || '', '', '', '', '', '', c.status || '',
    ]));
  }

  const csv = rows.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `focus-studio-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============ INIT DEFAULTS ============
export async function initDefaultBrokers(): Promise<void> {
  const existing = await getBrokers();
  if (existing.length > 0) return;

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
  const existing = await getColdBrokers();
  if (existing.length > 0) return;

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
