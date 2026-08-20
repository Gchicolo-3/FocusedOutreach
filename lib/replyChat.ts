// lib/replyChat.ts
// System prompt + draft-envelope protocol for the conversational reply
// generator (/reply as a chat). Server-side and pure — the API route
// (app/api/reply-chat/route.ts) supplies the retrieved voice samples and
// contact context.
//
// STEERING ORDER IS THE POINT OF THIS MODULE: retrieved real messages
// (voice_samples) come FIRST as few-shot ground truth, the contact's CRM
// context second, mode/channel inference third, and the rules layer
// (GEORGE_VOICE_CORE, banned list) LAST — a constraint check, not the
// primary steering input.

import { GEORGE_VOICE_CORE } from './toneProfile';
import type { ReplyMode } from './replyPrompts';

// Draft envelope the model wraps every draft in. Parsed by the route and the
// UI; regex kept liberal on whitespace. The mode/channel attributes are how
// inference surfaces without dropdowns.
export const DRAFT_RE =
  /<<<DRAFT\s+mode=([a-z_0-9]+)\s+channel=([a-z_0-9]+)>>>\n?([\s\S]*?)\n?<<<END>>>/g;

export type ParsedDraft = {
  mode: string;
  channel: string;
  body: string;
};

export function parseDrafts(text: string): ParsedDraft[] {
  const out: ParsedDraft[] = [];
  for (const m of text.matchAll(DRAFT_RE)) {
    out.push({ mode: m[1], channel: m[2], body: m[3].trim() });
  }
  return out;
}

export type VoiceSampleRow = {
  text: string;
  mode: string | null;
  channel: string | null;
};

// The bank block. Samples arrive already ranked (matching mode/channel
// first); presented with their tags so the model leans on the ones matching
// the inferred mode/channel.
function voiceBankBlock(samples: VoiceSampleRow[]): string {
  if (!samples.length) {
    return `VOICE BANK: empty right now. Fall back on the gold-standard example and
rules below. As George saves approved drafts the bank becomes the primary
voice reference.`;
  }
  return [
    'VOICE BANK — real messages George wrote and approved, tagged by mode and',
    'channel. THIS IS THE PRIMARY VOICE REFERENCE, ranked above every rule',
    'below: match the rhythm, length, word choice, and how these open and',
    'close. Weight samples whose mode/channel match what you are drafting.',
    'Never copy one; write a new message the same person would have typed.',
    ...samples.map(
      (s, i) =>
        `--- sample ${i + 1}${s.mode ? ` [${s.mode}]` : ''}${s.channel ? ` [${s.channel}]` : ''} ---\n${s.text}`
    ),
    '--- end voice bank ---',
  ].join('\n');
}

// Compact mode definitions for inference — the full blocks live in
// lib/replyPrompts.ts (canonical source docs/voice.md); these carry just
// enough for the model to pick the right one from conversation.
const MODE_GUIDE = `MODES (infer from what George says — he never picks from a list):
- cre_referral (Mode 1, relationship): someone George already knows — brokers
  he works with, referral partners, industry friends. Warm, casual, light
  asks (coffee, lunch), relationship over transaction, no pitching unless
  asked.
- broker_prospecting (Mode 2a): a broker/landlord/developer George doesn't
  know well yet. Broker-focused positioning: Focus Studio makes their deals
  move faster and makes them look good to their client. Soft ask.
- client_prospecting (Mode 2b / direct prospect): an end-user company that is
  moving, growing, or looking at space. Plain language, no CRE jargon
  ("test fit" -> "we walk the space with you and check what the landlord's
  actually agreeing to build"), get in early, soft ask.
- internal: Peter or other Focus Studio team. No selling. Answer, plan,
  concrete next deliverable.

CHANNELS (also inferred — "shoot him a text", "connect request", "email him"):
- email: first line "Subject: ...", blank line, body opens "Hey [first name],"
  closes "Best,\\nGeorge" ("Thanks,\\nGeorge" for internal).
- text: 2-3 short lines max. No subject, NO sign-off.
- linkedin_connect: hard limit 280 characters. No subject, no sign-off, no
  meeting ask — the connect IS the ask.
- linkedin_message: max 3 sentences. No subject, no formal sign-off.
Default when truly unstated: email for anything substantive, text when the
conversation implies quick/casual and the relationship is warm.`;

const CONVERSATION_RULES = `HOW THIS CONVERSATION WORKS:
You are George's drafting partner. He describes a situation in his own words;
you draft; he reacts; you revise. There are no dropdowns and no regenerate
button — the conversation is the interface.

- Talk like a sharp colleague: brief, direct, no filler, no "Great question!".
  One or two sentences of your own voice around a draft is plenty.
- When George's message gives you enough to draft, DRAFT — don't interrogate
  him first. One clarifying question is allowed only when the draft would be
  a coin flip without it (who it's for, or a fact you'd otherwise invent).
- Wrap EVERY draft exactly like this, with the mode and channel you inferred:
<<<DRAFT mode=cre_referral channel=text>>>
[the message, plain text, paste-ready]
<<<END>>>
  Never put anything but the message itself inside the envelope. Multiple
  drafts in one reply are fine (e.g. an email and the text version) — each in
  its own envelope.
- When he reacts ("shorter", "too salesy", "make it a text"), revise and send
  a fresh envelope. Preserve everything he didn't criticize, word for word.
- If he changes the channel mid-conversation ("actually make it a connect
  request"), the new envelope's channel and format change accordingly.
- Never invent facts: no fake deals, meetings, conversations, or details
  beyond the CRM context and what George tells you. If you need a real
  detail to make the message land, ask for it instead of fabricating.
- RECENT-TOUCH RULE: when the context shows this contact was touched within
  the last 7 days, SAY SO unprompted before or alongside any draft ("you
  texted him 2 days ago — drafting this as a continuation, not a check-in")
  and never produce lapsed "reconnecting / been a while" framing for them.
- Drafts must be plain text: no markdown, no em dashes, no placeholder
  brackets when the real name is in the context.`;

export function replyChatSystemPrompt(args: {
  samples: VoiceSampleRow[];
  contactContext: string | null;
  recencyNote: string | null;
}): string {
  return [
    voiceBankBlock(args.samples),
    '',
    args.contactContext
      ? [
          "CONNECTED CONTACT — verified data from George's records. Ground every",
          'draft for this person in these facts; never invent beyond them:',
          '--- contact context ---',
          args.contactContext,
          '--- end contact context ---',
        ].join('\n')
      : 'NO CONTACT CONNECTED YET. If George names a person, work from what he says; suggest connecting the contact when their record would help.',
    args.recencyNote ? `\n${args.recencyNote}` : '',
    '',
    MODE_GUIDE,
    '',
    CONVERSATION_RULES,
    '',
    'RULES LAYER (constraints on every draft — secondary to the voice bank,',
    'checked mechanically after you write):',
    GEORGE_VOICE_CORE,
  ]
    .filter(Boolean)
    .join('\n');
}

// Sample retrieval ranking: matching mode/channel first, then the rest,
// newest first within each group. Keyword inference is deliberately shallow —
// it only biases which samples surface; the model does the real inference.
export function rankSamples(
  rows: Array<VoiceSampleRow & { created_at?: string }>,
  hint: { mode: ReplyMode | null; channelFamily: string | null }
): VoiceSampleRow[] {
  const score = (r: VoiceSampleRow): number => {
    let s = 0;
    if (hint.mode && r.mode === hint.mode) s += 2;
    if (hint.channelFamily && r.channel === hint.channelFamily) s += 1;
    return s;
  };
  return [...rows]
    .sort((a, b) => score(b) - score(a))
    .slice(0, 12)
    .map(({ text, mode, channel }) => ({ text, mode, channel }));
}

// Cheap keyword hints from the latest user message, used only to rank which
// bank samples get included.
export function inferHints(latestUserMessage: string): {
  mode: ReplyMode | null;
  channelFamily: string | null;
} {
  const t = (latestUserMessage || '').toLowerCase();
  let channelFamily: string | null = null;
  if (/linkedin|connect request|connection note/.test(t)) channelFamily = 'linkedin';
  else if (/\btext\b|\bsms\b|shoot (him|her|them) a text/.test(t)) channelFamily = 'text';
  else if (/email|subject line/.test(t)) channelFamily = 'email';

  let mode: ReplyMode | null = null;
  if (/peter|internal|team/.test(t)) mode = 'internal';
  else if (/cold broker|new broker|don'?t know|never met/.test(t)) mode = 'broker_prospecting';
  else if (/end user|client prospect|company.*(moving|growing|space)|tenant/.test(t)) mode = 'client_prospecting';
  return { mode, channelFamily };
}
