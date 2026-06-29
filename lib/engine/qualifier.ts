// lib/engine/qualifier.ts
// Scores each signal against the Focus Studio ICP
// Routes to actionable queue or watchlist

import { findBrokerByFirmOrName, updateSignalStatus, addToWatchlist } from './db';

const NJ_KEYWORDS = [
  'parsippany', 'florham park', 'morris county', 'bergen county', 'essex county',
  'middlesex county', 'somerset county', 'union county', 'northern new jersey',
  'northern nj', 'new jersey', ' nj ', 'morristown', 'livingston', 'short hills',
  'hackensack', 'mahwah', 'wayne', 'clifton', 'fairfield', 'bridgewater',
  'iselin', 'piscataway', 'saddle brook', 'rutherford', 'montville'
];

const NYC_KEYWORDS = ['new york', ' ny ', 'manhattan', 'brooklyn', 'hoboken', 'jersey city'];

const TIER1_TYPES = ['funding_round', 'executive_hire', 'expansion_announcement', 'acquisition'];
const TIER3_TYPES = ['broker_deal_announced', 'broker_promotion', 'broker_firm_move', 'broker_award'];

const SCORE_KEYWORDS = [
  { words: ['series a', 'series b', 'series c', 'raised', 'million', 'funding'], score: 3 },
  { words: ['expansion', 'new office', 'new headquarters', 'relocat'], score: 2 },
  { words: ['hiring', 'headcount', 'growing team', 'new employees'], score: 2 },
  { words: ['executive', 'vp of', 'chief', 'coo', 'cfo', 'head of'], score: 2 },
  { words: ['broker', 'deal', 'lease', 'signed', 'transaction'], score: 2 },
];

function detectGeography(summary: string): 'northern_nj' | 'nyc_metro' | 'other' {
  const lower = summary.toLowerCase();
  for (const kw of NJ_KEYWORDS) { if (lower.includes(kw)) return 'northern_nj'; }
  for (const kw of NYC_KEYWORDS) { if (lower.includes(kw)) return 'nyc_metro'; }
  return 'other';
}

function scoreSignal(signal: any): { score: number; geography: string } {
  let score = 0;
  const geography = detectGeography(signal.summary);

  // Geography score
  if (geography === 'northern_nj') score += 4;
  else if (geography === 'nyc_metro') score += 2;

  // Tier score
  if (TIER1_TYPES.includes(signal.signal_type)) score += 4;
  else if (TIER3_TYPES.includes(signal.signal_type)) score += 3;
  else score += 2;

  // Content scoring
  const lower = (signal.summary || '').toLowerCase();
  for (const group of SCORE_KEYWORDS) {
    for (const word of group.words) {
      if (lower.includes(word)) { score += group.score; break; }
    }
  }

  return { score, geography };
}

export async function runQualifier(signals: any[]) {
  console.log(`[Qualifier] Scoring ${signals.length} signals...`);

  const actionable: any[] = [];
  const watchlist: any[] = [];

  for (const signal of signals) {
    try {
      const { score, geography } = scoreSignal(signal);
      signal.iq_score = score;
      signal.geography = geography;

      // Try to match to an existing broker
      if (signal.company_name) {
        const broker = await findBrokerByFirmOrName('', signal.company_name);
        if (broker) {
          signal.contact_id = broker.id;
          signal.contact_table = 'brokers';
          signal.contact_name = `${broker.first_name} ${broker.last_name}`;
        }
      }

      if (score >= 6) {
        await updateSignalStatus(signal.id, 'actionable', score);
        actionable.push(signal);
        console.log(`[Qualifier] ACTIONABLE (${score}): ${signal.company_name || 'unknown'}`);
      } else if (score >= 3) {
        const checkDate = new Date();
        checkDate.setDate(checkDate.getDate() + 30);
        await addToWatchlist({
          signal_id: signal.id,
          company_name: signal.company_name,
          contact_id: signal.contact_id,
          contact_table: signal.contact_table,
          reason: `Score ${score}. ${signal.signal_type} in ${geography}.`,
          check_date: checkDate.toISOString().split('T')[0]
        });
        await updateSignalStatus(signal.id, 'watchlist', score);
        watchlist.push(signal);
      } else {
        await updateSignalStatus(signal.id, 'dismissed', score);
      }
    } catch (err: any) {
      console.error('[Qualifier] Error:', err.message);
    }
  }

  console.log(`[Qualifier] ${actionable.length} actionable, ${watchlist.length} watchlist`);
  return { actionable, watchlist };
}
