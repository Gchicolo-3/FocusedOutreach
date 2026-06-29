// lib/engine/signal-scout.ts
// Scans Perplexity daily for broker and end-user signals
// Returns raw signal array to the orchestrator

import { saveSignal } from './db';

const PERPLEXITY_KEY = process.env.PERPLEXITY_API_KEY!;

const BROKER_QUERIES = [
  'commercial real estate broker deal signed lease Northern New Jersey office 2026',
  'CRE broker promoted new role firm Northern NJ Bergen County Morris County 2026',
  'NJBIZ ROI-NJ commercial real estate office lease transaction announced this week',
];

const END_USER_QUERIES = [
  'company Series A Series B funding announced New Jersey office expansion 2026',
  'company hiring growth expansion new office Northern New Jersey 2026',
  'New Jersey company relocation headquarters office move announced 2026',
];

const SIGNAL_TYPE_MAP: Record<string, string> = {
  'funding': 'funding_round',
  'raised': 'funding_round',
  'series': 'funding_round',
  'hired': 'executive_hire',
  'appoints': 'executive_hire',
  'expansion': 'expansion_announcement',
  'relocat': 'expansion_announcement',
  'lease': 'broker_deal_announced',
  'signed': 'broker_deal_announced',
  'promoted': 'broker_promotion',
  'joins': 'broker_firm_move',
  'award': 'broker_award',
  'acqui': 'acquisition',
};

function detectSignalType(text: string): string {
  const lower = text.toLowerCase();
  for (const [kw, type] of Object.entries(SIGNAL_TYPE_MAP)) {
    if (lower.includes(kw)) return type;
  }
  return 'other';
}

function detectTier(signalType: string): string {
  const tier1 = ['funding_round', 'executive_hire', 'expansion_announcement', 'acquisition'];
  const tier3 = ['broker_deal_announced', 'broker_promotion', 'broker_firm_move', 'broker_award'];
  if (tier1.includes(signalType)) return '1';
  if (tier3.includes(signalType)) return '3';
  return '2';
}

async function queryPerplexity(query: string): Promise<any[]> {
  try {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PERPLEXITY_KEY}`
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content: `You are a business intelligence scanner for a commercial real estate firm in Northern NJ.
Find real, specific, recent news from the last 30 days only.
Return ONLY a JSON array. No markdown. No explanation. No backticks.
Each item: { "company": string, "summary": string, "url": string, "source": string, "date": string }
If nothing relevant found, return: []`
          },
          { role: 'user', content: query }
        ],
        max_tokens: 600
      })
    });

    if (!res.ok) {
      console.error(`[SignalScout] Perplexity error ${res.status}`);
      return [];
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '[]';

    try {
      const clean = content.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      console.error('[SignalScout] Parse error:', content.substring(0, 100));
      return [];
    }
  } catch (err: any) {
    console.error('[SignalScout] Fetch error:', err.message);
    return [];
  }
}

export async function runSignalScout() {
  console.log('[SignalScout] Starting scan...');
  const allSignals: any[] = [];
  const allQueries = [...BROKER_QUERIES, ...END_USER_QUERIES];

  for (const query of allQueries) {
    const results = await queryPerplexity(query);

    for (const result of results) {
      if (!result.summary) continue;

      const signalType = detectSignalType(result.summary);
      const tier = detectTier(signalType);

      const saved = await saveSignal({
        signal_type: signalType,
        tier_recommendation: tier,
        company_name: result.company || null,
        summary: result.summary,
        source_url: result.url || null,
        source_name: result.source || 'Perplexity',
        signal_date: result.date || new Date().toISOString().split('T')[0]
      });

      if (saved) allSignals.push(saved);
    }

    // Small delay between queries to be respectful
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[SignalScout] Found ${allSignals.length} signals`);
  return allSignals;
}
