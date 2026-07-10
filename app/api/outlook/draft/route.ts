// app/api/outlook/draft/route.ts
// Creates a real Outlook draft in George's mailbox via Microsoft Graph and
// returns its webLink so the client can open it in Outlook Web, pre-filled
// and ready to review/send. Replaces the old mailto: flow.
//
// Browser-callable (single-user tool, same posture as /api/generate-message).
// When no Microsoft account is connected it returns { ok: false,
// reason: 'not_connected' } so the client can fall back to mailto.

import { NextResponse } from 'next/server';
import { graphFetch, NotConnectedError } from '@/lib/ms/graph';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type DraftRequest = { to?: string; subject?: string; body?: string };

export async function POST(request: Request) {
  let payload: DraftRequest;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const to = (payload.to || '').trim();
  const subject = (payload.subject || '').trim();
  const body = payload.body || '';

  if (!to) {
    return NextResponse.json({ ok: false, error: 'Missing recipient' }, { status: 400 });
  }

  try {
    const res = await graphFetch('/me/messages', {
      method: 'POST',
      body: JSON.stringify({
        subject,
        body: { contentType: 'Text', content: body },
        toRecipients: [{ emailAddress: { address: to } }],
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data?.error?.message || `Graph error ${res.status}`;
      return NextResponse.json({ ok: false, error: detail }, { status: 502 });
    }

    // webLink opens the saved draft in Outlook on the web.
    return NextResponse.json({ ok: true, id: data.id, webLink: data.webLink });
  } catch (err) {
    if (err instanceof NotConnectedError) {
      return NextResponse.json({ ok: false, reason: 'not_connected' });
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'draft failed' },
      { status: 500 }
    );
  }
}
