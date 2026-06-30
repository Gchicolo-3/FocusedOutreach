// app/api/engine/run/route.ts
// Focus Studio Pipeline Engine
// Vercel Cron Job entry point
// Runs daily at 7:00am ET via vercel.json cron config
// Also callable manually via GET /api/engine/run

import { NextResponse } from 'next/server';
import { runSignalScout } from '@/lib/engine/signal-scout';
import { runQualifier } from '@/lib/engine/qualifier';
import { runCadenceManager } from '@/lib/engine/cadence-manager';
import { runCopywriter } from '@/lib/engine/copywriter';
import { sendMorningDigest } from '@/lib/engine/digest';
import { logAgentRun } from '@/lib/engine/db';

export const maxDuration = 300; // 5 min max for Vercel Pro, 60s for hobby
export const dynamic = 'force-dynamic'; // request-time only; never prerender

export async function GET(request: Request) {
  // Verify this is coming from Vercel cron or an authorized manual trigger
  const authHeader = request.headers.get('authorization');
  if (
    process.env.NODE_ENV === 'production' &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
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
    // Step 1: Signal Scout - find reasons to reach out
    console.log('[Engine] Running Signal Scout...');
    const signals = await runSignalScout();
    summary.signalsFound = signals.length;

    // Step 2: Qualifier - score and route signals
    console.log('[Engine] Running Qualifier...');
    const qualified = await runQualifier(signals);
    summary.signalsQualified = qualified.actionable.length;

    // Step 3: Cadence Manager - find contacts due for a touch
    console.log('[Engine] Running Cadence Manager...');
    const dueTouches = await runCadenceManager();
    summary.contactsFlagged = dueTouches.length;

    // Step 4: Copywriter - draft everything
    console.log('[Engine] Running Copywriter...');
    const allItems = [
      ...qualified.actionable.map((s: any) => ({ type: 'signal', data: s })),
      ...dueTouches.map((c: any) => ({ type: 'cadence', data: c }))
    ];
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
