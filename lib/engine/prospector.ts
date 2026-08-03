// lib/engine/prospector.ts
// Focus Studio Pipeline Engine
// Finds new-business signals via the ZoomInfo API (Search Scoops) and hands
// raw signal rows to the qualifier. This is the step that was ripped out
// when the Perplexity scout stopped working and never got replaced.
//
// Auth: ZoomInfo issues a JWT from username/password, valid ~1hr.
// Needs ZOOMINFO_USERNAME and ZOOMINFO_PASSWORD as Vercel env vars.

import { saveSignal } from './db';

const ZI_BASE = 'https://api.zoominfo.com';

const TARGET_STATES = 'nj,ny,ct';

const SCOOP_TYPE_MAP: Record<string, string> = {
  'Facilities Relocation / Expansion': 'expansion_announcement',
  'Funding': 'funding_round',
  'Mergers & Acquisitions (M&A)': 'acquisition',
  'Executive Move': 'executive_hire',
  'New Hire': 'executive_hire',
  'Management Move': 'executive_hire',
  'Hiring Plans': 'expansion_announcement',
};

const SCOOP_TYPES = Object.keys(SCOOP_TYPE_MAP);

let cachedToken: { jwt: string; expires: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now()) return cachedToken.jwt;

  const username = process.env.ZOOMINFO_USERNAME;
  const password = process.env.ZOOMINFO_PASSWORD;
  if (!username || !password) {
    throw new Error('ZOOMINFO_USERNAME / ZOOMINFO_PASSWORD not set');
  }

  const res = await fetch(`${ZI_BASE}/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    throw new Error(`ZoomInfo auth failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  cachedToken = { jwt: data.jwt, expires: Date.now() + 55 * 60 * 1000 };
  return cachedToken.jwt;
}

async function ziPost(path: string, body: any): Promise<any> {
  const jwt = await getToken();
  const res = await fetch(`${ZI_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`ZoomInfo ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

function tierFor(signalType: string): string {
  const tier1 = ['funding_round', 'executive_hire', 'expansion_announcement', 'acquisition'];
  return tier1.includes(signalType) ? 'tier_1' : 'tier_2';
}

function extractScoops(result: any): any[] {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.scoops)) return result.scoops;
  return [];
}

export async function runProspector(lookbackDays = 2): Promise<any[]> {
  console.log('[Prospector] Searching ZoomInfo scoops...');

  const publishedStartDate = new Date();
  publishedStartDate.setDate(publishedStartDate.getDate() - lookbackDays);
  const startDateStr = publishedStartDate.toISOString().split('T')[0];

  let rawResult: any;
  try {
    rawResult = await ziPost('/search/scoops', {
      state: TARGET_STATES,
      scoopTypes: SCOOP_TYPES,
      publishedStartDate: startDateStr,
      rpp: 50,
    });
  } catch (err: any) {
    console.error('[Prospector] ZoomInfo search failed:', err.message);
    return [];
  }

  const scoops = extractScoops(rawResult);
  console.log(`[Prospector] ${scoops.length} scoops returned`);
  if (scoops[0]) console.log('[Prospector] sample scoop shape:', JSON.stringify(scoops[0]).slice(0, 500));

  const saved: any[] = [];
  for (const scoop of scoops) {
    const scoopType = scoop.scoopType || scoop.type;
    const signalType = SCOOP_TYPE_MAP[scoopType] || 'other';
    const companyName = scoop.companyName || scoop.company?.name || scoop.company_name;
    const summary = scoop.description || scoop.title || scoop.summary;
    if (!companyName || !summary) continue;

    const row = await saveSignal({
      signal_type: signalType,
      tier_recommendation: tierFor(signalType),
      company_name: companyName,
      summary,
      source_url: scoop.link || scoop.url,
      source_name: 'ZoomInfo Scoops',
      signal_date: scoop.originalPublishedDate || scoop.publishedDate,
    });

    if (row) saved.push(row);
  }

  console.log(`[Prospector] ${saved.length} signals saved`);
  return saved;
}
