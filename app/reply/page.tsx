'use client';

// Reply Generator as a conversation. George connects a contact (the system
// loads everything it knows about them — no explaining who someone is),
// describes the situation in his own words, and drafts come back inside the
// chat. Reactions are just the next message; mode and channel are inferred
// from what he says, never picked from a dropdown. Approved drafts feed the
// voice bank with one click.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { saveVoiceSample } from '@/lib/storage';
import { C, F, labelMono, card as cardStyle, pillStyle, btnPrimary, btnGhost, inputBase } from '@/lib/design';

// ============ types ============

type ContactTable = 'brokers' | 'partners' | 'prospects' | 'cold_brokers';

type ConnectedContact = {
  id: string;
  table: ContactTable;
  name: string;
  company: string;
  email: string;
  phone: string;
  mobile: string;
  tier: string;
};

type ContactCard = {
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

type DraftInfo = { mode: string; channel: string; body: string; warnings: string[] };

type ChatMsg = {
  role: 'user' | 'assistant';
  content: string;
  drafts?: DraftInfo[];
};

type Pill = 'accent' | 'purple' | 'teal' | 'amber' | 'red' | 'blue' | 'muted';

const tablePill: Record<ContactTable, { label: string; pill: Pill }> = {
  brokers: { label: 'Broker', pill: 'purple' },
  partners: { label: 'Partner', pill: 'teal' },
  prospects: { label: 'Prospect', pill: 'accent' },
  cold_brokers: { label: 'Cold Broker', pill: 'blue' },
};

const MODE_LABEL: Record<string, string> = {
  cre_referral: 'Mode 1 · Relationship',
  broker_prospecting: 'Mode 2a · Broker',
  client_prospecting: 'Mode 2b · Client',
  internal: 'Internal',
};

const CHANNEL_LABEL: Record<string, string> = {
  email: 'Email',
  text: 'Text',
  linkedin_connect: 'LinkedIn Connect',
  linkedin_message: 'LinkedIn Msg',
};

// voice_samples.channel uses the channel family, not the reply channel.
function channelFamily(channel: string): string {
  return channel.startsWith('linkedin') ? 'linkedin' : channel;
}

// ============ contact index (client typeahead) ============

async function loadContactIndex(): Promise<ConnectedContact[]> {
  const [brokers, partners, prospects, cold] = await Promise.all([
    supabase.from('brokers').select('id, first_name, last_name, firm, email, phone, mobile, tier'),
    supabase.from('partners').select('id, first_name, last_name, company, email, phone'),
    supabase.from('prospects').select('id, contact, company, email, phone'),
    supabase.from('cold_brokers').select('id, name, firm, email, phone, mobile'),
  ]);
  const out: ConnectedContact[] = [];
  for (const r of brokers.data || []) {
    out.push({
      id: r.id, table: 'brokers', name: `${r.first_name} ${r.last_name}`.trim(),
      company: r.firm || '', email: r.email || '', phone: r.phone || '', mobile: r.mobile || '',
      tier: r.tier || '',
    });
  }
  for (const r of partners.data || []) {
    out.push({
      id: r.id, table: 'partners', name: `${r.first_name} ${r.last_name}`.trim(),
      company: r.company || '', email: r.email || '', phone: r.phone || '', mobile: '', tier: '',
    });
  }
  for (const r of prospects.data || []) {
    out.push({
      id: r.id, table: 'prospects', name: r.contact || '', company: r.company || '',
      email: r.email || '', phone: r.phone || '', mobile: '', tier: '',
    });
  }
  for (const r of cold.data || []) {
    out.push({
      id: r.id, table: 'cold_brokers', name: r.name || '', company: r.firm || '',
      email: r.email || '', phone: r.phone || '', mobile: r.mobile || '', tier: '',
    });
  }
  return out.filter((c) => c.name);
}

// ============ assistant message rendering ============

type Segment = { kind: 'text'; text: string } | { kind: 'draft'; draft: DraftInfo };

// Split an assistant message into prose and draft-card segments. Warnings
// come from the server's drafts array, matched by order.
function segmentMessage(content: string, drafts: DraftInfo[] | undefined): Segment[] {
  const re = /<<<DRAFT\s+mode=([a-z_0-9]+)\s+channel=([a-z_0-9]+)>>>\n?([\s\S]*?)\n?<<<END>>>/g;
  const segments: Segment[] = [];
  let last = 0;
  let draftIdx = 0;
  for (const m of content.matchAll(re)) {
    const before = content.slice(last, m.index).trim();
    if (before) segments.push({ kind: 'text', text: before });
    const fromServer = drafts?.[draftIdx];
    segments.push({
      kind: 'draft',
      draft: fromServer || { mode: m[1], channel: m[2], body: m[3].trim(), warnings: [] },
    });
    draftIdx++;
    last = (m.index || 0) + m[0].length;
  }
  const after = content.slice(last).trim();
  if (after) segments.push({ kind: 'text', text: after });
  if (!segments.length) segments.push({ kind: 'text', text: content });
  return segments;
}

// ============ page ============

export default function ReplyChatPage() {
  const [contactIndex, setContactIndex] = useState<ConnectedContact[] | null>(null);
  const [contact, setContact] = useState<ConnectedContact | null>(null);
  const [query, setQuery] = useState('');
  const [card, setCard] = useState<ContactCard | null>(null);
  const [cardLoading, setCardLoading] = useState(false);

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadContactIndex().then(setContactIndex).catch(() => setContactIndex([]));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const matches =
    query.trim().length >= 2 && contactIndex
      ? contactIndex
          .filter((c) => `${c.name} ${c.company}`.toLowerCase().includes(query.trim().toLowerCase()))
          .slice(0, 8)
      : [];

  async function connectContact(c: ConnectedContact) {
    setContact(c);
    setQuery('');
    setCard(null);
    setCardLoading(true);
    try {
      const res = await fetch('/api/reply-chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contactId: c.id, contactTable: c.table, messages: [] }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setCard(data.card || null);
    } finally {
      setCardLoading(false);
    }
  }

  function disconnectContact() {
    setContact(null);
    setCard(null);
  }

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setError(null);
    setInput('');
    const history = [...messages, { role: 'user' as const, content: text }];
    setMessages(history);
    setSending(true);
    try {
      const res = await fetch('/api/reply-chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contactId: contact?.id,
          contactTable: contact?.table,
          messages: history.map(({ role, content }) => ({ role, content })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `Request failed (HTTP ${res.status})`);
        // Put the message back in the box so nothing typed is lost.
        setMessages(messages);
        setInput(text);
      } else {
        setMessages([...history, { role: 'assistant', content: data.reply, drafts: data.drafts }]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setMessages(messages);
      setInput(text);
    }
    setSending(false);
    inputRef.current?.focus();
  }

  async function copyDraft(key: string, draft: DraftInfo) {
    try {
      await navigator.clipboard.writeText(draft.body);
      setCopied(key);
      setTimeout(() => setCopied((k) => (k === key ? null : k)), 1500);
    } catch {
      // clipboard unavailable — nothing to do
    }
  }

  async function saveToBank(key: string, draft: DraftInfo) {
    await saveVoiceSample(channelFamily(draft.channel), draft.body, {
      mode: draft.mode,
      source: 'reply_chat',
      contactName: contact?.name,
    });
    setSaved((prev) => new Set(prev).add(key));
  }

  function resetThread() {
    setMessages([]);
    setSaved(new Set());
    setError(null);
  }

  const empty = messages.length === 0;

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: '100vh' }}>
      <header style={{ borderBottom: `1px solid ${C.border}`, padding: '16px 20px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }} className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Link href="/" style={{ ...labelMono, textDecoration: 'none' }}>← Dashboard</Link>
            <h1 style={{ fontFamily: F.display, fontSize: 18, fontWeight: 700 }}>Reply Generator</h1>
          </div>
          {!empty && (
            <button onClick={resetThread} style={btnGhost} disabled={sending}>
              New conversation
            </button>
          )}
        </div>
      </header>

      <main style={{ maxWidth: 760, margin: '0 auto', padding: '20px 20px 140px' }}>
        {/* Contact connect */}
        <div style={{ marginBottom: 16 }}>
          {contact ? (
            <div style={{ ...cardStyle, padding: 14 }}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span style={{ fontFamily: F.body, fontWeight: 600, fontSize: 15 }}>{contact.name}</span>
                  {contact.company && <span style={{ ...labelMono }}>{contact.company}</span>}
                  <span style={pillStyle(tablePill[contact.table].pill)}>{tablePill[contact.table].label}</span>
                  {card?.tier && <span style={pillStyle('muted')}>Tier {card.tier}</span>}
                  {card && card.bucket !== 'active' && (
                    <span style={pillStyle('amber')}>{card.bucket.replace(/_/g, ' ')}</span>
                  )}
                </div>
                <button onClick={disconnectContact} style={{ ...btnGhost, padding: '4px 10px' }}>✕</button>
              </div>
              {cardLoading && <div style={{ ...labelMono, marginTop: 8 }}>Loading history…</div>}
              {card && (
                <div style={{ marginTop: 8, fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
                  <div style={{ color: card.touchedThisWeek ? C.amber : C.muted }}>
                    {card.lastTouch
                      ? `Last touch: ${card.lastTouch} (${card.lastTouchKind}, ${card.daysSinceTouch}d ago)` +
                        (card.touchedThisWeek ? ' — touched this week' : '')
                      : 'No touches on record'}
                    {card.recentDrafts > 0 ? ` · ${card.recentDrafts} recent draft${card.recentDrafts === 1 ? '' : 's'}` : ''}
                  </div>
                  {card.signals.slice(0, 2).map((sig, i) => (
                    <div key={i} style={{ color: '#c8a84a' }}>◆ {sig}</div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={contactIndex ? 'Connect a contact — search name or company…' : 'Loading contacts…'}
                disabled={!contactIndex}
                style={inputBase}
              />
              {matches.length > 0 && (
                <div
                  style={{
                    ...cardStyle, position: 'absolute', top: '100%', left: 0, right: 0,
                    zIndex: 20, marginTop: 4, overflow: 'hidden',
                  }}
                >
                  {matches.map((c) => (
                    <button
                      key={`${c.table}:${c.id}`}
                      onClick={() => connectContact(c)}
                      className="flex items-center gap-2"
                      style={{
                        display: 'flex', width: '100%', textAlign: 'left', padding: '10px 12px',
                        fontSize: 13, fontFamily: F.body, color: C.text, background: 'transparent',
                        borderBottom: `1px solid ${C.border}`, cursor: 'pointer',
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{c.name}</span>
                      {c.company && <span style={{ color: C.muted }}>{c.company}</span>}
                      <span style={{ marginLeft: 'auto' }}>
                        <span style={pillStyle(tablePill[c.table].pill)}>{tablePill[c.table].label}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Thread */}
        {empty && (
          <div style={{ ...cardStyle, padding: 24, textAlign: 'center', color: C.muted, fontSize: 13, lineHeight: 1.7 }}>
            Describe the situation in your own words — who it&apos;s for, what happened, what you want.
            <br />
            &ldquo;Ran into him at IOREBA, said he&apos;d send the Hoboken requirements — LinkedIn message following up.&rdquo;
            <br />
            Mode and channel are picked up from what you say. React to a draft to revise it.
          </div>
        )}

        <div className="flex flex-col gap-3">
          {messages.map((m, mi) => (
            <div key={mi} className="flex flex-col gap-2">
              {m.role === 'user' ? (
                <div
                  style={{
                    alignSelf: 'flex-end', maxWidth: '85%', background: C.surface2,
                    border: `1px solid ${C.border}`, borderRadius: '14px 14px 4px 14px',
                    padding: '10px 14px', fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                  }}
                >
                  {m.content}
                </div>
              ) : (
                segmentMessage(m.content, m.drafts).map((seg, si) => {
                  if (seg.kind === 'text') {
                    return (
                      <div
                        key={si}
                        style={{
                          alignSelf: 'flex-start', maxWidth: '90%', color: C.muted,
                          fontSize: 13, lineHeight: 1.6, padding: '2px 4px', whiteSpace: 'pre-wrap',
                        }}
                      >
                        {seg.text}
                      </div>
                    );
                  }
                  const d = seg.draft;
                  const key = `${mi}:${si}`;
                  return (
                    <div key={si} style={{ ...cardStyle, alignSelf: 'stretch', padding: 14 }}>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span style={pillStyle('accent')}>{MODE_LABEL[d.mode] || d.mode}</span>
                        <span style={pillStyle('blue')}>{CHANNEL_LABEL[d.channel] || d.channel}</span>
                        {d.channel === 'linkedin_connect' && (
                          <span style={{ ...labelMono, textTransform: 'none' }}>{d.body.length}/280</span>
                        )}
                      </div>
                      <div
                        style={{
                          marginTop: 10, fontFamily: F.body, fontSize: 14, lineHeight: 1.65,
                          whiteSpace: 'pre-wrap', color: C.text,
                        }}
                      >
                        {d.body}
                      </div>
                      {d.warnings.length > 0 && (
                        <div style={{ marginTop: 10, color: C.red, fontSize: 12, lineHeight: 1.5 }}>
                          ⚠ {d.warnings.join(' · ')}
                        </div>
                      )}
                      <div className="flex gap-2 flex-wrap" style={{ marginTop: 12 }}>
                        <button onClick={() => copyDraft(key, d)} style={btnPrimary}>
                          {copied === key ? 'Copied ✓' : 'Copy'}
                        </button>
                        {contact?.email && d.channel === 'email' && (
                          <a
                            href={`mailto:${contact.email}`}
                            style={{ ...btnGhost, textDecoration: 'none', display: 'inline-block' }}
                          >
                            Open in Mail
                          </a>
                        )}
                        <button
                          onClick={() => saveToBank(key, d)}
                          disabled={saved.has(key)}
                          style={{ ...btnGhost, color: saved.has(key) ? C.teal : C.muted }}
                          title="Save this approved draft into the voice bank as a few-shot example for future drafts."
                        >
                          {saved.has(key) ? 'In voice bank ✓' : '+ Voice bank'}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ))}
          {sending && <div style={{ ...labelMono, alignSelf: 'flex-start' }}>Drafting…</div>}
        </div>

        {error && (
          <div
            style={{
              marginTop: 12, background: C.redBg, border: `1px solid ${C.red}`,
              borderRadius: 10, padding: '10px 14px', color: C.red, fontSize: 13,
            }}
          >
            {error}
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      {/* Composer */}
      <div
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: C.bg, borderTop: `1px solid ${C.border}`,
          // Keep the composer clear of the iPhone home indicator (viewport-fit=cover).
          padding: '12px 20px calc(16px + env(safe-area-inset-bottom))',
        }}
      >
        <div style={{ maxWidth: 760, margin: '0 auto' }} className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={Math.min(5, Math.max(1, input.split('\n').length))}
            placeholder={
              contact
                ? `What's the situation with ${contact.name.split(' ')[0]}?`
                : 'Describe the situation… (connect a contact above for full context)'
            }
            style={{ ...inputBase, resize: 'none', lineHeight: 1.5 }}
            disabled={sending}
          />
          <button
            onClick={send}
            disabled={sending || !input.trim()}
            style={{ ...btnPrimary, opacity: sending || !input.trim() ? 0.5 : 1 }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
