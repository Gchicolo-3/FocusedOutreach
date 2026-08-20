import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  isReplyChannel,
  isReplyMode,
  replySystemPrompt,
  reviewSystemPrompt,
  type ReplyChannel,
  type ReplyMode,
} from '@/lib/replyPrompts';
import {
  findBannedPhrases,
  runEditorPass,
  auditCheckedSummary,
  type AuditOutcome,
} from '@/lib/replyAudit';

export const dynamic = 'force-dynamic';
// Generation + up to two banned-phrase rewrites + the editor pass is up to
// four model calls in the worst case; 30s was sized for one.
export const maxDuration = 60;

type ReplyRequest = {
  mode: ReplyMode;
  channel?: ReplyChannel; // defaults to email for older clients
  incomingEmail: string;
  threadContext?: string;
  // Review pass: George's hand-edited draft to verify against the voice rules
  // instead of generating fresh. `id` ties the result back to the history row.
  editedReply?: string;
  id?: string;
  // Audit-only: skip generation and run the audit pipeline (banned-phrase
  // scan + rewrite retries + editor pass) on this provided draft instead.
  // Nothing is saved to history. Used by the verification harness, and
  // usable to audit a hand-written draft.
  auditDraft?: string;
  // Connected CRM contact (picked via the search bar on /reply). The row's
  // real data — tier, deals, last touch, notes, recent touches — becomes
  // context for both the generation and the audit's trigger check, so the
  // model grounds the message in facts instead of filler.
  contactId?: string;
  contactTable?: string;
};

const CONTACT_TABLES = ['brokers', 'partners', 'prospects', 'cold_brokers'] as const;
type ContactTable = (typeof CONTACT_TABLES)[number];

function isContactTable(v: unknown): v is ContactTable {
  return typeof v === 'string' && (CONTACT_TABLES as readonly string[]).includes(v);
}

// Builds the CRM context block for a connected contact: the row itself plus
// recent touch_log entries, and the contact's first name so [name]-style
// placeholders in the output can be filled with the real recipient. Returns
// null when the row can't be loaded — the draft still generates, just without
// CRM grounding.
async function fetchContactContext(
  db: SupabaseClient,
  table: ContactTable,
  id: string
): Promise<{ text: string; firstName: string | null } | null> {
  const { data: row, error } = await db.from(table).select('*').eq('id', id).maybeSingle();
  if (error || !row) {
    if (error) console.error('[reply-generator] contact fetch failed:', error.message);
    return null;
  }
  const r = row as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

  let contactFirstName: string | null = null;
  if (table === 'brokers' || table === 'partners') {
    contactFirstName = s(r.first_name);
  } else if (table === 'prospects') {
    contactFirstName = s(r.contact)?.split(' ')[0] || null;
  } else {
    contactFirstName = s(r.name)?.split(' ')[0] || null;
  }

  const lines: string[] = [];
  if (table === 'brokers') {
    lines.push(`Broker: ${s(r.first_name) || ''} ${s(r.last_name) || ''} at ${s(r.firm) || 'unknown firm'}`.trim());
    if (s(r.title)) lines.push(`Title: ${s(r.title)}`);
    if (s(r.tier)) lines.push(`Relationship tier: ${s(r.tier)}`);
    if (s(r.persona)) lines.push(`Persona: ${s(r.persona)}`);
    if (typeof r.deal_count === 'number' && r.deal_count > 0) lines.push(`Deals sent to Focus Studio: ${r.deal_count}`);
    if (Array.isArray(r.deal_names) && r.deal_names.length) lines.push(`Deal names: ${(r.deal_names as string[]).join(', ')}`);
  } else if (table === 'partners') {
    lines.push(`Referral partner: ${s(r.first_name) || ''} ${s(r.last_name) || ''} at ${s(r.company) || 'unknown company'}`.trim());
    if (s(r.partner_type)) lines.push(`Partner type: ${s(r.partner_type)}`);
    if (s(r.tier)) lines.push(`Relationship tier: ${s(r.tier)}`);
    if (typeof r.referral_count === 'number' && r.referral_count > 0) lines.push(`Referrals given: ${r.referral_count}`);
  } else if (table === 'prospects') {
    lines.push(`Prospect: ${s(r.contact) || 'unknown'} at ${s(r.company) || 'unknown company'}`);
    if (r.tier) lines.push(`Prospect tier: T${r.tier}`);
    if (s(r.broker)) lines.push(`Referred by broker: ${s(r.broker)}`);
    if (r.is_enterprise === true) lines.push('Enterprise-scale ($200k+) target');
  } else {
    lines.push(`Cold broker: ${s(r.name) || 'unknown'} at ${s(r.firm) || 'unknown firm'}`);
    if (s(r.title)) lines.push(`Title: ${s(r.title)}`);
    if (s(r.status)) lines.push(`Outreach status: ${s(r.status)}`);
  }
  const lastTouch = s(r.last_touch);
  if (lastTouch) lines.push(`Last touch: ${lastTouch}`);
  const notes = s(r.notes) || s(r.comments);
  if (notes) lines.push(`Notes: ${notes.slice(0, 600)}`);

  const { data } = await db
    .from('touch_log')
    .select('date, channel, spoke, notes')
    .eq('contact_id', id)
    .order('date', { ascending: false })
    .limit(5);
  const touches = (data || []) as Array<{
    date: string;
    channel: string;
    spoke: boolean | null;
    notes: string | null;
  }>;
  if (touches.length) {
    lines.push(
      'Recent logged touches: ' +
        touches
          .map((t) => `${t.date} (${t.channel}${t.spoke ? ', spoke' : ''}${t.notes ? `: ${String(t.notes).slice(0, 80)}` : ''})`)
          .join('; ')
    );
  }
  return { text: lines.join('\n'), firstName: contactFirstName };
}

// [name] / [First Name] style placeholders that templates and prompt examples
// use for an unknown recipient. Shipping one in a real draft is a bug: fill it
// from the connected contact when possible, otherwise fail loudly via the
// audit warning so it can't be copied unnoticed.
function hasNamePlaceholder(text: string): boolean {
  return /\[\s*(?:first\s*name|name)\s*\]/i.test(text);
}

function fillNamePlaceholders(text: string, firstName: string): string {
  return text.replace(/\[\s*(?:first\s*name|name)\s*\]/gi, firstName);
}

// Real messages George has written, same anchor the compose route uses.
// Prefer samples from the matching voice_samples channel (email/text/linkedin),
// then fall back to any channel.
function sampleChannelFor(channel: ReplyChannel): string {
  if (channel === 'text') return 'text';
  if (channel === 'linkedin_connect' || channel === 'linkedin_message') return 'linkedin';
  return 'email';
}

async function fetchVoiceSamples(channel: ReplyChannel, limit = 6): Promise<string[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return [];
  try {
    const supabase = createClient(url, key);
    const { data } = await supabase
      .from('voice_samples')
      .select('text, channel')
      .order('created_at', { ascending: false })
      .limit(40);
    const rows = data || [];
    const wanted = sampleChannelFor(channel);
    const same = rows.filter((r) => r.channel === wanted).map((r) => r.text);
    const others = rows.filter((r) => r.channel !== wanted).map((r) => r.text);
    return [...same, ...others].filter(Boolean).slice(0, limit);
  } catch {
    return [];
  }
}

// The output must be paste-ready plain text. The prompt forbids markdown and
// em dashes but models still slip, so enforce deterministically.
function sanitizeReply(text: string): string {
  let out = text.trim();
  // Markdown bold/italic wrappers, keep the inner text.
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
  out = out.replace(/__([^_]+)__/g, '$1');
  out = out.replace(/(^|\s)\*([^*\n]+)\*(?=\s|[.,!?;:]|$)/g, '$1$2');
  // Markdown headers at line start.
  out = out.replace(/^#{1,6}\s+/gm, '');
  // Em/en dashes: spaced ones become a comma pause, bare ones too.
  out = out.replace(/\s+[—–]\s+/g, ', ');
  out = out.replace(/[—–]/g, ', ');
  // Model preambles like "Here's a draft:" on the first line.
  out = out.replace(/^(here('|')s|here is)[^\n]*:\s*\n+/i, '');
  return out.trim();
}

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY is not configured on the server.' },
      { status: 500 }
    );
  }

  let body: ReplyRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { mode, incomingEmail, threadContext, editedReply, id: rowId } = body;
  const channel: ReplyChannel = isReplyChannel(body.channel) ? body.channel : 'email';

  if (!isReplyMode(mode)) {
    return NextResponse.json(
      { error: 'mode must be one of: cre_referral, broker_prospecting, client_prospecting, internal' },
      { status: 400 }
    );
  }
  if (!incomingEmail || !incomingEmail.trim()) {
    return NextResponse.json({ error: 'incomingEmail is required' }, { status: 400 });
  }
  const isReview = typeof editedReply === 'string' && editedReply.trim().length > 0;
  const isAuditOnly =
    !isReview && typeof body.auditDraft === 'string' && body.auditDraft.trim().length > 0;

  // Connected contact (search bar on /reply): load their CRM data so the
  // draft and the audit's trigger check work from real facts.
  const dbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const dbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const db = dbUrl && dbKey ? createClient(dbUrl, dbKey) : null;
  const contactTable = isContactTable(body.contactTable) ? body.contactTable : null;
  const contactId = typeof body.contactId === 'string' && body.contactId.trim() ? body.contactId.trim() : null;
  const contactCtx =
    db && contactTable && contactId ? await fetchContactContext(db, contactTable, contactId) : null;
  const crmContext = contactCtx?.text ?? null;
  const contactFirstName = contactCtx?.firstName ?? null;
  // Applied to every draft variant the pipeline produces (initial, banned
  // phrase rewrites, editor revisions), so a placeholder can't survive one
  // path and not another.
  const fillName = (text: string) =>
    contactFirstName ? fillNamePlaceholders(text, contactFirstName) : text;

  const samples = await fetchVoiceSamples(channel);
  const voiceBlock = samples.length
    ? [
        'REAL MESSAGES GEORGE HAS ACTUALLY WRITTEN AND SENT. This is the ground',
        'truth of how he sounds. Match this voice exactly (rhythm, length, word',
        'choice, how he opens and closes). Do NOT copy these messages; write a',
        'new reply that sounds like the same person wrote it.',
        ...samples.map((s, i) => `--- sample ${i + 1} ---\n${s}`),
        '--- end samples ---',
        '',
      ].join('\n')
    : '';

  const context = (threadContext || '').trim();
  const crmBlock = crmContext
    ? [
        '',
        "CRM CONTEXT — verified data from George's own records for the contact",
        'this message is for. Ground the trigger and personalization in these',
        'facts. Never invent details beyond them:',
        '--- crm context ---',
        crmContext,
        '--- end crm context ---',
      ].join('\n')
    : '';
  const prompt = [
    voiceBlock,
    'WHAT GEORGE PASTED IN (a message he received to reply to, or notes on a',
    'situation for fresh outreach):',
    '--- pasted content ---',
    incomingEmail.trim(),
    '--- end pasted content ---',
    crmBlock,
    context
      ? [
          '',
          'BACKGROUND ONLY, NOT WHAT YOU ARE REPLYING TO (earlier messages in the',
          'chain or notes from George):',
          '--- thread context ---',
          context,
          '--- end thread context ---',
        ].join('\n')
      : '',
    isReview
      ? [
          '',
          "GEORGE'S EDITED DRAFT, verify this per the review rules:",
          '--- edited draft ---',
          editedReply!.trim(),
          '--- end edited draft ---',
          '',
          'Return the final verified message only, plain text.',
        ].join('\n')
      : "\nWrite George's message per the channel rules. The message only, plain text.",
  ]
    .filter(Boolean)
    .join('\n');

  const client = new Anthropic();

  try {
    let generatedReply: string;
    if (isAuditOnly) {
      generatedReply = fillName(sanitizeReply(body.auditDraft!.trim()));
    } else {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: isReview ? reviewSystemPrompt(mode, channel) : replySystemPrompt(mode, channel),
        messages: [{ role: 'user', content: prompt }],
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      const raw = textBlock && textBlock.type === 'text' ? textBlock.text.trim() : '';

      if (!raw) {
        return NextResponse.json({ error: 'No text generated' }, { status: 500 });
      }

      generatedReply = isReview ? sanitizeReply(raw) : fillName(sanitizeReply(raw));
    }

    // ===== Audit pass (fresh generations and audit-only; the review pass is
    // George's own edits and stays untouched) =====
    let audit: AuditOutcome | null = null;
    if (!isReview) {
      // Layer 1: mechanical banned-phrase check with up to two rewrite
      // attempts, each naming the exact phrase(s) found.
      const initialBanned = findBannedPhrases(generatedReply, channel);
      let banned = initialBanned;
      let attempts = 0;
      while (banned.length > 0 && attempts < 2) {
        attempts++;
        try {
          const retry = await client.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 1024,
            system: replySystemPrompt(mode, channel),
            messages: [
              { role: 'user', content: prompt },
              { role: 'assistant', content: generatedReply },
              {
                role: 'user',
                content:
                  `Your draft uses banned phrase${banned.length > 1 ? 's' : ''}: ` +
                  `${banned.map((b) => `"${b}"`).join(', ')}. Rewrite the message without ` +
                  `${banned.length > 1 ? 'them' : 'it'}, keeping everything else intact. ` +
                  'Output only the corrected message, plain text.',
              },
            ],
          });
          const rb = retry.content.find((b) => b.type === 'text');
          const rewritten = rb && rb.type === 'text' ? fillName(sanitizeReply(rb.text.trim())) : '';
          if (!rewritten) break;
          generatedReply = rewritten;
        } catch (e) {
          console.error('[reply-audit] banned-phrase rewrite failed:', e);
          break;
        }
        banned = findBannedPhrases(generatedReply, channel);
      }

      const findings: string[] = [];
      if (initialBanned.length > 0 && banned.length === 0) {
        findings.push(
          `removed banned phrase${initialBanned.length > 1 ? 's' : ''}: ` +
            initialBanned.map((b) => `"${b}"`).join(', ')
        );
      }

      // Layer 2: editor pass with the fixed checklist.
      const verdict = await runEditorPass(client, {
        draft: generatedReply,
        mode,
        channel,
        incomingEmail,
        threadContext: context || undefined,
        crmContext: crmContext || undefined,
      });
      if (verdict && !verdict.approved && verdict.revisedDraft) {
        generatedReply = fillName(sanitizeReply(verdict.revisedDraft));
        findings.push(...verdict.findings);
        // The editor's revision goes back through the mechanical check so a
        // revision can never smuggle a banned phrase past Layer 1.
        banned = findBannedPhrases(generatedReply, channel);
      } else if (verdict && !verdict.approved && verdict.findings.length > 0) {
        findings.push(...verdict.findings.map((f) => `flagged, not auto-fixed: ${f}`));
      }
      if (!verdict) {
        findings.push('editor pass failed to run, only the mechanical banned-phrase check applied');
      }

      // Never silently fail: a phrase that survived the retries is called out
      // by name so George can't be fooled into copying it.
      const warning =
        banned.length > 0
          ? `banned phrase${banned.length > 1 ? 's' : ''} still present: ` +
            banned.map((b) => `"${b}"`).join(', ')
          : null;
      if (warning) findings.push(warning);

      let passed: boolean | null;
      if (warning) passed = false;
      else if (!verdict) passed = null;
      else if (!verdict.approved && !verdict.revisedDraft && verdict.findings.length > 0)
        passed = false;
      else passed = true;

      audit = { passed, checked: auditCheckedSummary(mode), findings, warning };

      // A placeholder that survived to here means no contact was connected to
      // fill it. Never let it ship silently: the warning renders red in the
      // UI with "Do not copy as is".
      if (hasNamePlaceholder(generatedReply)) {
        const msg =
          'unfilled [name] placeholder in the draft — connect a contact or fill in the real name before sending';
        audit.findings.push(msg);
        audit.warning = audit.warning ? `${audit.warning}; ${msg}` : msg;
        audit.passed = false;
      }
    }

    // Save to history. A failed write shouldn't cost George the reply he just
    // waited for, so log it and return the text anyway. A review pass updates
    // edited_reply on the existing row; a fresh generate inserts a new row.
    let id: string | null = rowId || null;
    if (db && !isAuditOnly) {
      const supabase = db;
      if (isReview) {
        if (rowId) {
          const { error } = await supabase
            .from('reply_drafts')
            .update({ edited_reply: generatedReply })
            .eq('id', rowId);
          if (error) console.error('[reply-generator] update failed:', error.message);
        }
      } else {
        const { data, error } = await supabase
          .from('reply_drafts')
          .insert({
            mode,
            channel,
            incoming_email: incomingEmail.trim(),
            thread_context: context || null,
            generated_reply: generatedReply,
            contact_id: crmContext ? contactId : null,
            contact_table: crmContext ? contactTable : null,
            // Persistent audit record for a future voice.md refinement pass.
            audit_passed: audit ? audit.passed : null,
            audit_findings: audit && audit.findings.length ? audit.findings.join('\n') : null,
          })
          .select('id')
          .single();
        if (error) {
          console.error('[reply-generator] insert failed:', error.message);
          id = null;
        } else {
          id = data.id;
        }
      }
    }

    return NextResponse.json({ id, generatedReply, audit, contactConnected: !!crmContext });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      console.error('[reply-generator] auth error:', err.message);
      return NextResponse.json(
        { error: 'Invalid ANTHROPIC_API_KEY. Check your Vercel env var.' },
        { status: 500 }
      );
    }
    if (err instanceof Anthropic.RateLimitError) {
      console.error('[reply-generator] rate limit:', err.message);
      return NextResponse.json({ error: 'Rate limited. Try again in a moment.' }, { status: 429 });
    }
    if (err instanceof Anthropic.APIError) {
      console.error('[reply-generator] API error:', err.status, err.message);
      return NextResponse.json(
        { error: `Claude API error (${err.status}): ${err.message}` },
        { status: err.status || 500 }
      );
    }
    console.error('[reply-generator] unexpected error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
