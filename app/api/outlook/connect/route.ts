// ============================================================================
// STATUS (verified 2026-08-20): Microsoft Graph was NEVER authenticated.
// ms_oauth_tokens has zero rows, email_replies has zero rows, and no reply
// has ever been ingested. Nothing downstream of this route has ever run
// against real data. DORMANT: kept in place per Amendment 1 to the Aug 2026
// brief — do not delete, do not build on it. The email send path is the
// mailto: helper in lib/sendActions.ts.
// ============================================================================
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
