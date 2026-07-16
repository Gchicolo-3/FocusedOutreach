// lib/engine/copywriter.ts
// Drafts outreach in George's voice using Claude API
// Reads VOICE rules from constants below
// NEVER sends. Only drafts. George approves everything.

import { saveDraft, getRecentDraftBodiesForContacts } from './db';
import { GEORGE_VOICE_CORE } from '../toneProfile';

// George's voice rules. The shared core (voice, hard rules, banned phrases,
// structure, format) lives in GEORGE_VOICE_CORE so the dashboard compose route
// and this engine copywriter stay in sync. Only engine-specific drafting notes
// and output modes (SKIP, voicemail) are added below.
const GEORGE_VOICE_SYSTEM = `
${GEORGE_VOICE_CORE}

ENGINE DRAFTING NOTES (in addition to the core rules above):
- Lead with something useful or relevant to the recipient. Make it about them, not Focus Studio.
- Use "would love to connect" rather than "happy to connect."
- No bold formatting.
- Do not open by pointing out how long it has been since you last spoke. If an opener direction is given in the prompt, follow it.

THE GOLD STANDARD (match this energy):
"Hey Slava, something that might actually be useful: when your clients are weighing spaces, we can run test fits and review the landlord work letter before they sign, so they know what the space can really do and what it'll cost to get there. Catches problems early and gets them to a decision faster. Worth a coffee to show you how we work.
Best,
George"

OUTPUT FORMAT:
- Email: Start with "SUBJECT: [subject line]" then a blank line then the message body
- Text: Just the message. No subject. No sign off.
- LinkedIn: Just the message. No subject. No formal sign off.
- Voicemail: A natural 25-second script. Include "[callback: 201-xxx-xxxx]" placeholder.
- If there is genuinely no good reason to reach out, respond with exactly: SKIP: [reason]

Write only the message. No preamble. No explanation. No "here is a draft."`;

async function callClaude(prompt: string, attempt = 0): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system: GEORGE_VOICE_SYSTEM,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  // Back off and retry on rate limit / overload so a parallel batch doesn't
  // drop drafts under transient 429/529s.
  if ((res.status === 429 || res.status === 529) && attempt < 3) {
    await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    return callClaude(prompt, attempt + 1);
  }

  if (!res.ok) throw new Error(`Claude API error: ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text || 'SKIP: no response from Claude';
}

// Rotated per contact so a batch of cadence drafts doesn't converge on one
// opening line. Deterministic (hash of contact id) so re-drafting the same
// person stays consistent. Angles must not require facts we don't have.
const OPENER_ANGLES = [
  'Open with something useful you can offer right now: test fits, landlord work letter review, or a quick budget reality check.',
  'Open with a direct, friendly question about what they are working on or seeing in the market right now.',
  'Open by referencing the kind of deals or clients their firm handles and how you help those deals move faster.',
  'Open with a specific offer to jump in on anything in their current pipeline where a tenant is unsure about a space.',
  'Open with a short, concrete statement about what Focus Studio has been helping brokers with lately (keep it general, do not invent fake project details).',
  'Open warm and personal, like texting someone you know, and get to the point in the first sentence.',
];

function openerAngleFor(contactId?: string): string {
  const id = contactId || '';
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return OPENER_ANGLES[hash % OPENER_ANGLES.length];
}

// The first substantive line of a draft: what follows the "Hey Name," greeting
// and any SUBJECT: line. Used to show the model which openers are already
// taken so it doesn't converge on one high-probability first sentence.
export function extractOpener(body?: string | null): string {
  if (!body) return '';
  let text = body.trim();
  if (text.toUpperCase().startsWith('SUBJECT:')) {
    text = text.split('\n').slice(1).join('\n').trim();
  }
  text = text.replace(/^hey\s+[^,\n]{1,40},\s*/i, '');
  const firstLine = text.split('\n')[0].trim();
  return firstLine.length > 140 ? `${firstLine.slice(0, 140).trimEnd()}...` : firstLine;
}

// Prompt block listing openers the model must not imitate: this contact's
// recent drafts plus openers already produced in this batch.
export function buildAvoidOpenersBlock(avoidOpeners: string[]): string {
  const unique = [...new Set(avoidOpeners.map((o) => o.trim()).filter(Boolean))].slice(0, 8);
  if (!unique.length) return '';
  return `\nRecently used openers. Do NOT start your message like any of these, in wording or in structure:\n${unique
    .map((o) => `- "${o}"`)
    .join('\n')}\nYour first sentence must take a clearly different angle from all of the above.\n`;
}

function buildPrompt(item: { type: string; data: any }, avoidOpeners: string[] = []): {
  prompt: string;
  channel: string;
  draftType: string;
  contactId?: string;
  contactTable?: string;
  contactName?: string;
  contactCompany?: string;
  signalId?: string;
  signalSummary?: string;
} {
  const { type, data } = item;

  if (type === 'signal') {
    const isBrokerSignal = ['broker_deal_announced', 'broker_promotion', 'broker_firm_move', 'broker_award'].includes(data.signal_type);
    const channel = data.contact_id ? (data.tier === 'A' ? 'text' : 'email') : 'email';
    const draftType = isBrokerSignal ? 'congratulatory' : data.contact_id ? 'follow_up' : 'cold_intro';

    const prompt = `Draft a ${channel} outreach message.

${data.contact_name ? `Recipient: ${data.contact_name} at ${data.company_name || 'their firm'}` : `Cold prospect: ${data.company_name || 'unknown company'}`}
${data.tier ? `Relationship tier: ${data.tier}` : 'No prior relationship'}

Signal/reason to reach out: ${data.summary}
Signal type: ${data.signal_type}

${isBrokerSignal
  ? 'This is a congratulatory touch. Reference the specific news naturally. Keep it warm and brief.'
  : 'This is an end user growth signal. The company is likely going to need office space. Get in early before a broker is involved.'
}
${buildAvoidOpenersBlock(avoidOpeners)}
Channel: ${channel}`;

    return {
      prompt,
      channel,
      draftType,
      contactId: data.contact_id,
      contactTable: data.contact_table,
      contactName: data.contact_name,
      contactCompany: data.company_name,
      signalId: data.id,
      signalSummary: data.summary
    };
  }

  // Cadence touch
  const contact = data;
  const isBroker = contact.source_table === 'brokers';
  const channel = contact.tier === 'A' ? 'text' : 'email';
  const draftType = contact.last_touch ? 'check_in' : 'cold_intro';
  const daysOverdue = contact.days_overdue || 0;

  const prompt = `Draft a ${channel} ${draftType} message.

Recipient: ${contact.first_name} ${contact.last_name} at ${contact.company}
Contact type: ${isBroker ? 'Commercial real estate broker' : 'Business partner/referral source'}
Relationship tier: ${contact.tier}
Last touch: ${contact.last_touch || 'Never'}
Days since due: ${daysOverdue}
${contact.notes ? `Notes on this person: ${contact.notes}` : ''}

This is a scheduled cadence touch. No specific signal. Keep it natural and brief.
Opener direction: ${openerAngleFor(contact.id)} Do not comment on how long it has been since you last spoke.
${contact.tier === 'A' ? 'This is an A-tier relationship. Tone should feel like a text from someone they know.' : ''}
${buildAvoidOpenersBlock(avoidOpeners)}
Channel: ${channel}`;

  return {
    prompt,
    channel,
    draftType,
    contactId: contact.id,
    contactTable: contact.source_table,
    contactName: `${contact.first_name} ${contact.last_name}`,
    contactCompany: contact.company
  };
}

// Openers to steer this draft away from: the contact's recent draft openers
// plus the most recent openers already produced in this batch.
function avoidOpenersFor(
  contactId: string | undefined,
  contactOpeners: Map<string, string[]>,
  batchOpeners: string[]
): string[] {
  const own = contactId ? contactOpeners.get(contactId) || [] : [];
  return [...own, ...batchOpeners.slice(-5)];
}

// Process one item: build prompt, call Claude, save the draft. Returns the
// saved draft, or null if skipped/failed.
async function draftItem(
  item: any,
  contactOpeners: Map<string, string[]>,
  batchOpeners: string[]
): Promise<any | null> {
  try {
    const itemContactId = item?.data?.contact_id || item?.data?.id;
    const avoid = avoidOpenersFor(itemContactId, contactOpeners, batchOpeners);
    const { prompt, channel, draftType, contactId, contactTable, contactName, contactCompany, signalId, signalSummary } = buildPrompt(item, avoid);

    const response = await callClaude(prompt);

    if (response.startsWith('SKIP:')) {
      console.log(`[Copywriter] Skipped: ${response}`);
      return null;
    }

    // Parse subject for email
    let subject: string | undefined;
    let body = response;

    if (channel === 'email' && response.startsWith('SUBJECT:')) {
      const lines = response.split('\n');
      subject = lines[0].replace('SUBJECT:', '').trim();
      body = lines.slice(1).join('\n').trim();
    }

    const draft = await saveDraft({
      contact_id: contactId,
      contact_table: contactTable,
      contact_name: contactName,
      contact_company: contactCompany,
      signal_id: signalId,
      channel,
      subject,
      body,
      draft_type: draftType,
      signal_summary: signalSummary
    });

    if (draft) {
      console.log(`[Copywriter] Draft created for ${contactName || contactCompany || 'unknown'}`);
      const opener = extractOpener(response);
      if (opener) batchOpeners.push(opener);
      return draft;
    }
    return null;
  } catch (err: any) {
    console.error('[Copywriter] Error:', err.message);
    return null;
  }
}

// Bounded concurrency so a large cadence batch finishes well within Vercel's
// function timeout (a sequential loop over ~200 contacts blew past 300s and the
// run was killed before the digest sent). callClaude retries on 429/529.
const COPYWRITER_CONCURRENCY = 5;

export async function runCopywriter(items: any[]): Promise<any[]> {
  console.log(`[Copywriter] Drafting for ${items.length} items...`);
  const drafts: any[] = [];

  // Anti-repetition context: each contact's recent draft openers (one batched
  // query) plus a shared list of openers produced during this batch. Workers
  // read/append the shared list concurrently; slight staleness is fine — the
  // goal is variety, not exactness.
  const contactIds = items
    .map((i) => i?.data?.contact_id || i?.data?.id)
    .filter(Boolean);
  const recentBodies = await getRecentDraftBodiesForContacts(contactIds);
  const contactOpeners = new Map<string, string[]>();
  for (const [id, bodies] of recentBodies) {
    contactOpeners.set(id, bodies.map(extractOpener).filter(Boolean));
  }
  const batchOpeners: string[] = [];

  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor++];
      const draft = await draftItem(item, contactOpeners, batchOpeners);
      if (draft) drafts.push(draft);
    }
  }

  const workers = Array.from(
    { length: Math.min(COPYWRITER_CONCURRENCY, items.length) },
    () => worker()
  );
  await Promise.all(workers);

  console.log(`[Copywriter] ${drafts.length} drafts created`);
  return drafts;
}
