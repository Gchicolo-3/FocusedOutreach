// app/api/outlook/status/route.ts
// Whether a Microsoft account is connected, and which one. Used by the
// dashboard to show connect state and by the draft flow to decide whether to
// use Graph or fall back to mailto. Returns no tokens.

import { NextResponse } from 'next/server';
import { getStoredToken } from '@/lib/ms/tokenStore';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const token = await getStoredToken();
    return NextResponse.json({
      connected: !!token,
      account: token?.account_email || null,
    });
  } catch (err) {
    return NextResponse.json(
      { connected: false, error: err instanceof Error ? err.message : 'status failed' },
      { status: 500 }
    );
  }
}
