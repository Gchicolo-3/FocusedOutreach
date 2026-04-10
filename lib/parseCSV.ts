import { Lead, Broker, Partner, UncategorizedContact, ContactType } from '@/types';
import { prioritizeLead, assignChannel } from './prioritize';
import { computeNextDue, computeStatus, defaultTierForBroker, defaultTierForPartner } from './cadence';

export type ParsedImport = {
  prospects: Lead[];
  brokers: Broker[];
  partners: Partner[];
  uncategorized: UncategorizedContact[];
};

function generateId(company: string, contact: string): string {
  return `${company}-${contact}`.toLowerCase().replace(/[^a-z0-9]/g, '-');
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

type ColumnKey =
  | 'company'
  | 'contact'
  | 'subject'
  | 'activityType'
  | 'date'
  | 'status'
  | 'priority'
  | 'comments'
  | 'focusType';

const COLUMN_MAP: Record<string, ColumnKey> = {
  company: 'company',
  account: 'company',
  'account name': 'company',
  contact: 'contact',
  'contact name': 'contact',
  subject: 'subject',
  'activity type': 'activityType',
  activitytype: 'activityType',
  date: 'date',
  'activity date': 'date',
  status: 'status',
  priority: 'priority',
  comments: 'comments',
  'focus_type__c': 'focusType',
  'focus type': 'focusType',
  'focus_type': 'focusType',
};

const BROKER_NAMES = [
  'Peter Shikar', 'Brenden McBride', 'Joe DeVries', 'Melissa Isman',
  'Conor Ryan', 'Alex Dombrowski', 'Jason Horowitz', 'Tom Chilenski',
];

function extractBroker(comments: string): string | undefined {
  if (!comments) return undefined;
  const lower = comments.toLowerCase();
  for (const name of BROKER_NAMES) {
    if (lower.includes(name.toLowerCase())) return name;
  }
  const patterns = [/from (\w+ \w+)/i, /via (\w+ \w+)/i, /intro by (\w+ \w+)/i];
  for (const p of patterns) {
    const match = comments.match(p);
    if (match) return match[1];
  }
  return undefined;
}

function normalizeContactType(raw: string): ContactType {
  const v = (raw || '').toLowerCase().trim();
  if (v === 'prospect') return 'prospect';
  if (v === 'broker') return 'broker';
  if (v === 'referral partner' || v === 'referral_partner' || v === 'referral') return 'referral_partner';
  return 'uncategorized';
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

export function parseCSV(csvText: string, existingTags: Map<string, ContactType> = new Map()): ParsedImport {
  const result: ParsedImport = {
    prospects: [],
    brokers: [],
    partners: [],
    uncategorized: [],
  };

  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return result;

  const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().trim());
  const columnIndices: Partial<Record<ColumnKey, number>> = {};
  headers.forEach((header, idx) => {
    const mapped = COLUMN_MAP[header];
    if (mapped) columnIndices[mapped] = idx;
  });

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    if (fields.length < 2) continue;

    const getValue = (key: ColumnKey): string => {
      const idx = columnIndices[key];
      return idx !== undefined && idx < fields.length ? fields[idx] : '';
    };

    const company = getValue('company');
    const contact = getValue('contact');
    if (!company && !contact) continue;

    const id = generateId(company, contact);
    const comments = getValue('comments');
    const csvType = normalizeContactType(getValue('focusType'));
    // localStorage user tag overrides CSV type
    const type: ContactType = existingTags.get(id) || csvType;

    if (type === 'prospect') {
      const broker = extractBroker(comments);
      const lead: Lead = {
        id,
        company,
        contact,
        subject: getValue('subject'),
        activityType: getValue('activityType'),
        date: getValue('date'),
        status: getValue('status'),
        priority: getValue('priority'),
        comments,
        tier: 1,
        broker,
        channel: 'call',
        lastTouch: getValue('date'),
      };
      lead.tier = prioritizeLead(lead);
      lead.channel = assignChannel(lead);
      result.prospects.push(lead);
    } else if (type === 'broker') {
      const { firstName, lastName } = splitName(contact);
      const tier = defaultTierForBroker(0);
      const lastTouch = getValue('date') || '';
      result.brokers.push({
        id,
        firstName,
        lastName,
        firm: company,
        title: 'Broker',
        tier,
        dealCount: 0,
        dealNames: [],
        lastTouch,
        nextDue: computeNextDue(lastTouch, tier),
        notes: '',
        status: computeStatus(lastTouch, tier),
      });
    } else if (type === 'referral_partner') {
      const { firstName, lastName } = splitName(contact);
      const tier = defaultTierForPartner('other');
      const lastTouch = getValue('date') || '';
      result.partners.push({
        id,
        firstName,
        lastName,
        company,
        title: '',
        partnerType: 'other',
        tier,
        referralCount: 0,
        lastTouch,
        nextDue: computeNextDue(lastTouch, tier),
        notes: '',
      });
    } else {
      result.uncategorized.push({
        id,
        company,
        contact,
        comments,
      });
    }
  }

  return result;
}
