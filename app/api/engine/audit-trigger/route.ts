// app/api/engine/audit-trigger/route.ts
// Dashboard-facing trigger for the draft audit. The browser cannot hold
// CRON_SECRET, so this server route injects the Authorization: Bearer header
// and forwards to the protected /api/engine/audit endpoint. Mirrors
// /api/engine/classify-trigger. One batch per click; the Drafts tab keeps
// clicking until `remaining` hits 0.

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const PER_CLICK_LIMIT = 20;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured on the server.' },
      { status: 500 }
    );
  }

  const host = request.headers.get('host');
  const origin = host
    ? `https://${host}`
    : (process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || new URL(request.url).origin);

  try {
    const res = await fetch(`${origin}/api/engine/audit`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ limit: PER_CLICK_LIMIT }),
      cache: 'no-store',
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        { error: data?.error || `Audit failed (HTTP ${res.status})` },
        { status: res.status }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to reach the audit endpoint' },
      { status: 500 }
    );
  }
}
