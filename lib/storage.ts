import {
  Lead,
  Broker,
  Partner,
  ColdBroker,
  UncategorizedContact,
  DoneEntry,
  SnoozedEntry,
  NoteEntry,
  TouchLogEntry,
  UserTag,
  Channel,
  RelationshipTier,
  ContactType,
} from '@/types';
import { computeNextDue, computeStatus } from './cadence';

const KEYS = {
  prospects: 'fs_prospects',
  brokers: 'fs_brokers',
  partners: 'fs_referral_partners',
  uncategorized: 'fs_uncategorized',
  done: 'fs_done',
  snoozed: 'fs_snoozed',
  touchLog: 'fs_touch_log',
  notes: 'fs_notes',
  coldBrokers: 'fs_cold_brokers',
  userTags: 'fs_user_tags',
  lastImport: 'fs_last_import',
  lastActivityImport: 'fs_last_activity_import',
  textSent: 'fs_text_sent',
  activities: 'fs_activities',
} as const;

// ============ CHUNKED STORAGE ============
// Splits large arrays across multiple localStorage keys to avoid 5MB limit

const CHUNK_SIZE = 150;

function getChunked<T>(baseKey: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    // Check for chunk count
    const countRaw = localStorage.getItem(`${baseKey}_chunks`);
    if (countRaw) {
      const count = parseInt(countRaw, 10);
      const result: T[] = [];
      for (let i = 0; i < count; i++) {
        const raw = localStorage.getItem(`${baseKey}_${i}`);
        if (raw) {
          const chunk = JSON.parse(raw) as T[];
          result.push(...chunk);
        }
      }
      return result;
    }
    // Fall back to single key (legacy)
    const raw = localStorage.getItem(baseKey);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function setChunked<T>(baseKey: string, items: T[]): void {
  if (typeof window === 'undefined') return;
  try {
    // Clear old chunks
    const oldCountRaw = localStorage.getItem(`${baseKey}_chunks`);
    if (oldCountRaw) {
      const oldCount = parseInt(oldCountRaw, 10);
      for (let i = 0; i < oldCount; i++) {
        localStorage.removeItem(`${baseKey}_${i}`);
      }
    }
    // Clear legacy single key
    localStorage.removeItem(baseKey);

    if (items.length === 0) {
      localStorage.removeItem(`${baseKey}_chunks`);
      return;
    }

    // Write new chunks
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      chunks.push(items.slice(i, i + CHUNK_SIZE));
    }

    for (let i = 0; i < chunks.length; i++) {
      localStorage.setItem(`${baseKey}_${i}`, JSON.stringify(chunks[i]));
    }
    localStorage.setItem(`${baseKey}_chunks`, String(chunks.length));
  } catch (e) {
    console.error(`[storage] setChunked failed for ${baseKey}:`, e);
    // Try to save at least partial data
    try {
      const partial = items.slice(0, Math.floor(items.length / 2));
      localStorage.setItem(baseKey, JSON.stringify(partial));
    } catch {
      console.error(`[storage] partial save also failed for ${baseKey}`);
    }
  }
}

function get<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function set<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error(`[storage] set failed for ${key}:`, e);
  }
}

// ============ PROSPECTS ============
export function getProspects(): Lead[] {
  return getChunked<Lead>(KEYS.prospects);
}
export function setProspects(leads: Lead[]): void {
  setChunked(KEYS.prospects, leads);
}

// ============ BROKERS ============
export function getBrokers(): Broker[] {
  return getChunked<Broker>(KEYS.brokers);
}
export function setBrokers(brokers: Broker[]): void {
  setChunked(KEYS.brokers, brokers);
}
export function updateBroker(id: string, updates: Partial<Broker>): void {
  const brokers = getBrokers();
  const idx = brokers.findIndex((b) => b.id === id);
  if (idx < 0) return;
  const merged = { ...brokers[idx], ...updates };
  merged.nextDue = computeNextDue(merged.lastTouch, merged.tier);
  merged.status = computeStatus(merged.lastTouch, merged.tier);
  brokers[idx] = merged;
  setBrokers(brokers);
}
export function logBrokerTouch(id: string): void {
  const today = new Date().toISOString().split('T')[0];
  updateBroker(id, { lastTouch: today });
  logTouch(id, today, 'text');
}

// ============ PARTNERS ============
export function getPartners(): Partner[] {
  return getChunked<Partner>(KEYS.partners);
}
export function setPartners(partners: Partner[]): void {
  setChunked(KEYS.partners, partners);
}
export function updatePartner(id: string, updates: Partial<Partner>): void {
  const partners = getPartners();
  const idx = partners.findIndex((p) => p.id === id);
  if (idx < 0) return;
  const merged = { ...partners[idx], ...updates };
  merged.nextDue = computeNextDue(merged.lastTouch, merged.tier);
  partners[idx] = merged;
  setPartners(partners);
}
export function logPartnerTouch(id: string): void {
  const today = new Date().toISOString().split('T')[0];
  updatePartner(id, { lastTouch: today });
  logTouch(id, today, 'text');
}

// ============ UNCATEGORIZED ============
export function getUncategorized(): UncategorizedContact[] {
  return getChunked<UncategorizedContact>(KEYS.uncategorized);
}
export function setUncategorized(contacts: UncategorizedContact[]): void {
  setChunked(KEYS.uncategorized, contacts);
}

// ============ COLD BROKERS ============
export function getColdBrokers(): ColdBroker[] {
  return get<ColdBroker[]>(KEYS.coldBrokers, []);
}
export function setColdBrokers(brokers: ColdBroker[]): void {
  set(KEYS.coldBrokers, brokers);
}
export function updateColdBroker(id: string, updates: Partial<ColdBroker>): void {
  const brokers = getColdBrokers();
  const idx = brokers.findIndex((b) => b.id === id);
  if (idx >= 0) {
    brokers[idx] = { ...brokers[idx], ...updates };
    set(KEYS.coldBrokers, brokers);
  }
}

// ============ DONE ============
export function getDone(): DoneEntry[] {
  return get<DoneEntry[]>(KEYS.done, []);
}
export function markDone(id: string, date: string): void {
  const done = getDone();
  if (!done.find((d) => d.id === id && d.date === date)) {
    done.push({ id, date });
    set(KEYS.done, done);
  }
}

// ============ SNOOZED ============
export function getSnoozed(): SnoozedEntry[] {
  return get<SnoozedEntry[]>(KEYS.snoozed, []);
}
export function snoozeLead(id: string, days: number): void {
  const snoozed = getSnoozed();
  const until = new Date();
  until.setDate(until.getDate() + days);
  const entry = { id, until: until.toISOString().split('T')[0] };
  const idx = snoozed.findIndex((s) => s.id === id);
  if (idx >= 0) snoozed[idx] = entry;
  else snoozed.push(entry);
  set(KEYS.snoozed, snoozed);
}

// ============ TOUCH LOG ============
export function getTouchLog(): TouchLogEntry[] {
  return get<TouchLogEntry[]>(KEYS.touchLog, []);
}
export function logTouch(id: string, date: string, channel: Channel): void {
  const log = getTouchLog();
  log.push({ id, date, channel });
  set(KEYS.touchLog, log);
}

// ============ NOTES ============
export function getNotes(): NoteEntry[] {
  return get<NoteEntry[]>(KEYS.notes, []);
}
export function setNote(id: string, text: string): void {
  const notes = getNotes();
  const idx = notes.findIndex((n) => n.id === id);
  if (idx >= 0) notes[idx].text = text;
  else notes.push({ id, text });
  set(KEYS.notes, notes);
}
export function getNote(id: string): string {
  return getNotes().find((n) => n.id === id)?.text || '';
}

// ============ USER TAGS ============
export function getUserTags(): UserTag[] {
  return get<UserTag[]>(KEYS.userTags, []);
}
export function setUserTag(id: string, type: ContactType, tier?: RelationshipTier): void {
  const tags = getUserTags();
  const idx = tags.findIndex((t) => t.id === id);
  const entry: UserTag = { id, type, tier };
  if (idx >= 0) tags[idx] = entry;
  else tags.push(entry);
  set(KEYS.userTags, tags);
}

// ============ LAST IMPORT ============
export function getLastImport(): string | null {
  return get<string | null>(KEYS.lastImport, null);
}
export function setLastImport(date: string): void {
  set(KEYS.lastImport, date);
}
export function getLastActivityImport(): string | null {
  return get<string | null>(KEYS.lastActivityImport, null);
}
export function setLastActivityImport(date: string): void {
  set(KEYS.lastActivityImport, date);
}

// ============ ACTIVITIES ============
import type { ActivityRecord } from './parseCSV';

export function getActivities(): Record<string, ActivityRecord> {
  if (typeof window === 'undefined') return {};
  try {
    // Activities stored in chunks keyed by index
    const countRaw = localStorage.getItem('fs_activities_chunks');
    if (countRaw) {
      const count = parseInt(countRaw, 10);
      const result: Record<string, ActivityRecord> = {};
      for (let i = 0; i < count; i++) {
        const raw = localStorage.getItem(`fs_activities_${i}`);
        if (raw) {
          const chunk = JSON.parse(raw) as Record<string, ActivityRecord>;
          Object.assign(result, chunk);
        }
      }
      return result;
    }
    // Legacy single key fallback
    const raw = localStorage.getItem(KEYS.activities);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function setActivities(activities: Record<string, ActivityRecord>): void {
  if (typeof window === 'undefined') return;
  try {
    // Clear old chunks
    const oldCountRaw = localStorage.getItem('fs_activities_chunks');
    if (oldCountRaw) {
      const oldCount = parseInt(oldCountRaw, 10);
      for (let i = 0; i < oldCount; i++) {
        localStorage.removeItem(`fs_activities_${i}`);
      }
    }
    localStorage.removeItem(KEYS.activities);

    const entries = Object.entries(activities);
    if (entries.length === 0) {
      localStorage.removeItem('fs_activities_chunks');
      return;
    }

    const ACTIVITY_CHUNK = 200;
    let chunkIdx = 0;
    for (let i = 0; i < entries.length; i += ACTIVITY_CHUNK) {
      const chunk = Object.fromEntries(entries.slice(i, i + ACTIVITY_CHUNK));
      localStorage.setItem(`fs_activities_${chunkIdx}`, JSON.stringify(chunk));
      chunkIdx++;
    }
    localStorage.setItem('fs_activities_chunks', String(chunkIdx));
  } catch (e) {
    console.error('[storage] setActivities failed:', e);
  }
}

export function mergeActivities(incoming: Record<string, ActivityRecord>): Record<string, ActivityRecord> {
  const existing = getActivities();
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
        ...prev,
        comments: mergedComments,
        subject: newer ? next.subject || prev.subject : prev.subject,
        activityType: newer ? next.activityType || prev.activityType : prev.activityType,
        date: newer ? next.date : prev.date,
        status: newer ? next.status || prev.status : prev.status,
        priority: newer ? next.priority || prev.priority : prev.priority,
      };
    }
  }
  setActivities(merged);
  return merged;
}

// ============ TEXT SENT ============
export function getTextSent(): Record<string, string> {
  return get<Record<string, string>>(KEYS.textSent, {});
}
export function markTextSent(id: string): void {
  const sent = getTextSent();
  sent[id] = new Date().toISOString();
  set(KEYS.textSent, sent);
}

// ============ EXPORT ============
export function exportAllToCSV(): void {
  const prospects = getProspects();
  const brokers = getBrokers();
  const partners = getPartners();

  const rows: string[] = [
    'Type,First Name,Last Name,Company,Email,Phone,Tier,Last Touch,Next Due,Notes/Subject,Status'
  ];

  for (const p of prospects) {
    const name = p.contact.split(' ');
    const first = name[0] || '';
    const last = name.slice(1).join(' ') || '';
    const notes = (p.comments || p.subject || '').replace(/,/g, ';').replace(/\n/g, ' ');
    rows.push(`Prospect,${first},${last},${p.company},${p.email || ''},${p.phone || ''},${p.tier},${p.lastTouch || p.date || ''},,${notes},`);
  }

  for (const b of brokers) {
    const notes = (b.notes || '').replace(/,/g, ';').replace(/\n/g, ' ');
    rows.push(`Broker,${b.firstName},${b.lastName},${b.firm},${b.email || ''},${b.mobile || b.phone || ''},${b.tier},${b.lastTouch},${b.nextDue},${notes},${b.status}`);
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
  a.download = `focus-studio-contacts-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============ CLEAR ALL ============
export function clearAllData(): void {
  if (typeof window === 'undefined') return;
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('fs_')) keysToRemove.push(k);
  }
  keysToRemove.forEach((k) => localStorage.removeItem(k));
}

// ============ INIT DEFAULTS ============
export function initDefaultBrokers(): void {
  if (getBrokers().length > 0) return;

  const starters: Array<{
    firstName: string;
    lastName: string;
    firm: string;
    tier: RelationshipTier;
    dealCount: number;
    lastTouch: string;
  }> = [
    { firstName: 'Peter', lastName: 'Shikar', firm: 'CBRE', tier: 'A', dealCount: 7, lastTouch: '2026-03-10' },
    { firstName: 'Brenden', lastName: 'McBride', firm: 'Savills', tier: 'A', dealCount: 3, lastTouch: '2026-03-20' },
    { firstName: 'Joe', lastName: 'DeVries', firm: 'Various', tier: 'A', dealCount: 7, lastTouch: '2026-03-24' },
    { firstName: 'Melissa', lastName: 'Isman', firm: 'Various', tier: 'B', dealCount: 4, lastTouch: '2026-03-24' },
    { firstName: 'Conor', lastName: 'Ryan', firm: 'MRH Real Estate', tier: 'B', dealCount: 4, lastTouch: '2026-01-28' },
    { firstName: 'Alex', lastName: 'Dombrowski', firm: 'Blau & Berg', tier: 'B', dealCount: 2, lastTouch: '2026-01-28' },
    { firstName: 'Jason', lastName: 'Horowitz', firm: 'Triforce Commercial', tier: 'B', dealCount: 1, lastTouch: '2026-03-25' },
    { firstName: 'Tom', lastName: 'Chilenski', firm: 'Cedarcrest PM', tier: 'B', dealCount: 1, lastTouch: '2026-03-31' },
  ];

  const brokers: Broker[] = starters.map((s, idx) => ({
    id: `broker-${idx + 1}`,
    firstName: s.firstName,
    lastName: s.lastName,
    firm: s.firm,
    title: 'Broker',
    tier: s.tier,
    dealCount: s.dealCount,
    dealNames: [],
    lastTouch: s.lastTouch,
    nextDue: computeNextDue(s.lastTouch, s.tier),
    notes: '',
    status: computeStatus(s.lastTouch, s.tier),
  }));

  setBrokers(brokers);
}

export function initDefaultColdBrokers(): void {
  if (getColdBrokers().length > 0) return;

  const defaults: ColdBroker[] = [
    { id: 'zi-1', name: 'Jon Sarkisian', title: 'EVP', firm: 'CBRE', email: 'jon.sarkisian@cbre.com', phone: '(856) 359-9408', mobile: '(609) 257-8100', status: 'new' },
    { id: 'zi-2', name: 'Robert Zwengler', title: 'EVP', firm: 'CBRE', email: 'robert.zwengler@cbre.com', phone: '(215) 516-8979', status: 'new' },
    { id: 'zi-3', name: 'Nick Savage', title: 'SVP', firm: 'CBRE', email: 'nick.savage@cbre.com', phone: '(201) 712-5887', mobile: '(203) 722-6076', status: 'new' },
    { id: 'zi-4', name: 'Elli Klapper', title: 'EVP', firm: 'CBRE', email: 'elli.klapper@cbre.com', phone: '(718) 289-7719', status: 'new' },
    { id: 'zi-5', name: 'Aviva Nussbaum', title: 'VP', firm: 'CBRE', email: 'aviva.nussbaum@cbre.com', phone: '(212) 984-7115', status: 'new' },
    { id: 'zi-6', name: 'Frank Caccavo', title: 'EVP', firm: 'Cushman & Wakefield', email: 'frank.caccavo@cushwake.com', phone: '(732) 452-6163', mobile: '(732) 241-0464', status: 'new' },
    { id: 'zi-7', name: 'Meghan McGrath', title: 'SVP', firm: 'Cushman & Wakefield', email: 'megan.mcgrath@cushmanwakefield.com', mobile: '(917) 902-0226', phone: '', status: 'new' },
    { id: 'zi-8', name: 'Charles Parmelli', title: 'EMD', firm: 'Cushman & Wakefield', email: 'cparmelli@cushmanwakefield.com', phone: '(973) 908-6105', status: 'new' },
    { id: 'zi-9', name: 'Eric Staar', title: 'SVP', firm: 'JLL', email: 'eric.staar@jll.com', phone: '(973) 404-1487', mobile: '(973) 944-8931', status: 'new' },
    { id: 'zi-10', name: 'Colby Scruggs', title: 'SVP', firm: 'Newmark', email: 'colby.scruggs@nmrk.com', phone: '(201) 528-0846', status: 'new' },
    { id: 'zi-11', name: 'Chat Stacey', title: 'Sr Sales Coordinator', firm: 'JLL', email: 'chat.stacey@jll.com', phone: '(212) 812-5728', status: 'new' },
    { id: 'zi-12', name: 'Jeff Arnold', title: 'Managing Member', firm: 'Forge Commercial Real Estate', email: 'jarnold@forgecre.com', phone: '', status: 'new' },
    { id: 'zi-13', name: 'Glenn Beyer', title: 'Senior Managing Director', firm: 'Newmark', email: 'glenn.beyer@nmrk.com', phone: '(973) 222-7133', status: 'new' },
    { id: 'zi-14', name: 'Michael Kuzmuk', title: 'Senior Managing Director', firm: 'Newmark', email: 'michael.kuzmuk@nmrk.com', phone: '(973) 699-8357', status: 'new' },
    { id: 'zi-15', name: 'Edward Duenas', title: 'Executive Director', firm: 'Cushman & Wakefield', email: 'edward.duenas@cushmanwakefield.com', phone: '(201) 207-1398', status: 'new' },
    { id: 'zi-16', name: 'Jeffrey Prezant', title: 'Executive Managing Director', firm: 'Cushman & Wakefield', email: 'jeffrey.prezant@cushwake.com', phone: '', status: 'new' },
  ];

  setColdBrokers(defaults);
}
