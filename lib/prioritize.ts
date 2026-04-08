import { Lead } from '@/types';

export function prioritizeLead(lead: Lead): 1 | 2 | 3 {
  const comments = (lead.comments || '').toLowerCase();
  const hasBrokerIntel =
    comments.includes('intro') ||
    comments.includes('mentioned') ||
    comments.includes('intel from') ||
    !!lead.broker;
  const hasOldOrNoDate = !lead.date || daysSince(lead.date) > 14;

  if (hasBrokerIntel && hasOldOrNoDate) return 1;
  if (hasBrokerIntel) return 1;

  const touched = !!lead.date && daysSince(lead.date) < 365;
  const stale = lead.date && daysSince(lead.date) >= 7;
  const activeIntel =
    comments.includes('space search') ||
    comments.includes('looking') ||
    comments.includes('active');

  if (touched && stale && activeIntel) return 2;
  if (touched && stale) return 2;

  return 3;
}

export function assignChannel(lead: Lead): Lead['channel'] {
  const type = (lead.activityType || '').toLowerCase();
  if (type.includes('call')) return 'call';
  if (type.includes('text') || type.includes('sms')) return 'text';
  if (type.includes('email')) return 'email';
  if (type.includes('linkedin')) return 'linkedin';

  // Default based on tier
  if (lead.tier === 1) return 'call';
  if (lead.tier === 2) return 'text';
  return 'email';
}

export function daysSince(dateStr: string): number {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 999;
  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

export function selectDaily5(
  leads: Lead[],
  doneIds: Set<string>,
  snoozedIds: Set<string>,
  brokerNames: string[]
): Lead[] {
  const available = leads.filter(
    (l) => !doneIds.has(l.id) && !snoozedIds.has(l.id)
  );

  const tier1 = available.filter((l) => l.tier === 1);
  const tier2 = available.filter((l) => l.tier === 2);
  const tier3 = available.filter((l) => l.tier === 3);

  // Sort within tiers: broker intel first, then by date staleness
  const sortByPriority = (a: Lead, b: Lead) => {
    if (a.broker && !b.broker) return -1;
    if (!a.broker && b.broker) return 1;
    return daysSince(a.date) - daysSince(b.date);
  };

  tier1.sort(sortByPriority);
  tier2.sort(sortByPriority);
  tier3.sort(sortByPriority);

  const selected: Lead[] = [];

  // Pick 2-3 from Tier 1 (broker intel leads)
  const t1Count = Math.min(tier1.length, 3);
  for (let i = 0; i < t1Count && selected.length < 3; i++) {
    selected.push(tier1[i]);
  }

  // Pick 1-2 from Tier 2
  const t2Count = Math.min(tier2.length, 2);
  for (let i = 0; i < t2Count && selected.length < 4; i++) {
    selected.push(tier2[i]);
  }

  // Fill remaining from Tier 3
  for (let i = 0; i < tier3.length && selected.length < 5; i++) {
    selected.push(tier3[i]);
  }

  // If still under 5, fill from any remaining
  const remaining = available.filter((l) => !selected.includes(l));
  for (let i = 0; i < remaining.length && selected.length < 5; i++) {
    selected.push(remaining[i]);
  }

  return selected.slice(0, 5);
}
