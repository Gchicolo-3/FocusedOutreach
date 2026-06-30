// app/api/engine/trigger/route.ts
// Dashboard-facing trigger for the pipeline engine.
// The browser cannot (and must not) hold CRON_SECRET, so this server route
// injects the Authorization: Bearer header from the server environment and
// forwards to the protected /api/engine/run endpoint.

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // engine run can take several minutes

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured on the server.' },
      { status: 500 }
    );
  }

  // Resolve the deployment's own origin so this works on prod and previews
  // without depending on a hard-coded URL.
  const host = request.headers.get('host');
  const origin = host
    ? `https://${host}`
    : (process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || new URL(request.url).origin);

  try {
    const res = await fetch(`${origin}/api/engine/run`, {
      method: 'GET',
      headers: { authorization: `Bearer ${secret}` },
      cache: 'no-store',
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        { error: data?.error || `Engine run failed (HTTP ${res.status})` },
        { status: res.status }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to reach engine run route' },
      { status: 500 }
    );
  }
}
