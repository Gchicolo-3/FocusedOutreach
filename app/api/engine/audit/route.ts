// app/api/engine/audit/route.ts
// Audits pending engine drafts that have never been audited (banned-phrase
// scan + editor checklist — lib/engine/draftAudit.ts). Batch per call so it
// returns well inside the function limit; call repeatedly until
// `remaining` is 0 to drain the backlog. Bearer-secret protected like the
// other engine endpoints; the dashboard goes through /api/engine/audit-trigger.

import { NextResponse } from 'next/server';
import { auditPendingDrafts } from '@/lib/engine/draftAudit';
import { isEngineRequestAuthorized } from '@/lib/engine/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 60;

export async function POST(request: Request) {
  if (!isEngineRequestAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let limit = DEFAULT_LIMIT;
  try {
    const body = await request.json();
    if (typeof body?.limit === 'number' && body.limit > 0) {
      limit = Math.min(Math.floor(body.limit), MAX_LIMIT);
    }
  } catch {
    // no body — use the default
  }

  try {
    const result = await auditPendingDrafts(limit);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'audit failed' },
      { status: 500 }
    );
  }
}
