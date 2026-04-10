import { RelationshipTier } from '@/types';

export const CADENCE_DAYS: Record<RelationshipTier, number> = {
  A: 14,
  B: 28,
  C: 45,
};

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
