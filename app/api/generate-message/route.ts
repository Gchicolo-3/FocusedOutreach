import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { GEORGE_TONE_PROFILE } from '@/lib/toneProfile';

type Channel = 'text' | 'email' | 'linkedin' | 'call';

type GenerateRequest = {
  contactName: string;
  company: string;
  channel: Channel;
  intel?: string;
  broker?: string;
  opportunity?: string;
  lastTouch?: string;
};

const channelInstructions: Record<Channel, string> = {
  text: 'Write a text message. Max 3 short lines. Casual, warm, punchy. Open with "Hey [first name] —". No subject line.',
  email:
    'Write an email. Max 4 sentences. Include a subject line on the first line prefixed with "Subject: " then a blank line, then the body. Open body with "Hi [first name]," and close with "Best, George".',
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

  const { contactName, company, channel, intel, broker, opportunity, lastTouch } = body;

  if (!contactName || !company || !channel) {
    return NextResponse.json(
      { error: 'Missing required fields: contactName, company, channel' },
      { status: 400 }
    );
  }

  const prompt = [
    `Contact: ${contactName}`,
    `Company: ${company}`,
    `Channel instruction: ${channelInstructions[channel] ?? channelInstructions.text}`,
    `Intel/context: ${intel || 'No specific intel — general outreach'}`,
    broker ? `Referring broker/source: ${broker}` : '',
    opportunity ? `Opportunity: ${opportunity}` : '',
    lastTouch ? `Last touch: ${lastTouch}` : 'First outreach',
    '',
    'Write only the message. No preamble, no quotes.',
  ]
    .filter(Boolean)
    .join('\n');

  const client = new Anthropic();

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      system: GEORGE_TONE_PROFILE,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const text = textBlock && textBlock.type === 'text' ? textBlock.text.trim() : '';

    if (!text) {
      return NextResponse.json({ error: 'No text generated' }, { status: 500 });
    }

    return NextResponse.json({ message: text });
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
