// app/api/outlook/connect/route.ts
// Starts the Microsoft OAuth flow: George opens this in his browser and is
// redirected to Microsoft to grant the app access to his Focus Studio mailbox.
// CSRF is covered by an HMAC-signed state param verified on callback.

import { NextResponse } from 'next/server';
import { buildAuthorizeUrl, makeState } from '@/lib/ms/graph';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = buildAuthorizeUrl(request, makeState());
    return NextResponse.redirect(url);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to start OAuth' },
      { status: 500 }
    );
  }
}
