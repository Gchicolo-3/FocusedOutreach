// lib/engine/draftAudit.ts
// Audit / enforcement pass for ENGINE drafts (the drafts table) — the same
// two layers the reply generator already runs on reply_drafts, adapted for
// outbound cadence and signal drafts:
//
//   Layer 1 — mechanical banned-phrase scan (shared list from
//   lib/replyAudit.ts, canonical source docs/voice.md). No model call.
//
//   Layer 2 — one editor model call with a fixed checklist: direct closing
//   ask, no soft-filler or fabricated triggers on check-ins, generic-AI
//   phrasing, banned-phrase near misses, channel format. Approves untouched
//   or minimally revises; revisions are applied to the draft body with the
//   original preserved in pre_audit_body.
//
// Runs in two places: inline at the end of each engine run (fresh drafts),
// and via POST /api/engine/audit in batches to work through the pending
// backlog. audited_at is the cursor — a draft is audited exactly once.
//
// Server-side only.

import Anthropic from '@anthropic-ai/sdk';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { GEORGE_VOICE_CORE } from '../toneProfile';
import { findBannedPhrases } from '../replyAudit';

const AUDIT_CONCURRENCY = 4;

function getSupabase(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

type DraftRow = {
  id: string;
  contact_name: string | null;
  contact_company: string | null;
  channel: string;
  subject: string | null;
  body: string;
  draft_type: string | null;
  signal_summary: string | null;
};

// What each engine channel's output must look like. Mirrors the copywriter's
// OUTPUT FORMAT block.
function channelFormatRules(channel: string): string {
  switch (channel) {
    case 'text':
      return 'TEXT MESSAGE: 2 to 3 short lines max. No subject line and NO sign-off — nothing after the message itself.';
    case 'linkedin':
      return 'LINKEDIN MESSAGE: short, no subject line, no formal sign-off.';
    case 'voicemail':
      return 'VOICEMAIL SCRIPT: a natural ~25-second spoken script.';
    default:
      return 'EMAIL: body opens "Hey [first name]," and closes with "Best," then "George" on separate lines. (The subject line is stored separately — its absence from the body is correct.)';
  }
}

// The trigger rule depends on what kind of draft this is. check_in drafts
// (30+ days of silence) are exactly where "just checking in" filler and
// invented triggers show up — the failure mode this audit exists to catch.
function triggerCheck(draftType: string | null): string {
  if (draftType === 'check_in') {
    return `2. CHECK-IN SUBSTANCE: this is a re-connection after 30+ days of silence.
   The message must lead with something real and specific — a concrete offer
   (test fits, work letter review), a real question about their pipeline, or
   a true detail from the provided notes. "Checking in", "wanted to see how
   things are going", "it's been a while" and that whole family is soft
   filler, NOT substance, and fails this check. NEVER invent a fake trigger
   (a deal, a meeting, a conversation that isn't in the provided context) —
   if there's nothing to reference, a direct honest reason plus a real ask
   is the fix, not a fabricated detail.`;
  }
  if (draftType === 'follow_up') {
    return `2. CONTINUATION: this follows a recent real touch. It must read as a
   continuation (reference or clearly build on the recent interaction), never
   as a re-connection. "Been a while" framing is an automatic fail. It must
   not fabricate specifics about the recent touch beyond what the context
   provides.`;
  }
  if (draftType === 'cold_intro') {
    return `2. COLD INTRO HONESTY: George has never connected with this person. The
   message must not imply any prior relationship, conversation, or meeting.
   "Reconnecting", "checking in", or referencing past interactions is an
   automatic fail.`;
  }
  return `2. REAL TRIGGER: if the message references news or a signal, it must match
   the provided signal summary — no invented specifics beyond it.`;
}

function editorSystemPrompt(draft: DraftRow): string {
  return `${GEORGE_VOICE_CORE}

YOU ARE THE EDITOR, NOT THE WRITER. An outbound draft was generated for
George and your only job is to audit it against the fixed checklist below,
then either approve it untouched or minimally revise it. You never rewrite
for taste. If a line passes the checklist, it stays word for word — even if
you'd phrase it differently.

CHECKLIST (this is the entire audit; do not invent other criteria):
1. DIRECT CLOSING ASK: the message must end on something the recipient has to
   actually respond to — a direct question ("Coffee at Bellworks?", "Free for
   a call this week?") or a direct, unhedged statement that still functions
   as a clear next step. A statement of the sender's own willingness or
   availability FAILS ("happy to grab coffee", "would love to chat", "let me
   know if you'd be open to..."). When you fix this, rewrite the close into a
   direct question, never a shortened version of the same passive structure.
${triggerCheck(draft.draft_type)}
3. GENERIC AI PHRASING: stock transitions, unearned enthusiasm, restating the
   obvious, anything that reads like AI output instead of something a real
   person would type. Also flag a dropped subject pronoun used on more than
   one sentence per message — once is George's real texture, stacked it reads
   as a checklist; restore the pronoun after the first use.
4. BANNED PHRASE NEAR MISSES: phrasing that means the same thing as a banned
   phrase without matching it exactly (e.g. "just wanted to see how things
   are" is "touching base" in disguise). The exact-match scan already ran;
   you catch the paraphrases.
5. CHANNEL FORMAT: ${channelFormatRules(draft.channel)}

REVISION RULES, when a check fails:
- Change only what's needed to fix the failed check. Everything else stays
  word for word.
- The revision must obey every voice and channel rule above and stay plain
  text, paste-ready. Do NOT add a subject line to the body.
- Findings are for George: short, plain English, name what was wrong and
  what you did about it. One string per issue.

OUTPUT: respond with ONLY a JSON object, no markdown fences, no commentary:
{"approved": true} when every check passes, or
{"approved": false, "revised_draft": "<full corrected message>", "findings": ["<issue and fix>", ...]}`;
}

function editorUserPrompt(draft: DraftRow): string {
  return [
    `DRAFT TYPE: ${draft.draft_type || 'unknown'}`,
    `CHANNEL: ${draft.channel}`,
    `RECIPIENT: ${draft.contact_name || 'unknown'}${draft.contact_company ? ` at ${draft.contact_company}` : ''}`,
    draft.signal_summary ? `SIGNAL CONTEXT (the only verified facts): ${draft.signal_summary}` : 'NO SIGNAL CONTEXT — the draft may not reference any specific news, deal, or conversation as if it were fact.',
    draft.subject ? `EMAIL SUBJECT (stored separately): ${draft.subject}` : '',
    '',
    'THE DRAFT TO AUDIT:',
    '--- draft ---',
    draft.body,
    '--- end draft ---',
  ]
    .filter(Boolean)
    .join('\n');
}

type Verdict = { approved: boolean; revisedDraft: string | null; findings: string[] };

function parseVerdict(text: string): Verdict | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as {
      approved?: unknown;
      revised_draft?: unknown;
      findings?: unknown;
    };
    if (typeof obj.approved !== 'boolean') return null;
    return {
      approved: obj.approved,
      revisedDraft:
        typeof obj.revised_draft === 'string' && obj.revised_draft.trim()
          ? obj.revised_draft.trim()
          : null,
      findings: Array.isArray(obj.findings)
        ? obj.findings.filter((f): f is string => typeof f === 'string' && !!f.trim())
        : [],
    };
  } catch {
    return null;
  }
}

async function runEditor(client: Anthropic, draft: DraftRow): Promise<Verdict | null> {
  try {
    const response = await client.messages.create({
      // Same model the copywriter uses — the audit only adds a second call.
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: editorSystemPrompt(draft),
      messages: [{ role: 'user', content: editorUserPrompt(draft) }],
    });
    const block = response.content.find((b) => b.type === 'text');
    return parseVerdict(block && block.type === 'text' ? block.text : '');
  } catch (err) {
    console.error('[draft-audit] editor pass failed:', err);
    return null;
  }
}

// The engine's channels map onto the reply audit's banned-list channels; none
// of the engine channels are LinkedIn connection notes, so the base list is
// always the right one.
function scanBanned(body: string): string[] {
  return findBannedPhrases(body, 'email');
}

// Audit one draft: banned scan -> editor pass -> apply revision -> re-scan.
// Writes the audit columns; returns the outcome for run counters.
async function auditOne(
  supabase: SupabaseClient,
  client: Anthropic,
  draft: DraftRow
): Promise<'passed' | 'fixed' | 'failed' | 'error'> {
  const findings: string[] = [];
  let body = draft.body;
  let revised = false;

  const bannedBefore = scanBanned(body);
  if (bannedBefore.length) {
    findings.push(`Banned phrase${bannedBefore.length > 1 ? 's' : ''}: ${bannedBefore.join(', ')}`);
  }

  const verdict = await runEditor(client, draft);

  let passed: boolean | null;
  if (!verdict) {
    // Editor pass failed to run: record the attempt (audited_at set so the
    // backlog drains), keep passed = null so the UI shows "not audited".
    passed = null;
  } else if (verdict.approved && !bannedBefore.length) {
    passed = true;
  } else {
    if (verdict.revisedDraft) {
      body = verdict.revisedDraft;
      revised = true;
    }
    findings.push(...verdict.findings);
    const bannedAfter = scanBanned(body);
    if (bannedAfter.length) {
      findings.push(`Still contains banned phrasing after revision: ${bannedAfter.join(', ')}`);
      passed = false;
    } else if (!verdict.approved && !verdict.revisedDraft) {
      // Editor flagged issues but supplied no fix — they survive.
      passed = false;
    } else {
      // Everything found was auto-corrected.
      passed = true;
    }
  }

  const update: Record<string, unknown> = {
    audit_passed: passed,
    audit_findings: findings.length ? findings.join(' · ') : null,
    audited_at: new Date().toISOString(),
  };
  if (revised && body !== draft.body) {
    update.pre_audit_body = draft.body;
    update.body = body;
  }

  const { error } = await supabase.from('drafts').update(update).eq('id', draft.id);
  if (error) {
    console.error(`[draft-audit] update failed for ${draft.id}:`, error.message);
    return 'error';
  }
  if (passed === null) return 'error';
  if (passed && !revised && !findings.length) return 'passed';
  return passed ? 'fixed' : 'failed';
}

export type AuditRunResult = {
  audited: number;
  passed: number;   // clean as generated
  fixed: number;    // issues found and auto-corrected
  failed: number;   // issues survived — flagged in the review UI
  errors: number;   // editor pass or write failed (will be retried: audited_at set only on write success)
  remaining: number; // unaudited pending drafts left after this batch
};

// Audit up to `limit` pending drafts that have never been audited, newest
// first (the ones most likely to be reviewed next). Safe to call repeatedly —
// audited_at is the cursor.
export async function auditPendingDrafts(limit: number): Promise<AuditRunResult> {
  const result: AuditRunResult = { audited: 0, passed: 0, fixed: 0, failed: 0, errors: 0, remaining: 0 };
  if (limit <= 0) return result;

  const supabase = getSupabase();
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const { data, error } = await supabase
    .from('drafts')
    .select('id, contact_name, contact_company, channel, subject, body, draft_type, signal_summary')
    .eq('status', 'pending')
    .is('audited_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`auditPendingDrafts read: ${error.message}`);

  const drafts = (data || []) as DraftRow[];
  let cursor = 0;
  async function worker() {
    while (cursor < drafts.length) {
      const draft = drafts[cursor++];
      const outcome = await auditOne(supabase, client, draft);
      result.audited++;
      if (outcome === 'passed') result.passed++;
      else if (outcome === 'fixed') result.fixed++;
      else if (outcome === 'failed') result.failed++;
      else result.errors++;
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(AUDIT_CONCURRENCY, drafts.length) }, () => worker())
  );

  const { count } = await supabase
    .from('drafts')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .is('audited_at', null);
  result.remaining = count || 0;

  return result;
}
