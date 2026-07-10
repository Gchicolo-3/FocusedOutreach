// app/api/engine/classify/route.ts
// Runs the contact qualification classifier (lib/engine/classifier.ts).
// One-time backfill + re-runnable for new imports: only rows with
// persona IS NULL are processed, so repeated calls work through the
// backlog. Requires the engine Bearer secret.
//
//   curl -X POST "$APP_URL/api/engine/classify" \
//     -H "authorization: Bearer $CRON_SECRET" \
//     -H "content-type: application/json" \
//     -d '{"table":"brokers","limit":150}'

import { NextResponse } from 'next/server';
import { isEngineRequestAuthorized } from '@/lib/engine/auth';
import { runClassifier } from '@/lib/engine/classifier';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isEngineRequestAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    // empty body is fine; defaults apply
  }

  const tables: Array<'brokers' | 'partners'> =
    body.table === 'brokers' ? ['brokers']
    : body.table === 'partners' ? ['partners']
    : ['brokers', 'partners'];
  // Per-call cap keeps the run inside the function time limit; call again to
  // continue through the backlog.
  const limit = Math.min(Math.max(Number(body.limit) || 150, 1), 400);

  const results: Record<string, unknown> = {};
  for (const table of tables) {
    results[table] = await runClassifier(table, limit);
  }

  return NextResponse.json({ success: true, limit, results });
}
