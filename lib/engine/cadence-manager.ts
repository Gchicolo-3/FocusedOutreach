// lib/engine/cadence-manager.ts
// Reads from existing brokers and partners tables
// Flags contacts due for a touch based on next_due date, then runs every
// candidate through the recency guard (lib/engine/recencyGuard.ts):
// recently-touched contacts are suppressed, recently-touched-but-due ones
// switch to a follow-up template, never-connected ones run the 3-attempt
// cold track and get parked into the monthly_outreach bucket when exhausted.

import {
  getBrokersDueForTouch,
  getPartnersDueForTouch,
  getMonthlyOutreachContacts,
  getTouchEvidence,
  updateContactBucket,
  toIsoDate,
} from './db';
import { decideTouch, type DraftTemplate } from './recencyGuard';

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
  // Recency-guard output — drives which template the copywriter uses.
  draft_template: DraftTemplate;
  guard_last_touch: string | null;
  guard_last_touch_kind: string | null;
  guard_days_since_touch: number | null;
  cold_attempt_number?: number;
};

export async function runCadenceManager(): Promise<DueContact[]> {
  console.log('[CadenceManager] Checking contacts due for touch...');

  const today = new Date();
  const todayIso = today.toISOString().split('T')[0];
  const results: DueContact[] = [];

  // All evidence in one batched pass (touch_log + identity-linked activities
  // + sent drafts) — never per-contact queries.
  const [brokers, partners, monthly, evidence] = await Promise.all([
    getBrokersDueForTouch(),
    getPartnersDueForTouch(),
    getMonthlyOutreachContacts(),
    getTouchEvidence(),
  ]);
  console.log(`[CadenceManager] ${brokers.length} brokers due`);
  console.log(`[CadenceManager] ${partners.length} partners due`);
  console.log(`[CadenceManager] ${monthly.brokers.length + monthly.partners.length} in monthly outreach bucket`);

  const process = async (
    contact: Record<string, unknown>,
    source_table: 'brokers' | 'partners'
  ) => {
    const id = String(contact.id);
    const name = `${contact.first_name} ${contact.last_name}`;
    const decision = decideTouch(
      {
        tier: contact.tier as string,
        deal_count: contact.deal_count as number | null,
        referral_count: contact.referral_count as number | null,
        bucket: (contact.bucket as string) || 'active',
      },
      evidence.get(id),
      todayIso
    );

    if (decision.action === 'suppress') {
      console.log(`[CadenceManager] Suppressing ${name} — ${decision.reason}`);
      return;
    }
    if (decision.action === 'park') {
      console.log(`[CadenceManager] Parking ${name} — ${decision.reason}`);
      await updateContactBucket(source_table, id, 'monthly_outreach');
      return;
    }
    if (decision.action === 'restore') {
      console.log(`[CadenceManager] Restoring ${name} — ${decision.reason}`);
      await updateContactBucket(source_table, id, 'active');
      return; // normal cadence picks them up on the next run
    }

    const nextDueIso = toIsoDate(contact.next_due as string) || todayIso;
    const daysOverdue = Math.floor(
      (today.getTime() - new Date(nextDueIso).getTime()) / 86400000
    );

    results.push({
      id,
      source_table,
      first_name: String(contact.first_name || ''),
      last_name: String(contact.last_name || ''),
      company: String((source_table === 'brokers' ? contact.firm : contact.company) || ''),
      tier: String(contact.tier || ''),
      last_touch: String(contact.last_touch || ''),
      next_due: String(contact.next_due || ''),
      email: (contact.email as string) || undefined,
      phone: (contact.phone as string) || undefined,
      notes: (contact.notes as string) || undefined,
      days_overdue: daysOverdue,
      draft_template: decision.template,
      guard_last_touch: decision.lastTouch,
      guard_last_touch_kind: decision.lastTouchKind,
      guard_days_since_touch: decision.daysSinceTouch,
      cold_attempt_number: decision.attemptNumber,
    });
  };

  for (const broker of brokers) await process(broker, 'brokers');
  for (const partner of partners) await process(partner, 'partners');
  // Parked contacts aren't "due" by cadence — the guard decides if their
  // monthly cold touch is up.
  for (const broker of monthly.brokers) await process(broker, 'brokers');
  for (const partner of monthly.partners) await process(partner, 'partners');

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
