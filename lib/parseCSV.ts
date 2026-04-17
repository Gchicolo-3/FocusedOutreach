import { Lead, Broker, Partner, UncategorizedContact, ContactType } from '@/types';
import { prioritizeLead, assignChannel } from './prioritize';
import { computeNextDue, computeStatus, defaultTierForBroker, defaultTierForPartner } from './cadence';

export type ParsedImport = {
  prospects: Lead[];
  brokers: Broker[];
  partners: Partner[];
  uncategorized: UncategorizedContact[];
};

export type ActivityRecord = {
  contactKey: string;
  fullName: string;
  company: string;
  subject: string;
  activityType: string;
  date: string;
  status: string;
  priority: string;
  comments: string;
};

export function normalizeContactKey(name: string): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
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
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'mobile'
  | 'phone'
  | 'subject'
  | 'activityType'
  | 'date'
  | 'status'
  | 'priority'
  | 'comments'
  | 'focusType';

const COLUMN_MAP: Record<string, ColumnKey> = {
  // New simplified format
  'subject': 'subject',
  'first name': 'firstName',
  'firstname': 'firstName',
  'last name': 'lastName',
  'lastname': 'lastName',
  'email': 'email',
  'mobile': 'mobile',
  'phone': 'phone',
  'phone number': 'phone',
  'contact type': 'focusType',
  // Legacy SF activity export format
  'company': 'company',
  'account': 'company',
  'account name': 'company',
  'contact': 'contact',
  'contact name': 'contact',
  'activity type': 'activityType',
  'activitytype': 'activityType',
  'date': 'date',
  'activity date': 'date',
  'status': 'status',
  'priority': 'priority',
  'comments': 'comments',
  'focus_type__c': 'focusType',
  'focus type': 'focusType',
  'focus_type': 'focusType',
};

const FIRM_MAP: Record<string, string> = {
  'cbre.com': 'CBRE',
  'jll.com': 'JLL',
  'am.jll.com': 'JLL',
  'cushwake.com': 'Cushman & Wakefield',
  'cushmanwakefield.com': 'Cushman & Wakefield',
  'nmrk.com': 'Newmark',
  'newmarkrealestate.com': 'Newmark',
  'ngkf.com': 'Newmark Knight Frank',
  'savills.us': 'Savills',
  'colliers.com': 'Colliers',
  'avisonyoung.com': 'Avison Young',
  'lee-associates.com': 'Lee & Associates',
  'marcusmillichap.com': 'Marcus & Millichap',
  'kw.com': 'Keller Williams',
  'kwcommercial.com': 'KW Commercial',
  'cbrealty.com': 'Coldwell Banker',
  'coldwellbankermoves.com': 'Coldwell Banker',
  'cbmoves.com': 'Coldwell Banker',
  'foxroach.com': 'BHHS Fox & Roach',
  'bhhspro.com': 'Berkshire Hathaway',
  'remax.com': 'RE/MAX',
  'remax.net': 'RE/MAX',
  'blauberg.com': 'Blau & Berg',
  'triforcecre.com': 'Triforce Commercial',
  'cedarcrestpm.com': 'Cedarcrest PM',
  'cedarcrestpropertymanagement.com': 'Cedarcrest PM',
  'mrhrealestate.com': 'MRH Real Estate',
  'naihanson.com': 'NAI Hanson',
  'naidb.com': 'NAI DiLeo-Bram',
  'cresa.com': 'Cresa',
  'sheldongrossrealty.com': 'Sheldon Gross Realty',
  'resource-realty.com': 'Resource Realty',
  'resourcesrealestate.com': 'Resources Real Estate',
  'silbertrealestate.com': 'Silbert Real Estate',
  'weichertcommercial.com': 'Weichert Commercial',
  'weichert.com': 'Weichert',
  'sitarcompany.com': 'The Sitar Company',
  'rarefiedrep.com': 'Rarefied Rep',
  'tocr.com': 'The Outerbridge Company',
  'compass.com': 'Compass',
  'jrmcm.com': 'JRM Construction Management',
};

function firmFromEmail(email: string): string {
  if (!email || email.toLowerCase() === 'nan') return '';
  const domain = email.split('@')[1]?.toLowerCase().trim();
  if (!domain) return '';
  if (FIRM_MAP[domain]) return FIRM_MAP[domain];
  const base = domain.split('.')[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function cleanValue(v: string): string {
  if (!v) return '';
  const t = v.trim();
  if (t.toLowerCase() === 'nan') return '';
  return t;
}

function normalizeContactType(raw: string): ContactType {
  const v = cleanValue(raw).toLowerCase();
  if (!v) return 'uncategorized';
  if (v.includes('referral')) return 'referral_partner';
  if (v.includes('broker') || v.includes('property manager')) return 'broker';
  if (v.includes('prospect') || v.includes('client')) return 'prospect';
  if (v === 'uncategorized') return 'uncategorized';
  return 'uncategorized';
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = cleanValue(fullName).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function generateId(email: string, firstName: string, lastName: string, company: string): string {
  const cleaned = cleanValue(email);
  if (cleaned && cleaned.includes('@')) {
    return cleaned.toLowerCase().replace(/[^a-z0-9]/g, '_');
  }
  const base = `${firstName}-${lastName}-${company}`.toLowerCase().replace(/[^a-z0-9]/g, '-');
  return base || `contact-${Math.random().toString(36).slice(2, 8)}`;
}

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

export function parseCSV(csvText: string, existingTags: Map<string, ContactType> = new Map()): ParsedImport {
  const result: ParsedImport = {
    prospects: [],
    brokers: [],
    partners: [],
    uncategorized: [],
  };

  if (!csvText) {
    console.warn('[parseCSV] empty csvText');
    return result;
  }

  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    console.warn('[parseCSV] not enough lines:', lines.length);
    return result;
  }

  const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().trim());
  const columnIndices: Partial<Record<ColumnKey, number>> = {};
  headers.forEach((header, idx) => {
    const mapped = COLUMN_MAP[header];
    if (mapped) columnIndices[mapped] = idx;
  });

  console.log('[parseCSV] headers:', headers);
  console.log('[parseCSV] mapped columns:', columnIndices);

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    if (fields.length < 1) continue;

    const getValue = (key: ColumnKey): string => {
      const idx = columnIndices[key];
      return idx !== undefined && idx < fields.length ? cleanValue(fields[idx]) : '';
    };

    const csvFirstName = getValue('firstName');
    const csvLastName = getValue('lastName');
    const csvContact = getValue('contact');
    const email = getValue('email');
    const mobile = getValue('mobile') || getValue('phone');

    // Resolve first/last name from either separate columns or combined contact
    let firstName = csvFirstName;
    let lastName = csvLastName;
    if (!firstName && !lastName && csvContact) {
      const split = splitName(csvContact);
      firstName = split.firstName;
      lastName = split.lastName;
    }

    if (!firstName && !lastName && !email) continue;

    const fullName = csvContact || `${firstName} ${lastName}`.trim();
    const company = getValue('company') || firmFromEmail(email);
    const subject = getValue('subject');
    const comments = getValue('comments') || subject;

    const id = generateId(email, firstName, lastName, company);
    const csvType = normalizeContactType(getValue('focusType'));
    const type: ContactType = existingTags.get(id) || csvType;

    if (type === 'prospect') {
      const broker = extractBroker(comments);
      const lead: Lead = {
        id,
        company: company || 'Unknown',
        contact: fullName,
        subject,
        activityType: getValue('activityType'),
        date: getValue('date'),
        status: getValue('status'),
        priority: getValue('priority'),
        comments,
        tier: 1,
        broker,
        channel: 'call',
        lastTouch: getValue('date'),
        email: email || undefined,
        phone: mobile || undefined,
      };
      lead.tier = prioritizeLead(lead);
      lead.channel = assignChannel(lead);
      result.prospects.push(lead);
    } else if (type === 'broker') {
      const tier = defaultTierForBroker(0);
      const lastTouch = getValue('date') || '';
      result.brokers.push({
        id,
        firstName,
        lastName,
        firm: company || 'Unknown',
        title: 'Broker',
        email: email || undefined,
        mobile: mobile || undefined,
        tier,
        dealCount: 0,
        dealNames: [],
        lastTouch,
        nextDue: computeNextDue(lastTouch, tier),
        notes: subject || '',
        status: computeStatus(lastTouch, tier),
      });
    } else if (type === 'referral_partner') {
      const tier = defaultTierForPartner('other');
      const lastTouch = getValue('date') || '';
      result.partners.push({
        id,
        firstName,
        lastName,
        company: company || 'Unknown',
        title: '',
        partnerType: 'other',
        tier,
        referralCount: 0,
        lastTouch,
        nextDue: computeNextDue(lastTouch, tier),
        notes: subject || '',
        email: email || undefined,
        phone: mobile || undefined,
      });
    } else {
      result.uncategorized.push({
        id,
        company: company || 'Unknown',
        contact: fullName,
        comments,
      });
    }
  }

  return result;
}

// ============ ACTIVITY CSV (legacy SF activity export) ============

export function parseActivityCSV(csvText: string): Record<string, ActivityRecord> {
  const result: Record<string, ActivityRecord> = {};
  if (!csvText) return result;

  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    console.warn('[parseActivityCSV] not enough lines:', lines.length);
    return result;
  }

  const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().trim());
  const columnIndices: Partial<Record<ColumnKey, number>> = {};
  headers.forEach((header, idx) => {
    const mapped = COLUMN_MAP[header];
    if (mapped) columnIndices[mapped] = idx;
  });

  console.log('[parseActivityCSV] headers:', headers);
  console.log('[parseActivityCSV] mapped columns:', columnIndices);

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    if (fields.length < 1) continue;

    const getValue = (key: ColumnKey): string => {
      const idx = columnIndices[key];
      return idx !== undefined && idx < fields.length ? cleanValue(fields[idx]) : '';
    };

    const contactField = getValue('contact');
    const firstName = getValue('firstName');
    const lastName = getValue('lastName');
    const fullName = contactField || `${firstName} ${lastName}`.trim();

    if (!fullName) continue;

    const key = normalizeContactKey(fullName);
    if (!key) continue;

    const record: ActivityRecord = {
      contactKey: key,
      fullName,
      company: getValue('company'),
      subject: getValue('subject'),
      activityType: getValue('activityType'),
      date: getValue('date'),
      status: getValue('status'),
      priority: getValue('priority'),
      comments: getValue('comments'),
    };

    const existing = result[key];
    if (!existing) {
      result[key] = record;
    } else {
      // Concatenate comments so intel keywords from any activity are captured
      const mergedComments = [existing.comments, record.comments]
        .filter(Boolean)
        .join(' | ');
      // Keep most recent date/subject/activityType
      const newer = record.date && (!existing.date || record.date > existing.date);
      result[key] = {
        ...existing,
        comments: mergedComments,
        subject: newer ? record.subject || existing.subject : existing.subject,
        activityType: newer ? record.activityType || existing.activityType : existing.activityType,
        date: newer ? record.date : existing.date,
        status: newer ? record.status || existing.status : existing.status,
        priority: newer ? record.priority || existing.priority : existing.priority,
        company: existing.company || record.company,
      };
    }
  }

  return result;
}

// ============ ENRICHMENT ============

function enrichBrokerName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

export function enrichLeadsWithActivities(
  prospects: Lead[],
  activities: Record<string, ActivityRecord>
): Lead[] {
  return prospects.map((lead) => {
    const key = normalizeContactKey(lead.contact);
    const act = activities[key];
    if (!act) return lead;

    const comments = act.comments || lead.comments;
    const broker = extractBroker(comments) || lead.broker;
    const updated: Lead = {
      ...lead,
      company: lead.company && lead.company !== 'Unknown' ? lead.company : act.company || lead.company,
      subject: act.subject || lead.subject,
      activityType: act.activityType || lead.activityType,
      date: act.date || lead.date,
      status: act.status || lead.status,
      priority: act.priority || lead.priority,
      comments,
      broker,
      lastTouch: act.date || lead.lastTouch,
      email: lead.email,
      phone: lead.phone,
    };
    updated.tier = prioritizeLead(updated);
    updated.channel = assignChannel(updated);
    return updated;
  });
}

export function enrichBrokersWithActivities(
  brokers: Broker[],
  activities: Record<string, ActivityRecord>
): Broker[] {
  return brokers.map((b) => {
    const key = normalizeContactKey(enrichBrokerName(b.firstName, b.lastName));
    const act = activities[key];
    if (!act) return b;
    const lastTouch = act.date || b.lastTouch;
    const notes = [b.notes, act.comments].filter(Boolean).join(' | ') || b.notes;
    return {
      ...b,
      lastTouch,
      notes,
      nextDue: computeNextDue(lastTouch, b.tier),
      status: computeStatus(lastTouch, b.tier),
    };
  });
}

export function enrichPartnersWithActivities(
  partners: Partner[],
  activities: Record<string, ActivityRecord>
): Partner[] {
  return partners.map((p) => {
    const key = normalizeContactKey(enrichBrokerName(p.firstName, p.lastName));
    const act = activities[key];
    if (!act) return p;
    const lastTouch = act.date || p.lastTouch;
    const notes = [p.notes, act.comments].filter(Boolean).join(' | ') || p.notes;
    return {
      ...p,
      lastTouch,
      notes,
      nextDue: computeNextDue(lastTouch, p.tier),
    };
  });
}
