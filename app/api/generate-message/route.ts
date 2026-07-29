import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/serverSupabase';
import { GEORGE_TONE_PROFILE } from '@/lib/toneProfile';

export const dynamic = 'force-dynamic';
export const maxDuration = 30; // fast model returns in a few seconds

// Real messages George has saved as his voice. These are the strongest anchor
// for matching his tone, so they're injected ahead of the static examples.
async function fetchVoiceSamples(channel: string, limit = 6): Promise<string[]> {
  try {
    const supabase = getServerSupabase();
    // Prefer same-channel samples, then fall back to any channel.
    const { data } = await supabase
      .from('voice_samples')
      .select('text, channel')
      .order('created_at', { ascending: false })
      .limit(40);
    const rows = data || [];
    const sameChannel = rows.filter((r) => r.channel === channel).map((r) => r.text);
    const others = rows.filter((r) => r.channel !== channel).map((r) => r.text);
    return [...sameChannel, ...others].filter(Boolean).slice(0, limit);
  } catch {
    return [];
  }
}

type Channel = 'text' | 'email' | 'linkedin' | 'call';

type GenerateRequest = {
  contactName: string;
  company: string;
  channel: Channel;
  purpose?: string;
  intel?: string;
  broker?: string;
  opportunity?: string;
  lastTouch?: string;
};

// George's voice opens with "Hey [name]," never "Hi"/"Hello". The model
// occasionally slips despite the prompt, so enforce it deterministically on the
// greeting line (line-start "Hi/Hello <name>," → "Hey <name>,").
function enforceHeyOpener(text: string): string {
  return text.replace(
    /(^|\n)([ \t]*)(?:Hi|Hello)(\s+[^\n,]{1,40},)/g,
    '$1$2Hey$3'
  );
}

const channelInstructions: Record<Channel, string> = {
  text: 'Write a text message. Max 3 short lines. Casual, warm, punchy. Open with "Hey [first name] —". No subject line.',
  email:
    'Write an email. Max 4 sentences. Include a subject line on the first line prefixed with "Subject: " then a blank line, then the body. Open body with "Hey [first name]," and close with "Best, George".',
  linkedin:
    'Write a LinkedIn message. Max 3 sentences. Professional but warm and direct. No subject line.',
  call:
    'Write a phone call script opener. Max 3 sentences. Natural, not salesy. Open with "Hey [first name] —". No subject line.',
};

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY is not configured on the server.' },
      { status: 500 }
    );
  }

  let body: GenerateRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { contactName, company, channel, purpose, intel, broker, opportunity, lastTouch } = body;

  if (!contactName || !company || !channel) {
    return NextResponse.json(
      { error: 'Missing required fields: contactName, company, channel' },
      { status: 400 }
    );
  }

  const purposeText = (purpose || '').trim();

  const samples = await fetchVoiceSamples(channel);
  const voiceBlock = samples.length
    ? [
        'REAL MESSAGES GEORGE HAS ACTUALLY WRITTEN AND SENT. This is the ground',
        'truth of how he sounds — match this voice exactly (rhythm, length, word',
        'choice, how he opens and closes). This overrides the generic examples in',
        'your instructions if they ever conflict. Do NOT copy these messages; write',
        'a new one for this contact that sounds like the same person wrote it.',
        ...samples.map((s, i) => `--- sample ${i + 1} ---\n${s}`),
        '--- end samples ---',
        '',
      ].join('\n')
    : '';

  const prompt = [
    voiceBlock,
    `Contact: ${contactName}`,
    `Company: ${company}`,
    `Channel instruction: ${channelInstructions[channel] ?? channelInstructions.text}`,
    // The purpose is what the message is ABOUT. Intel is only background —
    // separated so the model writes the message George intends instead of
    // turning his notes into the subject of the email.
    purposeText
      ? `WHAT THIS MESSAGE IS ABOUT — write about this, this is the point: ${purposeText}`
      : 'No specific purpose given. This is a light relationship touch — keep it short and natural, do not manufacture a reason.',
    intel
      ? `Background on this person (for light personalization only — use at most one detail if it fits naturally; do NOT make the message about this and do NOT summarize it): ${intel}`
      : '',
    broker ? `Referring broker/source (mention naturally if relevant): ${broker}` : '',
    opportunity ? `Opportunity: ${opportunity}` : '',
    lastTouch ? `Last touch: ${lastTouch}` : 'First outreach',
    '',
    'Write only the message. No preamble, no quotes.',
  ]
    .filter(Boolean)
    .join('\n');

  const client = new Anthropic();

  try {
    // Fast, non-thinking model: short outreach messages don't need extended
    // thinking, and Opus + adaptive thinking was taking well over a minute and
    // timing out the request. Matches the model the engine copywriter uses.
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: GEORGE_TONE_PROFILE,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const raw = textBlock && textBlock.type === 'text' ? textBlock.text.trim() : '';

    if (!raw) {
      return NextResponse.json({ error: 'No text generated' }, { status: 500 });
    }

    return NextResponse.json({ message: enforceHeyOpener(raw) });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      console.error('[generate-message] auth error:', err.message);
      return NextResponse.json(
        { error: 'Invalid ANTHROPIC_API_KEY. Check your Vercel env var.' },
        { status: 500 }
      );
    }
    if (err instanceof Anthropic.RateLimitError) {
      console.error('[generate-message] rate limit:', err.message);
      return NextResponse.json({ error: 'Rate limited. Try again in a moment.' }, { status: 429 });
    }
    if (err instanceof Anthropic.APIError) {
      console.error('[generate-message] API error:', err.status, err.message);
      return NextResponse.json(
        { error: `Claude API error (${err.status}): ${err.message}` },
        { status: err.status || 500 }
      );
    }
    console.error('[generate-message] unexpected error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
