// Canonical contact identity: one deterministic key per human, and one
// resolution function that everything (imports, backfills, draft generation)
// uses to answer "which contact record is this name/company/email?".
//
// The four contact tables (brokers, partners, prospects, cold_brokers) stay
// separate — they encode workflow stage and drive cadence/templates — but
// every row carries a shared `canonical_key`, and activities rows carry the
// resolved (contact_table, contact_id) so history joins to real contacts
// instead of dangling on slugified names.
//
// This module is dependency-free on purpose: it runs in the browser, in API
// routes, and under plain `node --experimental-strip-types` for backfills.

export type ContactTable = 'brokers' | 'partners' | 'prospects' | 'cold_brokers';

export type ContactRef = {
  table: ContactTable;
  id: string;
  name: string;      // display name as stored
  company: string;   // firm/company as stored
  email?: string | null;
};

export type MatchStatus = 'matched' | 'ambiguous' | 'new' | 'junk';

export type ResolveResult = {
  status: MatchStatus;
  // Set when status === 'matched'
  match?: ContactRef;
  // Set when status === 'ambiguous': every plausible target
  candidates?: ContactRef[];
  method?: string;
  confidence?: number;
};

// ============ NORMALIZATION ============

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Honorifics and credentials that vary between data sources for the same
// person ("Dr. Ibrar Ahmed" vs "Ibrar Ahmed", "John Smith Jr., CCIM").
const NAME_NOISE = new Set([
  'mr', 'mrs', 'ms', 'dr', 'jr', 'sr', 'ii', 'iii', 'iv',
  'cpa', 'esq', 'ccim', 'sior', 'mba', 'jd', 'pe', 'aia',
]);

// Legal suffixes that make the same company read differently across sources
// ("Dynarex" vs "Dynarex Corp", "T-Mobile USA, Inc.").
const COMPANY_NOISE = new Set([
  'inc', 'incorporated', 'llc', 'llp', 'lp', 'ltd', 'pc', 'pa',
  'corp', 'corporation', 'co', 'company', 'the',
]);

function tokenize(s: string): string[] {
  return stripDiacritics(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function nameTokens(name: string): string[] {
  return tokenize(name).filter((t) => !NAME_NOISE.has(t));
}

// Lowercased alphanumeric name key: "Joe  DeVries" -> "joedevries".
// Matches the existing activities.contact_key slug scheme so old keys remain
// comparable.
export function nameKey(name: string): string {
  return nameTokens(name).join('');
}

export function companyTokens(company: string): string[] {
  return tokenize(company).filter((t) => !COMPANY_NOISE.has(t));
}

export function companyKey(company: string): string {
  return companyTokens(company).join('');
}

// Deterministic canonical key from name + company. Same inputs always produce
// the same key, so independently imported rows for the same person collide
// (which is the point). "~" can't appear in either side's slug.
export function canonicalKey(name: string, company: string): string {
  const n = nameKey(name);
  const c = companyKey(company);
  if (!n) return '';
  return c ? `${n}~${c}` : n;
}

// ============ NAME VARIANTS ============

// Common first-name equivalences seen in this data set (Salesforce exports
// use formal names; email signatures use short ones). Grouped, not mapped, so
// matching works in both directions.
const NICKNAME_GROUPS: string[][] = [
  ['joe', 'joseph', 'joey'],
  ['mike', 'michael'],
  ['bob', 'robert', 'rob', 'bobby'],
  ['bill', 'william', 'will', 'billy'],
  ['jim', 'james', 'jimmy'],
  ['tom', 'thomas', 'tommy'],
  ['dave', 'david'],
  ['dan', 'daniel', 'danny'],
  ['chris', 'christopher'],
  ['matt', 'matthew'],
  ['tony', 'anthony'],
  ['steve', 'steven', 'stephen'],
  ['rich', 'richard', 'rick', 'dick'],
  ['ed', 'edward', 'eddie', 'ted'],
  ['andy', 'andrew', 'drew'],
  ['nick', 'nicholas'],
  ['alex', 'alexander', 'alexandra'],
  ['ben', 'benjamin'],
  ['sam', 'samuel', 'samantha'],
  ['ken', 'kenneth', 'kenny'],
  ['greg', 'gregory'],
  ['jeff', 'jeffrey', 'jeffery'],
  ['pete', 'peter'],
  ['pat', 'patrick', 'patricia'],
  ['kate', 'katherine', 'kathryn', 'katie', 'kathy', 'catherine'],
  ['liz', 'elizabeth', 'beth', 'lizzie'],
  ['jen', 'jennifer', 'jenny'],
  ['jess', 'jessica'],
  ['meg', 'megan', 'meghan'],
  ['tim', 'timothy'],
  ['ron', 'ronald', 'ronnie'],
  ['don', 'donald'],
  ['frank', 'francis', 'frankie'],
  ['larry', 'lawrence'],
  ['jerry', 'gerald'],
  ['ray', 'raymond'],
  ['vinny', 'vincent', 'vince'],
  ['sal', 'salvatore'],
  ['gabe', 'gabriel'],
  ['zach', 'zachary', 'zack'],
  ['josh', 'joshua'],
  ['brad', 'bradley'],
  ['doug', 'douglas'],
  ['stan', 'stanley'],
  ['fred', 'frederick'],
  ['abe', 'abraham'],
  ['manny', 'manuel', 'emanuel'],
  ['max', 'maxwell', 'maximilian'],
];

const NICKNAME_INDEX = new Map<string, string[]>();
for (const group of NICKNAME_GROUPS) {
  for (const n of group) NICKNAME_INDEX.set(n, group);
}

// Extract a quoted or parenthesized nickname: Vyacheslav "Slava" Zborovsky.
function extractInlineNickname(name: string): string | null {
  const m = (name || '').match(/["“”'(]([A-Za-z]{2,})[")”'’)]/);
  return m ? m[1].toLowerCase() : null;
}

// Every name key this person might appear under: full name, first+last with
// middles dropped, nickname swaps, inline-nickname swaps.
export function nameVariantKeys(name: string): Set<string> {
  const variants = new Set<string>();
  const inline = extractInlineNickname(name);
  const tokens = nameTokens(name);
  if (tokens.length === 0) return variants;

  const add = (parts: string[]) => {
    const key = parts.join('');
    if (key) variants.add(key);
  };

  add(tokens);
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  if (tokens.length > 2) add([first, last]);

  const firstNames = new Set<string>(NICKNAME_INDEX.get(first) || [first]);
  if (inline) firstNames.add(inline);
  for (const f of firstNames) {
    if (tokens.length >= 2) add([f, last]);
  }
  return variants;
}

// ============ JUNK DETECTION ============

// The activities table was populated by slugifying whatever landed in the
// name column of a Salesforce export — including quoted-email fragments,
// street addresses, and sentence shards. These are not contacts and must
// never resolve to one.
const STOPWORDS = new Set([
  'and', 'or', 'the', 'to', 'for', 'with', 'your', 'you', 'we', 'our',
  'is', 'are', 'of', 'on', 'at', 'in', 'if', 'it', 'this', 'that',
]);

export function looksLikeJunkName(name: string): boolean {
  const raw = (name || '').trim();
  if (!raw) return true;
  if (/[@<>]/.test(raw)) return true;                     // email fragments
  if (/wrote:|http|www\.|unsubscribe|forwarded/i.test(raw)) return true;
  if (/\d\d/.test(raw)) return true;                      // dates, zips, phones
  if (raw.length > 40) return true;
  if (!/[a-zA-Z]/.test(raw)) return true;
  const tokens = tokenize(raw);
  if (tokens.length > 4) return true;                     // sentence shards
  if (tokens.some((t) => STOPWORDS.has(t))) return true;
  if (/^[a-z]/.test(raw) && tokens.length > 1) return true; // mid-sentence fragments
  if (tokens.length === 1 && tokens[0].length < 3) return true;
  return false;
}

// ============ CONTACT INDEX + RESOLUTION ============

export type ContactIndex = {
  byEmail: Map<string, ContactRef[]>;
  byNameVariant: Map<string, ContactRef[]>;
  byLastCompany: Map<string, ContactRef[]>;
  all: ContactRef[];
};

function push<K>(map: Map<K, ContactRef[]>, key: K, ref: ContactRef) {
  const list = map.get(key);
  if (list) {
    if (!list.some((r) => r.table === ref.table && r.id === ref.id)) list.push(ref);
  } else {
    map.set(key, [ref]);
  }
}

export function buildContactIndex(contacts: ContactRef[]): ContactIndex {
  const index: ContactIndex = {
    byEmail: new Map(),
    byNameVariant: new Map(),
    byLastCompany: new Map(),
    all: contacts,
  };
  for (const c of contacts) {
    const email = (c.email || '').trim().toLowerCase();
    if (email && email.includes('@')) push(index.byEmail, email, c);

    for (const v of nameVariantKeys(c.name)) push(index.byNameVariant, v, c);

    const tokens = nameTokens(c.name);
    const last = tokens[tokens.length - 1];
    const ck = companyKey(c.company);
    if (tokens.length >= 2 && last && last.length >= 3 && ck) {
      push(index.byLastCompany, `${last}~${ck}`, c);
    }
  }
  return index;
}

// Companies match when their normalized keys are equal, one contains the
// other ("CBRE" / "CBRE Investment Management"), or they share a significant
// token ("NAI James E. Hanson" / "NAI Hanson").
export function companiesCompatible(a: string, b: string): boolean {
  const ka = companyKey(a);
  const kb = companyKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  if (ka.includes(kb) || kb.includes(ka)) return true;
  const ta = new Set(companyTokens(a));
  for (const t of companyTokens(b)) {
    if (t.length >= 4 && ta.has(t)) return true;
  }
  return false;
}

function dedupe(refs: ContactRef[]): ContactRef[] {
  const seen = new Set<string>();
  const out: ContactRef[] = [];
  for (const r of refs) {
    const k = `${r.table}:${r.id}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(r);
    }
  }
  return out;
}

// Resolve an inbound name/company/email against existing contacts.
// Ladder, most to least confident:
//   1. exact email            -> matched (1.0)
//   2. name variant + company -> matched if unique (0.95), else ambiguous
//   3. name variant, unique across all tables -> matched (0.85)
//      name variant, multiple contacts       -> ambiguous
//   4. last name + company, unique -> matched (0.7), multiple -> ambiguous
//   5. nothing -> 'new' (or 'junk' when the name isn't a person)
export function resolveContact(
  index: ContactIndex,
  input: { name: string; company?: string | null; email?: string | null }
): ResolveResult {
  const email = (input.email || '').trim().toLowerCase();
  if (email && email.includes('@')) {
    const hits = index.byEmail.get(email);
    if (hits && hits.length === 1) {
      return { status: 'matched', match: hits[0], method: 'email', confidence: 1 };
    }
    if (hits && hits.length > 1) {
      return { status: 'ambiguous', candidates: dedupe(hits), method: 'email_multiple' };
    }
  }

  if (looksLikeJunkName(input.name)) return { status: 'junk' };

  const variants = nameVariantKeys(input.name);
  const nameHits: ContactRef[] = [];
  for (const v of variants) {
    for (const ref of index.byNameVariant.get(v) || []) nameHits.push(ref);
  }
  const uniqueNameHits = dedupe(nameHits);

  const company = input.company || '';
  if (uniqueNameHits.length > 0 && company) {
    const companyHits = uniqueNameHits.filter((r) => companiesCompatible(company, r.company));
    if (companyHits.length === 1) {
      return { status: 'matched', match: companyHits[0], method: 'name_company', confidence: 0.95 };
    }
    if (companyHits.length > 1) {
      return { status: 'ambiguous', candidates: companyHits, method: 'name_company_multiple' };
    }
  }

  if (uniqueNameHits.length === 1) {
    return { status: 'matched', match: uniqueNameHits[0], method: 'name_unique', confidence: 0.85 };
  }
  if (uniqueNameHits.length > 1) {
    return { status: 'ambiguous', candidates: uniqueNameHits, method: 'name_multiple' };
  }

  const tokens = nameTokens(input.name);
  const last = tokens[tokens.length - 1];
  const ck = companyKey(company);
  if (tokens.length >= 2 && last && last.length >= 3 && ck) {
    const hits = dedupe(index.byLastCompany.get(`${last}~${ck}`) || []);
    if (hits.length === 1) {
      return { status: 'matched', match: hits[0], method: 'last_name_company', confidence: 0.7 };
    }
    if (hits.length > 1) {
      return { status: 'ambiguous', candidates: hits, method: 'last_name_company_multiple' };
    }
  }

  // Single-token "names" that matched nothing aren't worth creating contacts
  // for — there's no way to know who "Jessica" is.
  if (tokens.length < 2) return { status: 'junk' };

  return { status: 'new' };
}

// ============ ROW ADAPTERS ============

// Shape rows from each contact table into ContactRefs without the callers
// having to know per-table column names.
type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function contactRefFromRow(table: ContactTable, row: Row): ContactRef {
  if (table === 'brokers') {
    return {
      table, id: str(row.id),
      name: `${str(row.first_name)} ${str(row.last_name)}`.trim(),
      company: str(row.firm), email: str(row.email) || null,
    };
  }
  if (table === 'partners') {
    return {
      table, id: str(row.id),
      name: `${str(row.first_name)} ${str(row.last_name)}`.trim(),
      company: str(row.company), email: str(row.email) || null,
    };
  }
  if (table === 'prospects') {
    return {
      table, id: str(row.id),
      name: str(row.contact),
      company: str(row.company), email: str(row.email) || null,
    };
  }
  return {
    table, id: str(row.id),
    name: str(row.name),
    company: str(row.firm), email: str(row.email) || null,
  };
}

export function canonicalKeyForRow(table: ContactTable, row: Row): string {
  const ref = contactRefFromRow(table, row);
  return canonicalKey(ref.name, ref.company);
}
