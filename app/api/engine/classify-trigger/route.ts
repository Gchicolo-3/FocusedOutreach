// app/api/engine/classify-trigger/route.ts
// Dashboard-facing trigger for the contact classifier. The browser cannot hold
// CRON_SECRET, so this server route injects the Authorization: Bearer header
// and forwards to the protected /api/engine/classify endpoint. Mirrors
// /api/engine/trigger. Classifies a small batch per click (limit 20) so each
// call returns quickly.

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // classification can take a bit under load

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
    const res = await fetch(`${origin}/api/engine/classify`, {
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
        { error: data?.error || `Classification failed (HTTP ${res.status})` },
        { status: res.status }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to reach the classifier' },
      { status: 500 }
    );
  }
}
