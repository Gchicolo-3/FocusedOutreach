// ============================================================================
// STATUS (verified 2026-08-20): Microsoft Graph was NEVER authenticated.
// ms_oauth_tokens has zero rows, email_replies has zero rows, and no reply
// has ever been ingested. Nothing downstream of this route has ever run
// against real data. DORMANT: kept in place per Amendment 1 to the Aug 2026
// brief — do not delete, do not build on it. The email send path is the
// mailto: helper in lib/sendActions.ts.
// ============================================================================
// app/api/outlook/callback/route.ts
// Microsoft redirects here with ?code&state after George grants access.
// Verify state, exchange the code for tokens, persist, and bounce back to the
// dashboard with a status flag.

import { NextResponse } from 'next/server';
import { exchangeCodeAndStore, verifyState } from '@/lib/ms/graph';

export const dynamic = 'force-dynamic';

function dashboard(request: Request, params: string): NextResponse {
  const host = request.headers.get('host');
  const proto = host && host.startsWith('localhost') ? 'http' : 'https';
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ||
    (host ? `${proto}://${host}` : new URL(request.url).origin);
  return NextResponse.redirect(`${base}/?${params}`);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  if (oauthError) {
    return dashboard(request, `outlook=error&reason=${encodeURIComponent(oauthError)}`);
  }
  if (!code || !verifyState(state)) {
    return dashboard(request, 'outlook=error&reason=invalid_state');
  }

  try {
    const stored = await exchangeCodeAndStore(request, code);
    const acct = stored.account_email ? `&account=${encodeURIComponent(stored.account_email)}` : '';
    return dashboard(request, `outlook=connected${acct}`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'exchange_failed';
    return dashboard(request, `outlook=error&reason=${encodeURIComponent(reason)}`);
  }
}
