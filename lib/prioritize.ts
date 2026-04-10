import { Lead, Broker, Partner, ColdBroker, DailyTask } from '@/types';
import { computeStatus, daysSince } from './cadence';
import { getLeadMessage, getBrokerNurtureText, getPartnerNurtureText, getColdBrokerIntro } from './messages';

export function prioritizeLead(lead: Lead): 1 | 2 | 3 {
  const comments = (lead.comments || '').toLowerCase();
  const hasBrokerIntel =
    comments.includes('intro') ||
    comments.includes('mentioned') ||
    comments.includes('intel from') ||
    !!lead.broker;

  if (hasBrokerIntel) return 1;

  const touched = !!lead.date && daysSince(lead.date) < 365;
  const stale = !!lead.date && daysSince(lead.date) >= 7;

  if (touched && stale) return 2;

  return 3;
}

export function assignChannel(lead: Lead): Lead['channel'] {
  const type = (lead.activityType || '').toLowerCase();
  if (type.includes('call')) return 'call';
  if (type.includes('text') || type.includes('sms')) return 'text';
  if (type.includes('email')) return 'email';
  if (type.includes('linkedin')) return 'linkedin';

  if (lead.tier === 1) return 'call';
  if (lead.tier === 2) return 'text';
  return 'email';
}

type ScoredContact = {
  task: DailyTask;
  score: number;
  sourceType: 'broker' | 'partner' | 'prospect' | 'cold_broker';
};

export function selectDaily5(
  prospects: Lead[],
  brokers: Broker[],
  partners: Partner[],
  coldBrokers: ColdBroker[],
  doneIds: Set<string>,
  snoozedIds: Set<string>
): DailyTask[] {
  const scored: ScoredContact[] = [];

  // Brokers
  for (const b of brokers) {
    if (doneIds.has(b.id) || snoozedIds.has(b.id)) continue;
    const status = computeStatus(b.lastTouch, b.tier);
    let score = 0;
    let label = '';

    if (b.tier === 'A' && status === 'overdue') {
      score = 100;
      label = 'Tier A Overdue';
    } else if (b.tier === 'A' && status === 'due_soon') {
      score = 90;
      label = 'Tier A Due Soon';
    } else if (b.tier === 'B' && status === 'overdue') {
      score = 75;
      label = 'Tier B Overdue';
    } else if (b.tier === 'B' && status === 'due_soon') {
      score = 50;
      label = 'Tier B Due Soon';
    } else if (b.tier === 'C' && status === 'overdue') {
      score = 45;
      label = 'Tier C Overdue';
    } else {
      continue;
    }

    scored.push({
      sourceType: 'broker',
      score,
      task: {
        id: b.id,
        score,
        source: 'broker',
        label,
        name: `${b.firstName} ${b.lastName}`,
        company: b.firm,
        channel: 'text',
        tier: b.tier,
        context: `${b.dealCount} deals • Last touch: ${b.lastTouch || 'Never'}`,
        message: getBrokerNurtureText(b),
      },
    });
  }

  // Prospects
  for (const p of prospects) {
    if (doneIds.has(p.id) || snoozedIds.has(p.id)) continue;
    let score = 0;
    let label = '';

    if (p.tier === 1 && p.broker) {
      score = 85;
      label = 'Broker Intel';
    } else if (p.tier === 2) {
      score = 60;
      label = 'Warm Prospect';
    } else if (p.tier === 3) {
      score = 30;
      label = 'Cold Pipeline';
    } else {
      score = 40;
      label = 'Prospect';
    }

    scored.push({
      sourceType: 'prospect',
      score,
      task: {
        id: p.id,
        score,
        source: 'prospect',
        label,
        name: p.contact,
        company: p.company,
        channel: p.channel,
        leadTier: p.tier,
        context: p.comments || p.subject || '',
        message: getLeadMessage(p),
      },
    });
  }

  // Partners
  for (const p of partners) {
    if (doneIds.has(p.id) || snoozedIds.has(p.id)) continue;
    const status = computeStatus(p.lastTouch, p.tier);
    let score = 0;
    let label = '';

    if (p.tier === 'A' && status === 'overdue') {
      score = 80;
      label = 'Partner Tier A Overdue';
    } else if (p.tier === 'B' && status === 'overdue') {
      score = 58;
      label = 'Partner Tier B Overdue';
    } else if (p.tier === 'B' && status === 'due_soon') {
      score = 55;
      label = 'Partner Tier B Due Soon';
    } else if (p.tier === 'C' && status === 'overdue') {
      score = 40;
      label = 'Partner Tier C Overdue';
    } else {
      continue;
    }

    scored.push({
      sourceType: 'partner',
      score,
      task: {
        id: p.id,
        score,
        source: 'partner',
        label,
        name: `${p.firstName} ${p.lastName}`,
        company: p.company,
        channel: 'text',
        tier: p.tier,
        context: `${p.referralCount} referrals • Last touch: ${p.lastTouch || 'Never'}`,
        message: getPartnerNurtureText(p),
      },
    });
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Select top 5 ensuring mix: at least 1 broker/partner + at least 1 prospect
  const selected: ScoredContact[] = [];
  const hasType = (t: 'broker' | 'partner' | 'prospect') =>
    selected.some((s) => s.sourceType === t);

  // First pass: take top scored items
  for (const item of scored) {
    if (selected.length >= 5) break;
    selected.push(item);
  }

  // Mix enforcement: if all prospects or all brokers, swap one
  const hasBrokerOrPartner = selected.some(
    (s) => s.sourceType === 'broker' || s.sourceType === 'partner'
  );
  const hasProspect = hasType('prospect');

  if (!hasBrokerOrPartner && scored.length > selected.length) {
    const firstNonProspect = scored.find(
      (s) => !selected.includes(s) && (s.sourceType === 'broker' || s.sourceType === 'partner')
    );
    if (firstNonProspect && selected.length > 0) {
      selected[selected.length - 1] = firstNonProspect;
    }
  }

  if (!hasProspect && scored.length > selected.length) {
    const firstProspect = scored.find(
      (s) => !selected.includes(s) && s.sourceType === 'prospect'
    );
    if (firstProspect && selected.length > 0) {
      selected[selected.length - 1] = firstProspect;
    }
  }

  // Always include 1 cold broker intro (if slot available)
  const availableCold = coldBrokers.filter(
    (c) => c.status === 'new' && !doneIds.has(c.id) && !snoozedIds.has(c.id)
  );
  if (availableCold.length > 0) {
    // Rotate: pick one based on day of year
    const dayOfYear = Math.floor(
      (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24)
    );
    const cold = availableCold[dayOfYear % availableCold.length];
    const coldTask: ScoredContact = {
      sourceType: 'cold_broker',
      score: 40,
      task: {
        id: cold.id,
        score: 40,
        source: 'cold_broker',
        label: 'New Broker',
        name: cold.name,
        company: cold.firm,
        channel: 'email',
        context: `${cold.title} • ${cold.email}`,
        message: getColdBrokerIntro(cold.name, cold.firm),
      },
    };

    // Replace the lowest-scored item if list is full, otherwise append
    if (selected.length < 5) {
      selected.push(coldTask);
    } else {
      // Only replace if no cold broker already in list
      const hasCold = selected.some((s) => s.sourceType === 'cold_broker');
      if (!hasCold) {
        selected.sort((a, b) => a.score - b.score);
        selected[0] = coldTask;
      }
    }
  }

  // Final sort by score descending
  selected.sort((a, b) => b.score - a.score);

  return selected.slice(0, 5).map((s) => s.task);
}
