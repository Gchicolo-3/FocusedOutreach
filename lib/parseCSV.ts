import { Lead } from '@/types';
import { prioritizeLead, assignChannel } from './prioritize';

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

const COLUMN_MAP: Record<string, keyof Pick<Lead, 'company' | 'contact' | 'subject' | 'activityType' | 'date' | 'status' | 'priority' | 'comments'>> = {
  company: 'company',
  account: 'company',
  contact: 'contact',
  subject: 'subject',
  'activity type': 'activityType',
  activitytype: 'activityType',
  date: 'date',
  status: 'status',
  priority: 'priority',
  comments: 'comments',
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

export function parseCSV(csvText: string): Lead[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().trim());
  const columnIndices: Partial<Record<string, number>> = {};
  headers.forEach((header, idx) => {
    const mapped = COLUMN_MAP[header];
    if (mapped) columnIndices[mapped] = idx;
  });

  const leads: Lead[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    if (fields.length < 2) continue;

    const getValue = (key: string): string => {
      const idx = columnIndices[key];
      return idx !== undefined && idx < fields.length ? fields[idx] : '';
    };

    const company = getValue('company');
    const contact = getValue('contact');
    if (!company && !contact) continue;

    const comments = getValue('comments');
    const broker = extractBroker(comments);

    const lead: Lead = {
      id: generateId(company, contact),
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
    };

    lead.tier = prioritizeLead(lead);
    lead.channel = assignChannel(lead);

    leads.push(lead);
  }

  return leads;
}
