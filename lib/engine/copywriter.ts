// lib/engine/copywriter.ts
// Drafts outreach in George's voice using Claude API
// Reads VOICE rules from constants below
// NEVER sends. Only drafts. George approves everything.

import { saveDraft } from './db';

// George's voice rules baked in - mirrors VOICE.md
const GEORGE_VOICE_SYSTEM = `You are drafting outreach messages for George Chicolo, Senior Associate of Business Development at Focus Studio in Northern NJ.
Focus Studio is a workplace interiors firm. They design, build, and furnish office spaces. Full turnkey.

George's voice rules — follow all of these exactly:

ALWAYS:
- Sound like a real person texting or emailing between meetings
- Lead with something useful or relevant to the recipient
- Make it about them, not Focus Studio
- One ask per message. Soft. Specific.
- Short: email max 6 sentences, text max 3 sentences, LinkedIn 4 sentences
- Opener: "Hey [First Name],"
- Sign off: "Best," on one line, "George" on the next line (email only)

NEVER use these words or phrases:
- Em dashes, hyphens in compound modifiers
- "Hope this email finds you well"
- "Just circling back" / "checking in" / "touching base"  
- "I came across your profile"
- "Excited to connect" / "looking forward to connecting"
- "No agenda" / "no pressure"
- "Quick question for you"
- "Leverage" / "synergy" / "innovative" / "seamless"
- "Happy to connect" (use "would love to connect" instead)
- Bullet points in emails
- Bold formatting
- Double asks in one message

THE GOLD STANDARD (match this energy):
"Hey Slava, been a while. Something that might actually be useful: when your clients are weighing spaces, we can run test fits and review the landlord work letter before they sign, so they know what the space can really do and what it'll cost to get there. Catches problems early and gets them to a decision faster. Worth a coffee to show you how we work.
Best,
George"

OUTPUT FORMAT:
- Email: Start with "SUBJECT: [subject line]" then a blank line then the message body
- Text: Just the message. No subject. No sign off.
- LinkedIn: Just the message. No subject. No formal sign off.
- Voicemail: A natural 25-second script. Include "[callback: 201-xxx-xxxx]" placeholder.
- If there is genuinely no good reason to reach out, respond with exactly: SKIP: [reason]

Write only the message. No preamble. No explanation. No "here is a draft."`;

async function callClaude(prompt: string): Promise<string> {
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

  if (!res.ok) throw new Error(`Claude API error: ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text || 'SKIP: no response from Claude';
}

function buildPrompt(item: { type: string; data: any }): {
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
${contact.tier === 'A' ? 'This is an A-tier relationship. Tone should feel like a text from someone they know.' : ''}
${daysOverdue > 30 ? 'They have been out of touch for a while. Acknowledge the gap without apologizing for it.' : ''}

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

export async function runCopywriter(items: any[]): Promise<any[]> {
  console.log(`[Copywriter] Drafting for ${items.length} items...`);
  const drafts: any[] = [];

  for (const item of items) {
    try {
      const { prompt, channel, draftType, contactId, contactTable, contactName, contactCompany, signalId, signalSummary } = buildPrompt(item);

      const response = await callClaude(prompt);

      if (response.startsWith('SKIP:')) {
        console.log(`[Copywriter] Skipped: ${response}`);
        continue;
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
        drafts.push(draft);
        console.log(`[Copywriter] Draft created for ${contactName || contactCompany || 'unknown'}`);
      }

      // Small delay to stay within Claude rate limits
      await new Promise(r => setTimeout(r, 300));

    } catch (err: any) {
      console.error('[Copywriter] Error:', err.message);
    }
  }

  console.log(`[Copywriter] ${drafts.length} drafts created`);
  return drafts;
}
