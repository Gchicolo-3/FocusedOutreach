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
