import { Lead, Broker, Partner, ColdBroker, DailyTask } from '@/types';
import { computeStatus, daysSince } from './cadence';
import { getLeadMessage, getBrokerNurtureText, getPartnerNurtureText, getColdBrokerIntro } from './messages';

const TIER_1_KEYWORDS = [
  'intro',
  'mentioned',
  'intel from',
  'gave me',
  'referred',
  'connected me',
  // Broker names act as Tier 1 triggers when they appear in Comments
  'mcbride',
  'shikar',
  'devries',
  'isman',
  'ryan',
  'dombrowski',
  'horowitz',
  'chilenski',
];

export function prioritizeLead(lead: Lead): 1 | 2 | 3 {
  const comments = (lead.comments || '').toLowerCase();
  const hasBrokerIntel = TIER_1_KEYWORDS.some((kw) => comments.includes(kw)) || !!lead.broker;

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

function brokerToTask(b: Broker): DailyTask {
  const status = computeStatus(b.lastTouch, b.tier);
  const label =
    status === 'overdue' ? `Tier ${b.tier} Overdue` : status === 'due_soon' ? `Tier ${b.tier} Due Soon` : `Tier ${b.tier}`;
  return {
    id: b.id,
    score: status === 'overdue' ? (b.tier === 'A' ? 100 : 75) : b.tier === 'A' ? 90 : 60,
    source: 'broker',
    label,
    name: `${b.firstName} ${b.lastName}`,
    company: b.firm,
    channel: 'text',
    tier: b.tier,
    context: `${b.dealCount} deals · Last touch: ${b.lastTouch || 'Never'}`,
    message: getBrokerNurtureText(b),
    email: b.email,
    phone: b.mobile || b.phone,
    intel: b.notes || `${b.dealCount} deals given · Tier ${b.tier} broker`,
    lastTouch: b.lastTouch,
  };
}

function partnerToTask(p: Partner): DailyTask {
  const status = computeStatus(p.lastTouch, p.tier);
  const label = status === 'overdue' ? `Partner ${p.tier} Overdue` : `Partner ${p.tier}`;
  return {
    id: p.id,
    score: status === 'overdue' ? 70 : 50,
    source: 'partner',
    label,
    name: `${p.firstName} ${p.lastName}`,
    company: p.company,
    channel: 'text',
    tier: p.tier,
    context: `${p.referralCount} referrals · Last touch: ${p.lastTouch || 'Never'}`,
    message: getPartnerNurtureText(p),
    email: p.email,
    phone: p.phone,
    intel: p.notes || `${p.partnerType} partner · ${p.referralCount} referrals`,
    lastTouch: p.lastTouch,
  };
}

function prospectToTask(p: Lead): DailyTask {
  let score = 30;
  let label = 'Prospect';
  if (p.tier === 1) {
    score = p.broker ? 95 : 90;
    label = p.broker ? 'Broker Intel' : 'Hot Intel';
  } else if (p.tier === 2) {
    score = 60;
    label = 'Warm';
  } else if (p.tier === 3) {
    score = 30;
    label = 'Cold';
  }
  return {
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
    email: p.email,
    phone: p.phone,
    broker: p.broker,
    subject: p.subject,
    intel: p.comments || p.subject,
    lastTouch: p.lastTouch || p.date,
  };
}

function coldToTask(c: ColdBroker): DailyTask {
  return {
    id: c.id,
    score: 40,
    source: 'cold_broker',
    label: 'New Broker',
    name: c.name,
    company: c.firm,
    channel: 'email',
    context: `${c.title} · ${c.email}`,
    message: getColdBrokerIntro(c.name, c.firm),
    email: c.email,
    phone: c.mobile || c.phone,
    intel: `${c.title} at ${c.firm} · cold intro candidate`,
    subject: `Quick intro — Focus Studio`,
  };
}

// Build DailyTask cards for contacts the user manually pinned to today,
// resolving each pin against the loaded contact lists. Skips pins whose
// contact no longer exists.
export function buildTasksFromPins(
  pins: Array<{ id: string; source: string }>,
  prospects: Lead[],
  brokers: Broker[],
  partners: Partner[],
  coldBrokers: ColdBroker[]
): DailyTask[] {
  const out: DailyTask[] = [];
  for (const pin of pins) {
    let task: DailyTask | null = null;
    if (pin.source === 'broker') {
      const b = brokers.find((x) => x.id === pin.id);
      if (b) task = brokerToTask(b);
    } else if (pin.source === 'partner') {
      const p = partners.find((x) => x.id === pin.id);
      if (p) task = partnerToTask(p);
    } else if (pin.source === 'prospect') {
      const p = prospects.find((x) => x.id === pin.id);
      if (p) task = prospectToTask(p);
    } else if (pin.source === 'cold_broker') {
      const c = coldBrokers.find((x) => x.id === pin.id);
      if (c) task = coldToTask(c);
    }
    if (task) out.push(task);
  }
  return out;
}

export function selectDaily5(
  prospects: Lead[],
  brokers: Broker[],
  partners: Partner[],
  coldBrokers: ColdBroker[],
  doneIds: Set<string>,
  snoozedIds: Set<string>
): DailyTask[] {
  const tasks: DailyTask[] = [];
  const used = new Set<string>();
  const exclude = (id: string) => doneIds.has(id) || snoozedIds.has(id) || used.has(id);

  // Rotate the pool by day so the queue shows different people each day instead
  // of the same most-overdue faces every time (they only leave once acted on).
  const dayOffset = Math.floor(Date.now() / 86400000);
  const rotate = <T,>(arr: T[], off: number): T[] => {
    if (arr.length === 0) return arr;
    const k = ((off % arr.length) + arr.length) % arr.length;
    return [...arr.slice(k), ...arr.slice(0, k)];
  };

  // Sort active brokers by urgency: overdue first, then due_soon, then on_track.
  // Within same status, most days since last touch wins.
  const statusOrder: Record<string, number> = { overdue: 0, due_soon: 1, on_track: 2 };
  const sortedBrokers = [...brokers]
    .filter((b) => !exclude(b.id))
    .sort((a, b) => {
      const sa = statusOrder[computeStatus(a.lastTouch, a.tier)];
      const sb = statusOrder[computeStatus(b.lastTouch, b.tier)];
      if (sa !== sb) return sa - sb;
      return daysSince(b.lastTouch) - daysSince(a.lastTouch);
    });

  // Rotate within the actionable pool (overdue + due_soon) so which of the
  // people-who-need-a-touch surface varies day to day; on_track stay as fallback.
  const actionable = sortedBrokers.filter((b) => computeStatus(b.lastTouch, b.tier) !== 'on_track');
  const onTrack = sortedBrokers.filter((b) => computeStatus(b.lastTouch, b.tier) === 'on_track');
  const rotatedBrokers = [...rotate(actionable, dayOffset * 2), ...onTrack];

  // 1) Minimum 2 broker nurture touches
  for (const b of rotatedBrokers) {
    if (tasks.filter((t) => t.source === 'broker').length >= 2) break;
    tasks.push(brokerToTask(b));
    used.add(b.id);
  }

  // 2) Minimum 1 Tier 1 prospect
  const tier1 = prospects
    .filter((p) => !exclude(p.id) && p.tier === 1)
    .sort((a, b) => {
      if (a.broker && !b.broker) return -1;
      if (!a.broker && b.broker) return 1;
      return daysSince(a.date) - daysSince(b.date);
    });
  if (tier1.length > 0) {
    tasks.push(prospectToTask(tier1[0]));
    used.add(tier1[0].id);
  }

  // 3) Minimum 1 new cold broker (rotate by day of year)
  const colds = coldBrokers.filter((c) => !exclude(c.id) && c.status === 'new');
  if (colds.length > 0) {
    const dayOfYear = Math.floor(Date.now() / (1000 * 60 * 60 * 24)) % colds.length;
    const cold = colds[dayOfYear];
    tasks.push(coldToTask(cold));
    used.add(cold.id);
  }

  // 4) Fill remaining slots with high-scored candidates until we hit 5.
  // Rotate within the top-scored pool by day + slot so the fillers also vary
  // day to day rather than always being the same highest-scored people.
  while (tasks.length < 5) {
    const candidates: DailyTask[] = [];

    for (const b of rotatedBrokers) {
      if (exclude(b.id)) continue;
      candidates.push(brokerToTask(b));
    }
    for (const p of prospects) {
      if (exclude(p.id)) continue;
      candidates.push(prospectToTask(p));
    }
    for (const p of partners) {
      if (exclude(p.id)) continue;
      candidates.push(partnerToTask(p));
    }

    if (candidates.length === 0) break;
    candidates.sort((a, b) => b.score - a.score);
    const pool = candidates.slice(0, Math.min(12, candidates.length));
    const pick = pool[(dayOffset + tasks.length) % pool.length];
    tasks.push(pick);
    used.add(pick.id);
  }

  return tasks.slice(0, 5);
}
