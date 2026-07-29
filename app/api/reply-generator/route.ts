import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
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
};

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
  const prompt = [
    voiceBlock,
    'WHAT GEORGE PASTED IN (a message he received to reply to, or notes on a',
    'situation for fresh outreach):',
    '--- pasted content ---',
    incomingEmail.trim(),
    '--- end pasted content ---',
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
      generatedReply = sanitizeReply(body.auditDraft!.trim());
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

      generatedReply = sanitizeReply(raw);
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
          const rewritten = rb && rb.type === 'text' ? sanitizeReply(rb.text.trim()) : '';
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
      });
      if (verdict && !verdict.approved && verdict.revisedDraft) {
        generatedReply = sanitizeReply(verdict.revisedDraft);
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
    }

    // Save to history. A failed write shouldn't cost George the reply he just
    // waited for, so log it and return the text anyway. A review pass updates
    // edited_reply on the existing row; a fresh generate inserts a new row.
    let id: string | null = rowId || null;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url && key && !isAuditOnly) {
      const supabase = createClient(url, key);
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

    return NextResponse.json({ id, generatedReply, audit });
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
