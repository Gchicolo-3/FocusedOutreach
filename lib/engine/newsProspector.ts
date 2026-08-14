// lib/engine/newsProspector.ts
// Focus Studio Pipeline Engine
// Second signal source, runs alongside ZoomInfo. Uses Claude's web search
// tool to scan the same local/trade sources that already produced real
// signals in this table before a cron ever existed (NJBIZ, ROI-NJ, CoStar,
// Choose New Jersey). Needs no new credentials, rides on the
// ANTHROPIC_API_KEY this app already uses for drafting.

import { saveSignal } from './db';

const SOURCES = ['NJBIZ', 'ROI-NJ', 'CoStar', 'Choose New Jersey'];

const SIGNAL_TYPES = [
  'funding_round', 'executive_hire', 'expansion_announcement', 'acquisition',
  'broker_deal_announced', 'broker_promotion', 'broker_firm_move', 'broker_award',
  'other'
];

// Hard time limits so a slow/hung Claude call degrades to zero news signals
// instead of starving the whole 300s pipeline run (cadence, copywriter,
// digest all come after this step). First live run stalled >280s here.
const RESEARCH_TIMEOUT_MS = 120_000;
const STRUCTURE_TIMEOUT_MS = 60_000;

async function researchStep(): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(RESEARCH_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
      messages: [{
        role: 'user',
        content: `Search ${SOURCES.join(', ')} for news from the last 3 days about companies in Northern New Jersey or NYC metro that signal a need for new office space: funding rounds, expansions, new offices, executive hires, hiring surges, acquisitions, or commercial real estate broker deals/promotions in the tri-state area. For each item found, note the company name, a one to two sentence summary, the type of signal, the source URL, and the date. List every item you find, even minor ones.`
      }]
    })
  });

  if (!res.ok) throw new Error(`Claude research call failed: ${res.status}`);
  const data = await res.json();
  return data.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n');
}

async function structureStep(researchText: string): Promise<any[]> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(STRUCTURE_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `Convert these research notes into a JSON array. Each item: {"company_name": string, "summary": string, "signal_type": one of ${JSON.stringify(SIGNAL_TYPES)}, "source_url": string, "source_name": one of ${JSON.stringify(SOURCES)}, "signal_date": "YYYY-MM-DD"}. Respond with ONLY the JSON array, nothing else, no markdown fences. If nothing usable, respond with [].\n\nResearch notes:\n${researchText}`
      }]
    })
  });

  if (!res.ok) throw new Error(`Claude structure call failed: ${res.status}`);
  const data = await res.json();
  const text = (data.content?.[0]?.text || '[]').replace(/```json|```/g, '').trim();
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.error('[NewsProspector] JSON parse failed:', text.slice(0, 300));
    return [];
  }
}

// The signals table check constraint only accepts '1' | '2' | '3'.
// Broker-news types get '3' to match the tiering already in the table.
function tierFor(signalType: string): string {
  const tier1 = ['funding_round', 'executive_hire', 'expansion_announcement', 'acquisition'];
  if (tier1.includes(signalType)) return '1';
  if (signalType.startsWith('broker_')) return '3';
  return '2';
}

export async function runNewsProspector(): Promise<any[]> {
  console.log('[NewsProspector] Researching...');
  let items: any[] = [];
  try {
    const researchText = await researchStep();
    items = await structureStep(researchText);
  } catch (err: any) {
    console.error('[NewsProspector] Failed:', err.message);
    return [];
  }

  console.log(`[NewsProspector] ${items.length} candidate signals`);

  const saved: any[] = [];
  for (const item of items) {
    if (!item.company_name || !item.summary) continue;
    const signalType = SIGNAL_TYPES.includes(item.signal_type) ? item.signal_type : 'other';
    const row = await saveSignal({
      signal_type: signalType,
      tier_recommendation: tierFor(signalType),
      company_name: item.company_name,
      summary: item.summary,
      source_url: item.source_url,
      source_name: item.source_name || 'News Scan',
      signal_date: item.signal_date,
    });
    if (row) saved.push(row);
  }

  console.log(`[NewsProspector] ${saved.length} signals saved`);
  return saved;
}
