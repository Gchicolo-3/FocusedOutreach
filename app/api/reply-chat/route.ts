// app/api/reply-chat/route.ts
// The conversational reply generator. One POST serves two things:
//   messages: []      -> load and return the contact context card only
//   messages: [...]   -> one chat turn: system prompt (voice bank few-shot
//                        first, contact context, mode/channel inference,
//                        rules as constraints) + the conversation, then
//                        per-draft post-processing (sanitize, fill names,
//                        banned-phrase scan, persist to reply_drafts).
//
// Mode and channel are never sent by the client — the model infers them from
// the conversation and stamps them on each draft envelope.

import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  replyChatSystemPrompt,
  parseDrafts,
  rankSamples,
  inferHints,
  DRAFT_RE,
  type VoiceSampleRow,
} from '@/lib/replyChat';
import { findBannedPhrases } from '@/lib/replyAudit';
import { sanitizeReply, fillNamePlaceholders, hasNamePlaceholder } from '@/lib/replyText';
import { isReplyChannel, isReplyMode, type ReplyChannel } from '@/lib/replyPrompts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CONTACT_TABLES = ['brokers', 'partners', 'prospects', 'cold_brokers'] as const;
type ContactTable = (typeof CONTACT_TABLES)[number];
const isContactTable = (v: unknown): v is ContactTable =>
  typeof v === 'string' && (CONTACT_TABLES as readonly string[]).includes(v);

type ChatMessage = { role: 'user' | 'assistant'; content: string };

type ChatRequest = {
  contactId?: string;
  contactTable?: string;
  messages?: ChatMessage[];
};

// The UI's context card: what the system knows about the contact, shown the
// moment they're selected so George never has to explain who someone is.
export type ContactCard = {
  name: string;
  company: string;
  tier: string | null;
  bucket: string;
  lastTouch: string | null;
  lastTouchKind: string | null;
  daysSinceTouch: number | null;
  recentDrafts: number;
  signals: string[];
  touchedThisWeek: boolean;
};

function getDb(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? createClient(url, key) : null;
}

const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function toIso(value: unknown): string | null {
  const t = s(value);
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const mdy = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Everything the conversation should know about the contact, assembled from
// the record itself plus the identity-linked history Phase 1 made joinable:
// last activity (date + type), recent logged touches, recent draft history,
// and linked signals.
async function buildContactContext(
  db: SupabaseClient,
  table: ContactTable,
  id: string
): Promise<{ text: string; firstName: string | null; card: ContactCard } | null> {
  const { data: row, error } = await db.from(table).select('*').eq('id', id).maybeSingle();
  if (error || !row) return null;
  const r = row as Record<string, unknown>;

  let name = '';
  let company = '';
  let firstName: string | null = null;
  if (table === 'brokers' || table === 'partners') {
    name = `${s(r.first_name) || ''} ${s(r.last_name) || ''}`.trim();
    company = s(table === 'brokers' ? r.firm : r.company) || '';
    firstName = s(r.first_name);
  } else if (table === 'prospects') {
    name = s(r.contact) || '';
    company = s(r.company) || '';
    firstName = name.split(' ')[0] || null;
  } else {
    name = s(r.name) || '';
    company = s(r.firm) || '';
    firstName = name.split(' ')[0] || null;
  }

  const lines: string[] = [];
  const kind =
    table === 'brokers' ? 'Broker' : table === 'partners' ? 'Referral partner'
    : table === 'prospects' ? 'Prospect' : 'Cold broker';
  lines.push(`${kind}: ${name}${company ? ` at ${company}` : ''}`);
  if (s(r.title)) lines.push(`Title: ${s(r.title)}`);
  if (s(r.tier) || typeof r.tier === 'number') lines.push(`Tier: ${r.tier}`);
  if (s(r.bucket)) lines.push(`Bucket: ${s(r.bucket)}`);
  if (s(r.persona)) lines.push(`Persona: ${s(r.persona)}`);
  if (typeof r.deal_count === 'number' && r.deal_count > 0) lines.push(`Deals sent to Focus Studio: ${r.deal_count}`);
  if (typeof r.referral_count === 'number' && r.referral_count > 0) lines.push(`Referrals given: ${r.referral_count}`);
  const notes = s(r.notes) || s(r.comments);
  if (notes) lines.push(`Notes: ${notes.slice(0, 600)}`);

  // Identity-linked history, all scoped to this one contact.
  const [acts, touches, engineDrafts, replyDrafts, signals] = await Promise.all([
    db.from('activities')
      .select('date, activity_type, subject, comments')
      .eq('contact_table', table)
      .eq('contact_id', id)
      .eq('match_status', 'matched')
      .limit(5),
    db.from('touch_log')
      .select('date, channel, spoke, notes')
      .eq('contact_id', id)
      .order('date', { ascending: false })
      .limit(5),
    db.from('drafts')
      .select('created_at, draft_type, channel, status, body, sent_at')
      .eq('contact_id', id)
      .order('created_at', { ascending: false })
      .limit(3),
    db.from('reply_drafts')
      .select('created_at, mode, channel, generated_reply')
      .eq('contact_id', id)
      .order('created_at', { ascending: false })
      .limit(2),
    db.from('signals')
      .select('signal_date, signal_type, summary')
      .eq('contact_id', id)
      .order('created_at', { ascending: false })
      .limit(3),
  ]);

  // Last touch = max across logged touches, linked activities, and drafts
  // actually sent (same evidence set as the engine's recency guard).
  let lastTouch: string | null = null;
  let lastTouchKind: string | null = null;
  const consider = (dateIso: string | null, kindLabel: string) => {
    if (dateIso && (!lastTouch || dateIso > lastTouch)) {
      lastTouch = dateIso;
      lastTouchKind = kindLabel;
    }
  };
  for (const a of acts.data || []) consider(toIso(a.date), a.activity_type || 'activity');
  for (const t of touches.data || []) consider(toIso(t.date), `logged ${t.channel || 'touch'}`);
  for (const d of engineDrafts.data || []) {
    if (d.status === 'sent') consider(toIso(d.sent_at), `sent ${d.channel} draft`);
  }

  const activityLines = (acts.data || [])
    .map((a) => `${toIso(a.date) || '?'} ${a.activity_type || 'activity'}: ${(a.subject || a.comments || '').toString().slice(0, 100)}`)
    .filter(Boolean);
  if (activityLines.length) lines.push(`Recent activity history:\n  ${activityLines.join('\n  ')}`);
  const touchLines = (touches.data || []).map(
    (t) => `${t.date} (${t.channel}${t.spoke ? ', spoke' : ''}${t.notes ? `: ${String(t.notes).slice(0, 80)}` : ''})`
  );
  if (touchLines.length) lines.push(`Recent logged touches: ${touchLines.join('; ')}`);

  const draftLines = [
    ...(engineDrafts.data || []).map(
      (d) => `${String(d.created_at).slice(0, 10)} engine ${d.draft_type || 'draft'} (${d.channel}, ${d.status}): ${String(d.body || '').slice(0, 120)}`
    ),
    ...(replyDrafts.data || []).map(
      (d) => `${String(d.created_at).slice(0, 10)} reply draft (${d.mode || '?'}, ${d.channel || '?'}): ${String(d.generated_reply || '').slice(0, 120)}`
    ),
  ];
  if (draftLines.length) {
    lines.push(`Recent drafts already written for this contact (do not repeat their angles):\n  ${draftLines.join('\n  ')}`);
  }

  const signalLines = (signals.data || []).map(
    (x) => `${x.signal_date || ''} ${x.signal_type || 'signal'}: ${String(x.summary || '').slice(0, 160)}`
  );
  if (signalLines.length) lines.push(`Linked signals (verified, usable as triggers):\n  ${signalLines.join('\n  ')}`);

  const daysSinceTouch = lastTouch
    ? Math.floor((Date.now() - new Date(lastTouch).getTime()) / 86400000)
    : null;
  if (lastTouch) lines.push(`LAST REAL TOUCH: ${lastTouch} (${lastTouchKind}, ${daysSinceTouch} days ago)`);
  else lines.push('LAST REAL TOUCH: none on record');

  const card: ContactCard = {
    name,
    company,
    tier: r.tier != null ? String(r.tier) : null,
    bucket: s(r.bucket) || 'active',
    lastTouch,
    lastTouchKind,
    daysSinceTouch,
    recentDrafts: draftLines.length,
    signals: signalLines,
    touchedThisWeek: daysSinceTouch !== null && daysSinceTouch < 7,
  };

  return { text: lines.join('\n'), firstName, card };
}

async function fetchVoiceSamples(db: SupabaseClient | null, latestUserMessage: string): Promise<VoiceSampleRow[]> {
  if (!db) return [];
  try {
    const { data } = await db
      .from('voice_samples')
      .select('text, mode, channel, created_at')
      .order('created_at', { ascending: false })
      .limit(60);
    return rankSamples((data || []).filter((r) => s(r.text)), inferHints(latestUserMessage));
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const db = getDb();
  const contactTable = isContactTable(body.contactTable) ? body.contactTable : null;
  const contactId = s(body.contactId);
  const ctx =
    db && contactTable && contactId
      ? await buildContactContext(db, contactTable, contactId)
      : null;

  const messages: ChatMessage[] = Array.isArray(body.messages)
    ? body.messages
        .filter(
          (m): m is ChatMessage =>
            !!m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && !!m.content.trim()
        )
        .slice(-24)
    : [];

  // Context-only request: contact just connected, no chat turn yet.
  if (messages.length === 0) {
    if (contactTable && contactId && !ctx) {
      return NextResponse.json({ error: 'Could not load that contact' }, { status: 404 });
    }
    return NextResponse.json({ card: ctx?.card || null });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY is not configured on the server.' },
      { status: 500 }
    );
  }
  if (messages[messages.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'Last message must be from the user' }, { status: 400 });
  }

  const latest = messages[messages.length - 1].content;
  const samples = await fetchVoiceSamples(db, latest);

  const recencyNote = ctx?.card.touchedThisWeek
    ? `RECENT TOUCH ALERT: this contact was touched ${ctx.card.daysSinceTouch} day(s) ago (${ctx.card.lastTouchKind}). Say so unprompted in your reply, and any draft must be a continuation of that touch — never a lapsed check-in.`
    : null;

  const system = replyChatSystemPrompt({
    samples,
    contactContext: ctx?.text || null,
    recencyNote,
  });

  const client = new Anthropic();
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system,
      messages,
    });
    const block = response.content.find((b) => b.type === 'text');
    let reply = block && block.type === 'text' ? block.text.trim() : '';
    if (!reply) return NextResponse.json({ error: 'No text generated' }, { status: 500 });

    // Post-process each draft envelope in place: sanitize, fill the real
    // name, keep the envelope so the client renders it as a card.
    const fillName = (t: string) => (ctx?.firstName ? fillNamePlaceholders(t, ctx.firstName) : t);
    reply = reply.replace(DRAFT_RE, (_m, mode: string, channel: string, draftBody: string) => {
      const clean = fillName(sanitizeReply(draftBody));
      return `<<<DRAFT mode=${mode} channel=${channel}>>>\n${clean}\n<<<END>>>`;
    });

    // Scan + persist the processed drafts.
    const drafts = parseDrafts(reply).map((d) => {
      const channelForScan: ReplyChannel = isReplyChannel(d.channel) ? d.channel : 'email';
      const warnings = findBannedPhrases(d.body, channelForScan);
      if (hasNamePlaceholder(d.body)) {
        warnings.push('unfilled [name] placeholder — connect the contact or fill it in before sending');
      }
      return { ...d, warnings };
    });

    if (db && drafts.length) {
      const rows = drafts.map((d) => ({
        mode: isReplyMode(d.mode) ? d.mode : null,
        channel: isReplyChannel(d.channel) ? d.channel : null,
        incoming_email: latest.slice(0, 4000),
        generated_reply: d.body,
        contact_id: ctx ? contactId : null,
        contact_table: ctx ? contactTable : null,
        audit_passed: d.warnings.length ? false : null,
        audit_findings: d.warnings.length ? d.warnings.join('\n') : null,
      }));
      const { error } = await db.from('reply_drafts').insert(rows);
      if (error) console.error('[reply-chat] draft insert failed:', error.message);
    }

    return NextResponse.json({ reply, drafts, card: ctx?.card || null });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.error('[reply-chat] API error:', err.status, err.message);
      return NextResponse.json(
        { error: `Claude API error (${err.status}): ${err.message}` },
        { status: err.status || 500 }
      );
    }
    console.error('[reply-chat] unexpected error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
