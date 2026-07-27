// app/api/events/outreach/route.ts
// Receives an outreach-completed event and forwards it to n8n.
// Designed to sit behind a Supabase Database Webhook on touch_log (see
// docs/N8N-OUTREACH-EVENTS.md): Supabase POSTs the row change here, this route
// normalizes it into a stable shape and relays it to N8N_OUTREACH_WEBHOOK_URL.
// Keeps the n8n URL (and any secret) server-side instead of in the browser.

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic'; // request-time only; never prerender
export const maxDuration = 30;

// Optional shared secret. When OUTREACH_WEBHOOK_SECRET is set, callers must send
// it in the x-outreach-secret header (configure it as an HTTP header on the
// Supabase webhook). Unset leaves the route open, matching the engine routes'
// dev-friendly default.
function authorized(request: Request): boolean {
  const secret = process.env.OUTREACH_WEBHOOK_SECRET;
  if (!secret) return true;
  return request.headers.get('x-outreach-secret') === secret;
}

type SupabaseWebhookPayload = {
  type?: 'INSERT' | 'UPDATE' | 'DELETE';
  table?: string;
  schema?: string;
  record?: Record<string, unknown> | null;
  old_record?: Record<string, unknown> | null;
};

// Normalize a Supabase Database Webhook payload into a stable outreach event.
// A body that isn't Supabase-shaped (e.g. a hand-rolled call) is stamped with a
// timestamp and passed through so the route stays a general forwarder.
function normalize(body: unknown): Record<string, unknown> {
  const at = new Date().toISOString();

  if (body && typeof body === 'object' && 'record' in body && 'table' in body) {
    const p = body as SupabaseWebhookPayload;
    const rec = (p.record || p.old_record || {}) as Record<string, unknown>;
    return {
      event: 'outreach_completed',
      source: p.table ?? 'unknown',
      operation: p.type ?? 'INSERT',
      contact_id: rec.contact_id ?? rec.id ?? null,
      channel: rec.channel ?? null,
      date: rec.date ?? null,
      at,
      record: rec,
    };
  }

  const extra = body && typeof body === 'object' ? (body as Record<string, unknown>) : { body };
  return { event: 'outreach_completed', at, ...extra };
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const target = process.env.N8N_OUTREACH_WEBHOOK_URL;
  if (!target) {
    return NextResponse.json(
      { error: 'N8N_OUTREACH_WEBHOOK_URL is not configured on the server.' },
      { status: 500 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const event = normalize(body);

  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `n8n responded ${res.status}` },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, forwarded: event });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Failed to reach n8n' },
      { status: 502 }
    );
  }
}
