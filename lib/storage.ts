import { Lead, Broker, ColdBroker, DoneEntry, SnoozedEntry, NoteEntry } from '@/types';

const KEYS = {
  leads: 'fs_leads',
  done: 'fs_done',
  snoozed: 'fs_snoozed',
  brokers: 'fs_brokers',
  coldBrokers: 'fs_cold_brokers',
  notes: 'fs_notes',
  lastImport: 'fs_last_import',
} as const;

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
  localStorage.setItem(key, JSON.stringify(value));
}

export function getLeads(): Lead[] {
  return get<Lead[]>(KEYS.leads, []);
}
export function setLeads(leads: Lead[]): void {
  set(KEYS.leads, leads);
}

export function getDone(): DoneEntry[] {
  return get<DoneEntry[]>(KEYS.done, []);
}
export function markDone(leadId: string, date: string): void {
  const done = getDone();
  if (!done.find((d) => d.id === leadId && d.date === date)) {
    done.push({ id: leadId, date });
    set(KEYS.done, done);
  }
}

export function getSnoozed(): SnoozedEntry[] {
  return get<SnoozedEntry[]>(KEYS.snoozed, []);
}
export function snoozeLead(leadId: string, days: number): void {
  const snoozed = getSnoozed();
  const until = new Date();
  until.setDate(until.getDate() + days);
  const entry = { id: leadId, until: until.toISOString().split('T')[0] };
  const idx = snoozed.findIndex((s) => s.id === leadId);
  if (idx >= 0) snoozed[idx] = entry;
  else snoozed.push(entry);
  set(KEYS.snoozed, snoozed);
}

export function getBrokers(): Broker[] {
  return get<Broker[]>(KEYS.brokers, []);
}
export function setBrokers(brokers: Broker[]): void {
  set(KEYS.brokers, brokers);
}
export function updateBroker(id: string, updates: Partial<Broker>): void {
  const brokers = getBrokers();
  const idx = brokers.findIndex((b) => b.id === id);
  if (idx >= 0) {
    brokers[idx] = { ...brokers[idx], ...updates };
    set(KEYS.brokers, brokers);
  }
}

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

export function getLastImport(): string | null {
  return get<string | null>(KEYS.lastImport, null);
}
export function setLastImport(date: string): void {
  set(KEYS.lastImport, date);
}

export function initDefaultBrokers(): void {
  if (getBrokers().length > 0) return;
  const defaults: Broker[] = [
    { id: 'broker-1', name: 'Peter Shikar', firm: 'CBRE', dealCount: 7, lastTouch: '', notes: '' },
    { id: 'broker-2', name: 'Brenden McBride', firm: 'Savills', dealCount: 3, lastTouch: '', notes: '' },
    { id: 'broker-3', name: 'Joe DeVries', firm: 'Various', dealCount: 7, lastTouch: '', notes: '' },
    { id: 'broker-4', name: 'Melissa Isman', firm: 'Various', dealCount: 4, lastTouch: '', notes: '' },
    { id: 'broker-5', name: 'Conor Ryan', firm: 'MRH Real Estate Services', dealCount: 4, lastTouch: '', notes: '' },
    { id: 'broker-6', name: 'Alex Dombrowski', firm: 'Blau & Berg', dealCount: 2, lastTouch: '', notes: '' },
    { id: 'broker-7', name: 'Jason Horowitz', firm: 'Triforce Commercial', dealCount: 1, lastTouch: '', notes: '' },
    { id: 'broker-8', name: 'Tom Chilenski', firm: 'Cedarcrest Property Management', dealCount: 1, lastTouch: '', notes: '' },
  ];
  setBrokers(defaults);
}
