// lib/engine/recencyGuard.ts
// Decides, per cadence-due contact, whether the engine may draft at all and
// which template it must use — so a contact called yesterday never gets an
// "it's been a while" check-in again.
//
// The windows (set with George, 2026-08-17):
//   Established relationship (met / spoke / has given deals or referrals):
//     - touched within 14 days           -> suppress, no draft
//     - touched 14-30 days ago           -> draft as FOLLOW-UP (continuation
//                                           tone referencing the recent touch,
//                                           never "been a while")
//     - 30+ days of silence (or never)   -> normal check-in template
//   Never actually connected (no two-way contact on record):
//     - touched within 14 days           -> suppress
//     - fewer than 3 outreach attempts   -> draft as COLD INTRO, attempt #N
//     - 3+ attempts, still no response   -> park in the monthly_outreach
//                                           bucket; one cold touch per 30
//                                           days until they respond or a
//                                           meeting happens
//   Parked (monthly_outreach bucket):
//     - engagement evidence appeared     -> restore to active
//     - last touch 30+ days ago          -> one monthly cold touch
//     - otherwise                        -> stay quiet

import type { TouchEvidence } from './db';

export const ENGAGED_SUPPRESS_DAYS = 14;
export const LAPSED_SILENCE_DAYS = 30;
export const COLD_SUPPRESS_DAYS = 14;
export const COLD_MAX_TOUCHPOINTS = 3;
export const MONTHLY_INTERVAL_DAYS = 30;

export type DraftTemplate = 'follow_up' | 'check_in' | 'cold_intro';

export type GuardDecision =
  | { action: 'suppress'; reason: string }
  | { action: 'park'; reason: string }      // move to monthly_outreach bucket
  | { action: 'restore'; reason: string }   // move back to active bucket
  | {
      action: 'draft';
      template: DraftTemplate;
      lastTouch: string | null;
      lastTouchKind: string | null;
      daysSinceTouch: number | null;
      attemptNumber?: number;               // cold intro: which of the 3
    };

export type GuardContact = {
  // Relationship evidence carried on the contact row itself.
  tier?: string | null;
  deal_count?: number | null;
  referral_count?: number | null;
  bucket?: string | null;
};

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (isNaN(from) || isNaN(to)) return Number.MAX_SAFE_INTEGER;
  return Math.floor((to - from) / 86400000);
}

// A relationship exists when there's any two-way evidence: a logged
// conversation/meeting, deals given, referrals given, or a manually assigned
// A tier (A is only ever set for people George actually knows).
export function isEngaged(contact: GuardContact, evidence: TouchEvidence | undefined): boolean {
  if ((contact.deal_count || 0) > 0) return true;
  if ((contact.referral_count || 0) > 0) return true;
  if (contact.tier === 'A') return true;
  return !!evidence?.spoke;
}

export function decideTouch(
  contact: GuardContact,
  evidence: TouchEvidence | undefined,
  todayIso: string
): GuardDecision {
  const lastTouch = evidence?.lastTouch || null;
  const lastTouchKind = evidence?.lastTouchKind || null;
  const days = lastTouch ? daysBetween(lastTouch, todayIso) : null;
  const engaged = isEngaged(contact, evidence);
  const parked = contact.bucket === 'monthly_outreach';

  if (parked) {
    if (engaged) {
      return { action: 'restore', reason: 'engagement evidence found — back to active cadence' };
    }
    if (days === null || days >= MONTHLY_INTERVAL_DAYS) {
      return {
        action: 'draft', template: 'cold_intro',
        lastTouch, lastTouchKind, daysSinceTouch: days,
        attemptNumber: (evidence?.outboundCount || 0) + 1,
      };
    }
    return { action: 'suppress', reason: `monthly bucket, touched ${days}d ago` };
  }

  if (engaged) {
    if (days !== null && days < ENGAGED_SUPPRESS_DAYS) {
      return { action: 'suppress', reason: `touched ${days}d ago (${lastTouchKind})` };
    }
    if (days !== null && days < LAPSED_SILENCE_DAYS) {
      return {
        action: 'draft', template: 'follow_up',
        lastTouch, lastTouchKind, daysSinceTouch: days,
      };
    }
    return {
      action: 'draft', template: 'check_in',
      lastTouch, lastTouchKind, daysSinceTouch: days,
    };
  }

  // Never actually connected.
  if (days !== null && days < COLD_SUPPRESS_DAYS) {
    return { action: 'suppress', reason: `cold, touched ${days}d ago (${lastTouchKind})` };
  }
  const attempts = evidence?.outboundCount || 0;
  if (attempts >= COLD_MAX_TOUCHPOINTS) {
    return {
      action: 'park',
      reason: `${attempts} outreach attempts with no response — parking for monthly outreach`,
    };
  }
  return {
    action: 'draft', template: 'cold_intro',
    lastTouch, lastTouchKind, daysSinceTouch: days,
    attemptNumber: attempts + 1,
  };
}
