// app/api/engine/run/route.ts
// Focus Studio Pipeline Engine
// Vercel Cron Job entry point
// Runs daily at 7:00am ET via vercel.json cron config
// Also callable manually via GET /api/engine/run

import { NextResponse } from 'next/server';
import { runCadenceManager } from '@/lib/engine/cadence-manager';
import { runCopywriter } from '@/lib/engine/copywriter';
import { sendMorningDigest } from '@/lib/engine/digest';
import { logAgentRun, getPendingDraftKeys, normalizeContactName } from '@/lib/engine/db';
import { isEngineRequestAuthorized } from '@/lib/engine/auth';

export const maxDuration = 300; // 5 min max for Vercel Pro, 60s for hobby
export const dynamic = 'force-dynamic'; // request-time only; never prerender

// Cap drafts per run so the pipeline always completes within the function
// time limit (a full ~600-contact batch cannot finish in 300s and gets killed
// before the digest sends). Most-overdue contacts are drafted first; the rest
// roll to the next run.
const MAX_DRAFTS_PER_RUN = 40;

export async function GET(request: Request) {
  // Verify this is coming from Vercel cron or an authorized manual trigger
  if (!isEngineRequestAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();
  console.log(`[Engine] Starting pipeline run: ${new Date().toISOString()}`);

  const summary = {
    signalsFound: 0,
    signalsQualified: 0,
    draftsCreated: 0,
    contactsFlagged: 0,
    errors: [] as string[]
  };

  try {
    // Steps 1-2 (signal discovery + qualification) are intentionally empty.
    // The Perplexity signal scout returned nothing usable and burned run time,
    // so it was removed; the Phase-2 RSS/news ingester re-enters the pipeline
    // here by producing signals and passing them through runQualifier
    // (lib/engine/qualifier.ts, kept for that purpose).
    const qualified = { actionable: [] as any[], watchlist: [] as any[] };

    // Step 3: Cadence Manager - find contacts due for a touch
    console.log('[Engine] Running Cadence Manager...');
    const dueTouches = await runCadenceManager();
    summary.contactsFlagged = dueTouches.length;

    // Step 4: Copywriter - draft the highest-priority items.
    // Dedup: skip any contact that already has a pending (unreviewed) draft,
    // keyed by BOTH contact id and normalized name (the same person can exist
    // under different ids, e.g. a row in brokers and another in partners).
    // Also guard against the same person appearing twice in one batch. Then
    // cap the total so the run finishes within the function time limit.
    console.log('[Engine] Running Copywriter...');
    const pendingKeys = await getPendingDraftKeys();
    const seen = new Set<string>();
    const keep = (keys: string[]): boolean => {
      const valid = keys.filter(Boolean);
      if (valid.length === 0) return true; // no identity at all; can't dedup
      if (valid.some((k) => pendingKeys.has(k) || seen.has(k))) return false;
      valid.forEach((k) => seen.add(k));
      return true;
    };
    const nameKey = (name?: string): string => {
      const n = normalizeContactName(name);
      return n ? `name:${n}` : '';
    };

    const candidates = [
      ...qualified.actionable.map((s: any) => ({
        type: 'signal',
        data: s,
        keys: [s.contact_id, nameKey(s.contact_name)],
      })),
      // dueTouches is already sorted most-overdue-first by the cadence manager
      ...dueTouches.map((c: any) => ({
        type: 'cadence',
        data: c,
        keys: [c.id, nameKey(`${c.first_name} ${c.last_name}`)],
      })),
    ];
    const allItems = candidates
      .filter((x) => keep(x.keys))
      .slice(0, MAX_DRAFTS_PER_RUN)
      .map(({ type, data }) => ({ type, data }));

    console.log(`[Engine] Drafting ${allItems.length} of ${candidates.length} candidates (capped at ${MAX_DRAFTS_PER_RUN})`);
    const drafts = await runCopywriter(allItems);
    summary.draftsCreated = drafts.length;

    // Step 5: Morning digest - email + dashboard update
    console.log('[Engine] Sending morning digest...');
    await sendMorningDigest({
      signals: qualified.actionable,
      watchlist: qualified.watchlist,
      drafts,
      dueTouches,
      summary
    });

  } catch (err: any) {
    summary.errors.push(err.message);
    console.error('[Engine] Error:', err);
  }

  const runtimeMs = Date.now() - startTime;

  await logAgentRun({
    agentName: 'orchestrator',
    status: summary.errors.length > 0 ? 'partial' : 'success',
    signalsFound: summary.signalsFound,
    draftsCreated: summary.draftsCreated,
    contactsFlagged: summary.contactsFlagged,
    errors: summary.errors.join('; '),
    runtimeMs
  });

  console.log(`[Engine] Run complete in ${runtimeMs}ms`);

  return NextResponse.json({
    success: true,
    ...summary,
    runtimeMs
  });
}
