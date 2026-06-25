import { RelationshipTier, TaskSource } from '@/types';

export const CADENCE_DAYS: Record<RelationshipTier, number> = {
  A: 14,
  B: 28,
  C: 45,
};

// Quick Log follow-up cadence. "spoke" = reached them; "NA" = no answer.
// Days are taken straight from George's cadence sheet.
const QUICK_LOG_CADENCE = {
  brokerGrade: {
    A: { spoke: 14, na: 7 },
    B: { spoke: 90, na: 45 },
    C: { spoke: 180, na: 90 },
  },
  prospectTier: {
    1: { spoke: 7, na: 3 },
    2: { spoke: 30, na: 14 },
    3: { spoke: 90, na: 45 },
  },
  // Referral partner: active (A) / warm (B) / dormant (C). Same whether or not reached.
  partnerTier: {
    A: { spoke: 30, na: 30 },
    B: { spoke: 60, na: 60 },
    C: { spoke: 90, na: 90 },
  },
  coldBroker: { spoke: 14, na: 7 },
} as const;

// Returns the number of days until the next follow up should happen.
export function quickLogDays(opts: {
  source: TaskSource;
  spoke: boolean;
  grade?: RelationshipTier;
  leadTier?: 1 | 2 | 3;
}): number {
  const { source, spoke, grade, leadTier } = opts;
  const key = spoke ? 'spoke' : 'na';
  if (source === 'broker') return QUICK_LOG_CADENCE.brokerGrade[grade || 'B'][key];
  if (source === 'partner') return QUICK_LOG_CADENCE.partnerTier[grade || 'B'][key];
  if (source === 'cold_broker') return QUICK_LOG_CADENCE.coldBroker[key];
  return QUICK_LOG_CADENCE.prospectTier[leadTier || 3][key];
}

// Today + N days, as an ISO yyyy-mm-dd string.
export function addDaysISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// Color band for "days since last touch": green <14, yellow 14-30, red >30.
export function touchColor(days: number): 'green' | 'yellow' | 'red' {
  if (days <= 13) return 'green';
  if (days <= 30) return 'yellow';
  return 'red';
}

export function daysSince(dateStr: string): number {
  if (!dateStr) return 9999;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 9999;
  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

export function daysUntil(dateStr: string): number {
  if (!dateStr) return -9999;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return -9999;
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function computeNextDue(lastTouch: string, tier: RelationshipTier): string {
  if (!lastTouch) return new Date().toISOString().split('T')[0];
  const d = new Date(lastTouch);
  if (isNaN(d.getTime())) return new Date().toISOString().split('T')[0];
  d.setDate(d.getDate() + CADENCE_DAYS[tier]);
  return d.toISOString().split('T')[0];
}

export function computeStatus(
  lastTouch: string,
  tier: RelationshipTier
): 'overdue' | 'due_soon' | 'on_track' {
  if (!lastTouch) return 'overdue';
  const days = daysSince(lastTouch);
  const cadence = CADENCE_DAYS[tier];
  if (days > cadence) return 'overdue';
  if (days > cadence - 7) return 'due_soon';
  return 'on_track';
}

export function defaultTierForBroker(dealCount: number): RelationshipTier {
  if (dealCount >= 2) return 'A';
  return 'B';
}

export function defaultTierForPartner(partnerType: string): RelationshipTier {
  if (partnerType === 'attorney' || partnerType === 'accountant') return 'C';
  return 'B';
}
