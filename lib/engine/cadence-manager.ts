// lib/engine/cadence-manager.ts
// Reads from existing brokers and partners tables
// Flags contacts due for a touch based on next_due date
// Applies crossing-over protection before surfacing anyone

import {
  getBrokersDueForTouch,
  getPartnersDueForTouch,
  getRecentActivity,
  hasOpenTask
} from './db';

export type DueContact = {
  id: string;
  source_table: 'brokers' | 'partners';
  first_name: string;
  last_name: string;
  company: string;
  tier: string;
  last_touch: string;
  next_due: string;
  email?: string;
  phone?: string;
  notes?: string;
  skip_reason?: string;
  days_overdue: number;
};

export async function runCadenceManager(): Promise<DueContact[]> {
  console.log('[CadenceManager] Checking contacts due for touch...');

  const today = new Date();
  const results: DueContact[] = [];

  // Pull brokers due for touch
  const brokers = await getBrokersDueForTouch();
  console.log(`[CadenceManager] ${brokers.length} brokers due`);

  for (const broker of brokers) {
    const dueDate = new Date(broker.next_due);
    const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

    // Crossing-over check: recent activity by anyone?
    const recentActivity = await getRecentActivity(broker.id);
    if (recentActivity) {
      console.log(`[CadenceManager] Skipping ${broker.first_name} ${broker.last_name} — touched ${recentActivity.date}`);
      continue;
    }

    // Open task check
    const openTask = await hasOpenTask(broker.id);
    if (openTask) {
      console.log(`[CadenceManager] Skipping ${broker.first_name} ${broker.last_name} — open task exists`);
      continue;
    }

    results.push({
      id: broker.id,
      source_table: 'brokers',
      first_name: broker.first_name,
      last_name: broker.last_name,
      company: broker.firm,
      tier: broker.tier,
      last_touch: broker.last_touch,
      next_due: broker.next_due,
      email: broker.email,
      phone: broker.phone,
      notes: broker.notes,
      days_overdue: daysOverdue
    });
  }

  // Pull partners due for touch
  const partners = await getPartnersDueForTouch();
  console.log(`[CadenceManager] ${partners.length} partners due`);

  for (const partner of partners) {
    const dueDate = new Date(partner.next_due);
    const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

    const recentActivity = await getRecentActivity(partner.id);
    if (recentActivity) continue;

    const openTask = await hasOpenTask(partner.id);
    if (openTask) continue;

    results.push({
      id: partner.id,
      source_table: 'partners',
      first_name: partner.first_name,
      last_name: partner.last_name,
      company: partner.company,
      tier: partner.tier,
      last_touch: partner.last_touch,
      next_due: partner.next_due,
      email: partner.email,
      phone: partner.phone,
      notes: partner.notes,
      days_overdue: daysOverdue
    });
  }

  // Sort by most overdue first, then by tier
  results.sort((a, b) => {
    const tierOrder: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
    if (tierOrder[a.tier] !== tierOrder[b.tier]) {
      return tierOrder[a.tier] - tierOrder[b.tier];
    }
    return b.days_overdue - a.days_overdue;
  });

  console.log(`[CadenceManager] ${results.length} contacts cleared for touch`);
  return results;
}
