// Audit / enforcement pass for the Reply Generator (/reply).
//
// Rules living in the generation prompt are not reliably followed under
// generation (a real Mode 1 draft shipped with no trigger and no ask while
// every rule sat in the system prompt). This module checks the OUTPUT:
//
//   Layer 1 — mechanical banned-phrase scan. Deterministic, case-insensitive
//   substring match against the list from docs/voice.md. No model call.
//   The route uses it to drive up to two regeneration attempts.
//
//   Layer 2 — one extra model call acting as an editor with a fixed
//   checklist: real closing ask (or concrete next deliverable for internal),
//   real trigger on reconnects, generic-AI phrasing, banned-phrase near
//   misses. Returns approved-as-is or a revised draft plus plain-English
//   findings.
//
// Server-side only — imported by app/api/reply-generator/route.ts.

import Anthropic from '@anthropic-ai/sdk';
import { GEORGE_VOICE_CORE } from './toneProfile';
import type { ReplyChannel, ReplyMode } from './replyPrompts';

// SYNCED FROM docs/voice.md (canonical) via GEORGE_VOICE_CORE's BANNED
// PHRASES line. Edit voice.md first, then mirror here. Lowercase, plain
// apostrophes — matching normalizes the draft the same way.
export const BANNED_PHRASES = [
  'hope this finds you well',
  'circling back',
  'touching base',
  'excited to connect',
  'just wanted to follow up',
  'pick your brain',
  'quick one for you',
  'quick question for you',
  'at your convenience',
  'leverage',
  'synergy',
  'innovative solutions',
  'i came across your profile',
  'no agenda',
  "i'd welcome a brief 15 minute call",
  'work the room',
  'throw a few dates my way',
  'lock it in',
  "i've been following your work",
  'impressed by',
  'babysitting the process',
  'not looking to pitch',
  'worth 5 minutes',
  "it's been a while",
  'seamless',
];

// voice.md bans this one only "when already sending a connection request".
const CONNECT_ONLY_BANNED = ['would love to connect'];

export function findBannedPhrases(text: string, channel: ReplyChannel): string[] {
  const hay = text.toLowerCase().replace(/[’‘]/g, "'");
  const list =
    channel === 'linkedin_connect' ? [...BANNED_PHRASES, ...CONNECT_ONLY_BANNED] : BANNED_PHRASES;
  return list.filter((p) => hay.includes(p));
}

// What the audit checked, shown verbatim to George. Internal mode swaps the
// closing-ask check for the concrete-deliverable check.
export function auditCheckedSummary(mode: ReplyMode): string {
  if (mode === 'internal') {
    return 'banned phrases, concrete next deliverable, AI-sounding phrasing, channel format';
  }
  if (mode === 'client_prospecting') {
    return 'banned phrases, real trigger, direct closing ask, AI-sounding phrasing, channel format, plain language';
  }
  return 'banned phrases, real trigger, direct closing ask, AI-sounding phrasing, channel format';
}

export type EditorVerdict = {
  approved: boolean;
  revisedDraft: string | null;
  findings: string[];
};

export type AuditOutcome = {
  // true = clean or every issue auto-corrected; false = a banned phrase
  // survived retries; null = the editor pass itself failed to run.
  passed: boolean | null;
  checked: string;
  findings: string[];
  // Set only when a banned phrase is still present after retries — George
  // must see this before copying anything.
  warning: string | null;
};

// What each channel's output must look like, for checklist item 5. Mirrors
// the channel blocks in lib/replyPrompts.ts.
function channelFormatRules(channel: ReplyChannel, mode: ReplyMode): string {
  const signoff = mode === 'internal' ? '"Thanks," then "George"' : '"Best," then "George"';
  switch (channel) {
    case 'email':
      return `EMAIL: first line "Subject: ..." then a blank line, body opens "Hey [first name],", closes with ${signoff} on two separate lines.`;
    case 'text':
      return 'TEXT MESSAGE: 2 to 3 short lines max. No subject line and NO sign-off — no "Best, George", no "Thanks, George", nothing after the message itself. Cold texts never include links.';
    case 'linkedin_connect':
      return 'LINKEDIN CONNECTION NOTE: hard limit 280 characters. No subject, no sign-off, no meeting ask (the connect is the ask).';
    case 'linkedin_message':
      return 'LINKEDIN MESSAGE: max 3 sentences. No subject line, no formal sign-off.';
  }
}

function editorSystemPrompt(mode: ReplyMode, channel: ReplyChannel): string {
  const closingCheck =
    mode === 'internal'
      ? `1. CLOSING: internal messages must end with a concrete next deliverable
   ("I'll have the layout over by Thursday"), not a vague "let me know" or an
   open-ended sign-off.`
      : `1. DIRECT CLOSING ASK: the message must end on something the recipient
   has to actually respond to — a direct question ("Coffee at Bellworks?",
   "Free for a call this week?") or a direct, unhedged statement that still
   functions as a clear next step. A statement of the sender's own
   willingness or availability FAILS this check even when it mentions the
   same activity a real ask would: "happy to grab coffee", "would love to
   chat", "let me know if you'd be open to...", "coffee sometime would be
   worth it" all fail. Trailing off with no close at all also fails. The
   test is NOT whether coffee or a call is mentioned — it's whether the
   recipient has something concrete to say yes or no to. When you fix this,
   rewrite the close into a direct question ("Coffee at Bellworks?"), never
   into a shortened version of the same passive structure.`;

  const jargonCheck =
    mode === 'client_prospecting'
      ? `
6. PLAIN LANGUAGE (client prospecting only): the reader is an end user
   company contact, not a CRE professional. Flag industry shorthand — "test
   fit", "work letter", "TI", "buildout" used as an unexplained noun, and
   similar CRE terms — and translate it to plain language that keeps the
   same substance, e.g. "we review test fits and work letters before a
   lease signs" becomes "we walk the space with you and check what the
   landlord's actually agreeing to build out, so you know what you're
   getting into before you're locked in." Keep the shorthand ONLY when the
   CRM context shows this specific recipient would know the terms (a
   facilities or real estate background, even at a non-CRE company).
   Default to plain language when uncertain.`
      : '';

  return `${GEORGE_VOICE_CORE}

YOU ARE THE EDITOR, NOT THE WRITER. A draft was generated for George and your
only job is to audit it against the fixed checklist below, then either approve
it untouched or minimally revise it. You never rewrite for taste. If a line
passes the checklist, it stays word for word — even if you'd phrase it
differently.

CHECKLIST (this is the entire audit; do not invent other criteria):
${closingCheck}
2. REAL TRIGGER (reconnects): if the situation is George reaching back out to
   someone he knows but hasn't talked to in a while, the message must lead
   with a real, specific, true trigger drawn from the provided context — a
   deal, a property, something they said, a referral. "Checking in", "wanted
   to see how things are going", "it's been a while" and anything in that
   family is soft filler, NOT a trigger, and fails this check even though
   some of those words can appear in an allowed opener. "Wanted to check in"
   is an allowed OPENER only when a real trigger or real ask follows it in
   the same message. Never invent a trigger that isn't in the context — if
   the context gives nothing, the fix is a direct honest reason plus a real
   ask, not a fabricated detail.
3. GENERIC AI PHRASING: stock transitions, unearned enthusiasm, restating the
   obvious, anything that reads like AI output instead of something a real
   person would type.
4. BANNED PHRASE NEAR MISSES: phrasing that means the same thing as a banned
   phrase without matching it exactly (e.g. "just wanted to see how things
   are" is "touching base" in disguise). The exact-match scan already ran;
   you catch the paraphrases.
5. CHANNEL FORMAT: the draft must match this channel's required shape.
   ${channelFormatRules(channel, mode)}
   A sign-off on a channel that forbids one, a missing subject line on email,
   or a blown length limit fails this check.${jargonCheck}

REVISION RULES, when a check fails:
- Change only what's needed to fix the failed check. Everything else stays
  word for word.
- The revision must obey every voice and channel format rule above (subject
  line for email, line limits for text/linkedin, sign-offs) and stay plain
  text, paste-ready.
- Findings are for George: short, plain English, name what was wrong and what
  you did about it. One string per issue.

OUTPUT: respond with ONLY a JSON object, no markdown fences, no commentary:
{"approved": true} when every check passes, or
{"approved": false, "revised_draft": "<full corrected message>", "findings": ["<issue and fix>", ...]}`;
}

function editorUserPrompt(args: {
  draft: string;
  incomingEmail: string;
  threadContext?: string;
  crmContext?: string;
  channel: ReplyChannel;
}): string {
  return [
    'WHAT GEORGE PASTED IN (the situation the draft responds to):',
    '--- pasted content ---',
    args.incomingEmail.trim(),
    '--- end pasted content ---',
    args.crmContext?.trim()
      ? `\nCRM CONTEXT, verified facts from George's records for this contact.\nA trigger drawn from these facts counts as a REAL trigger:\n--- crm context ---\n${args.crmContext.trim()}\n--- end crm context ---`
      : '',
    args.threadContext?.trim()
      ? `\n--- thread context ---\n${args.threadContext.trim()}\n--- end thread context ---`
      : '',
    `\nOUTPUT CHANNEL: ${args.channel}`,
    '',
    'THE DRAFT TO AUDIT:',
    '--- draft ---',
    args.draft,
    '--- end draft ---',
  ]
    .filter(Boolean)
    .join('\n');
}

// Tolerant JSON extraction: the model is told to output bare JSON, but a
// fenced or prefixed response shouldn't sink the audit.
function parseVerdict(text: string): EditorVerdict | null {
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
      revisedDraft: typeof obj.revised_draft === 'string' && obj.revised_draft.trim()
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

// Layer 2. Returns null when the call or parse fails — the route fails open
// (draft still returned) and records audit_passed = null.
export async function runEditorPass(
  client: Anthropic,
  args: {
    draft: string;
    mode: ReplyMode;
    channel: ReplyChannel;
    incomingEmail: string;
    threadContext?: string;
    crmContext?: string;
  }
): Promise<EditorVerdict | null> {
  try {
    const response = await client.messages.create({
      // Same model the generation call uses — this only ADDS a second call,
      // it does not touch the first one.
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: editorSystemPrompt(args.mode, args.channel),
      messages: [{ role: 'user', content: editorUserPrompt(args) }],
    });
    const block = response.content.find((b) => b.type === 'text');
    const text = block && block.type === 'text' ? block.text : '';
    return parseVerdict(text);
  } catch (err) {
    console.error('[reply-audit] editor pass failed:', err);
    return null;
  }
}
