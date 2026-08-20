// ============================================================================
// STATUS (verified 2026-08-20): Microsoft Graph was NEVER authenticated.
// ms_oauth_tokens has zero rows, email_replies has zero rows, and no reply
// has ever been ingested. Nothing downstream of this route has ever run
// against real data. DORMANT: kept in place per Amendment 1 to the Aug 2026
// brief — do not delete, do not build on it. The email send path is the
// mailto: helper in lib/sendActions.ts.
// ============================================================================
// app/api/outlook/poll-replies/route.ts
// Polls the connected Outlook inbox and logs replies from CRM contacts to the
// activities table. Runs on cron (see vercel.json) and is Bearer-gated like
// the engine. A no-op (200) when no Microsoft account is connected yet.

import { NextResponse } from 'next/server';
import { isEngineRequestAuthorized } from '@/lib/engine/auth';
import { pollReplies } from '@/lib/ms/replies';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isEngineRequestAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await pollReplies();
  return NextResponse.json({ success: result.errors.length === 0, ...result });
}
