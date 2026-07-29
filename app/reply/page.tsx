'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import AuthGate from '@/components/AuthGate';
import type { ReplyChannel, ReplyMode } from '@/lib/replyPrompts';
import { C, F, labelMono, card, btnPrimary, btnGhost, inputBase, pillStyle } from '@/lib/design';

type Pill = 'teal' | 'accent' | 'purple' | 'amber' | 'blue' | 'muted';

const MODES: { id: ReplyMode; label: string; pill: Pill }[] = [
  { id: 'cre_referral', label: 'CRE / Referral', pill: 'teal' },
  { id: 'broker_prospecting', label: 'Broker Prospecting', pill: 'accent' },
  { id: 'client_prospecting', label: 'Client Prospecting', pill: 'amber' },
  { id: 'internal', label: 'Internal', pill: 'purple' },
];

const CHANNELS: { id: ReplyChannel; label: string }[] = [
  { id: 'email', label: 'Email' },
  { id: 'text', label: 'Text' },
  { id: 'linkedin_connect', label: 'LinkedIn Connect' },
  { id: 'linkedin_message', label: 'LinkedIn Message' },
];

const MODE_STORAGE_KEY = 'reply-generator-mode';
const CHANNEL_STORAGE_KEY = 'reply-generator-channel';

type HistoryRow = {
  id: string;
  mode: ReplyMode;
  channel: ReplyChannel;
  incoming_email: string;
  generated_reply: string;
  edited_reply: string | null;
  created_at: string;
};

function modeLabel(mode: ReplyMode): string {
  return MODES.find((m) => m.id === mode)?.label || mode;
}

function modePill(mode: ReplyMode): Pill {
  return MODES.find((m) => m.id === mode)?.pill || 'muted';
}

function channelLabel(channel: ReplyChannel): string {
  return CHANNELS.find((c) => c.id === channel)?.label || channel;
}

// Copy button with its own "Copied" feedback so multiple instances (output box
// + each history row) don't share state.
function CopyButton({ text, primary }: { text: string; primary?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      style={primary ? btnPrimary : btnGhost}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

const textareaStyle: React.CSSProperties = {
  ...inputBase,
  resize: 'vertical',
  lineHeight: 1.5,
  fontSize: 13,
};

const selectorBtn = (active: boolean): React.CSSProperties => ({
  ...btnGhost,
  background: active ? C.accentBg : 'transparent',
  borderColor: active ? C.accent : C.border,
  color: active ? C.accent : C.muted,
  fontWeight: 600,
});

export default function ReplyPage() {
  const [mode, setMode] = useState<ReplyMode>('cre_referral');
  const [channel, setChannel] = useState<ReplyChannel>('email');
  const [incomingEmail, setIncomingEmail] = useState('');
  const [threadContext, setThreadContext] = useState('');
  const [showContext, setShowContext] = useState(false);
  const [reply, setReply] = useState('');
  // What the model last returned, to detect hand edits, and the history row id
  // so a review pass lands on the right record.
  const [lastGenerated, setLastGenerated] = useState('');
  const [replyId, setReplyId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const savedMode = localStorage.getItem(MODE_STORAGE_KEY);
    if (savedMode && MODES.some((m) => m.id === savedMode)) setMode(savedMode as ReplyMode);
    const savedChannel = localStorage.getItem(CHANNEL_STORAGE_KEY);
    if (savedChannel && CHANNELS.some((c) => c.id === savedChannel)) {
      setChannel(savedChannel as ReplyChannel);
    }
    setMounted(true);
    loadHistory();
  }, []);

  function pickMode(m: ReplyMode) {
    setMode(m);
    localStorage.setItem(MODE_STORAGE_KEY, m);
  }

  function pickChannel(c: ReplyChannel) {
    setChannel(c);
    localStorage.setItem(CHANNEL_STORAGE_KEY, c);
  }

  async function loadHistory() {
    const { data, error: err } = await supabase
      .from('reply_drafts')
      .select('id, mode, channel, incoming_email, generated_reply, edited_reply, created_at')
      .order('created_at', { ascending: false })
      .limit(25);
    if (err) {
      console.error('loadHistory:', err);
      return;
    }
    setHistory((data as HistoryRow[]) || []);
  }

  async function generate() {
    if (!incomingEmail.trim() || generating) return;
    setGenerating(true);
    setError('');
    try {
      const res = await fetch('/api/reply-generator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          channel,
          incomingEmail,
          threadContext: threadContext.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setReply(data.generatedReply);
      setLastGenerated(data.generatedReply);
      setReplyId(data.id || null);
      loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setGenerating(false);
    }
  }

  // Run George's hand-edited draft back through the model to verify it against
  // the voice rules. Keeps his changes, fixes only real problems.
  async function reviewEdits() {
    if (!reply.trim() || reviewing || generating) return;
    setReviewing(true);
    setError('');
    try {
      const res = await fetch('/api/reply-generator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          channel,
          incomingEmail,
          threadContext: threadContext.trim() || undefined,
          editedReply: reply,
          id: replyId || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setReply(data.generatedReply);
      setLastGenerated(data.generatedReply);
      loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setReviewing(false);
    }
  }

  if (!mounted) return null;

  return (
    <AuthGate>
    <div style={{ background: C.bg, color: C.text, minHeight: '100vh' }}>
      <header style={{ borderBottom: `1px solid ${C.border}` }}>
        <div
          style={{ maxWidth: 900, margin: '0 auto', padding: '18px 20px' }}
          className="flex items-baseline justify-between flex-wrap gap-2"
        >
          <div className="flex items-baseline gap-3">
            <h1 style={{ fontFamily: F.display, fontSize: 20, fontWeight: 700 }}>Reply Generator</h1>
            <span style={labelMono}>paste, generate, copy</span>
          </div>
          <Link href="/" style={{ ...labelMono, color: C.muted, textDecoration: 'none' }}>
            ← Back to app
          </Link>
        </div>
      </header>

      <main
        style={{ maxWidth: 900, margin: '0 auto', padding: '24px 20px 48px' }}
        className="flex flex-col gap-4 fade-up"
      >
        {/* Mode selector */}
        <div className="flex flex-col gap-2">
          <span style={labelMono}>Who is this for</span>
          <div className="flex gap-2 flex-wrap">
            {MODES.map((m) => (
              <button key={m.id} onClick={() => pickMode(m.id)} style={selectorBtn(mode === m.id)}>
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Channel selector */}
        <div className="flex flex-col gap-2">
          <span style={labelMono}>Channel</span>
          <div className="flex gap-2 flex-wrap">
            {CHANNELS.map((c) => (
              <button
                key={c.id}
                onClick={() => pickChannel(c.id)}
                style={selectorBtn(channel === c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Incoming message / situation */}
        <div style={{ ...card, padding: 16 }} className="flex flex-col gap-3">
          <label style={labelMono}>
            Paste the email or message you&apos;re replying to, or notes on the situation
          </label>
          <textarea
            value={incomingEmail}
            onChange={(e) => setIncomingEmail(e.target.value)}
            rows={8}
            placeholder={
              'Paste the full email or text here...\n\nOr for fresh outreach, describe what you know: "Acme Corp is moving from Hoboken to Jersey City this fall, ~80 people, CFO is Jane Smith."'
            }
            style={textareaStyle}
          />

          {showContext ? (
            <>
              <label style={labelMono}>Thread context or background (optional)</label>
              <textarea
                value={threadContext}
                onChange={(e) => setThreadContext(e.target.value)}
                rows={5}
                placeholder="Earlier messages in the chain, or background notes..."
                style={textareaStyle}
              />
            </>
          ) : (
            <button
              onClick={() => setShowContext(true)}
              style={{
                background: 'none',
                border: 'none',
                color: C.muted,
                fontFamily: F.body,
                fontSize: 12,
                cursor: 'pointer',
                textAlign: 'left',
                padding: 0,
              }}
            >
              + Add thread context or background (optional)
            </button>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={generate}
              disabled={!incomingEmail.trim() || generating}
              style={{
                ...btnPrimary,
                opacity: !incomingEmail.trim() || generating ? 0.5 : 1,
                cursor: !incomingEmail.trim() || generating ? 'default' : 'pointer',
              }}
            >
              {generating ? 'Generating…' : 'Generate'}
            </button>
            {error && <span style={{ color: C.red, fontSize: 12, fontFamily: F.body }}>{error}</span>}
          </div>
        </div>

        {/* Output — editable so George can tweak lines directly, then run his
            version back through the model with "Check my edits". */}
        {(reply || lastGenerated) && (
          <div style={{ ...card, padding: 16 }} className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span style={labelMono}>
                Draft · {modeLabel(mode)} · {channelLabel(channel)} · editable
              </span>
              <div className="flex gap-2 flex-wrap">
                {reply.trim() !== lastGenerated.trim() && (
                  <button
                    onClick={reviewEdits}
                    disabled={reviewing || generating || !reply.trim()}
                    style={{ ...btnPrimary, opacity: reviewing ? 0.6 : 1 }}
                  >
                    {reviewing ? 'Checking…' : 'Check my edits'}
                  </button>
                )}
                <button onClick={generate} disabled={generating || reviewing} style={btnGhost}>
                  {generating ? '…' : 'Regenerate'}
                </button>
                <CopyButton text={reply} primary={reply.trim() === lastGenerated.trim()} />
              </div>
            </div>
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={Math.min(18, Math.max(6, reply.split('\n').length + 2))}
              style={{
                ...textareaStyle,
                fontSize: 14,
                lineHeight: 1.6,
                padding: 14,
              }}
            />
            {reply.trim() !== lastGenerated.trim() && (
              <span style={{ color: C.muted, fontSize: 12, fontFamily: F.body }}>
                You&apos;ve edited this draft. Check my edits runs your version back
                through the voice rules before you send it.
              </span>
            )}
          </div>
        )}

        {/* History */}
        <div style={{ ...card, padding: 16 }} className="flex flex-col gap-3">
          <button
            onClick={() => setShowHistory((s) => !s)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              textAlign: 'left',
            }}
            className="flex items-center justify-between"
          >
            <span style={{ fontFamily: F.display, fontSize: 15, fontWeight: 600, color: C.text }}>
              History
            </span>
            <span style={labelMono}>
              {history.length} recent {showHistory ? '▾' : '▸'}
            </span>
          </button>

          {showHistory &&
            (history.length === 0 ? (
              <div style={{ color: C.muted, fontSize: 13, fontFamily: F.body }}>
                No drafts generated yet.
              </div>
            ) : (
              history.map((h) => {
                const expanded = expandedId === h.id;
                const finalText = h.edited_reply || h.generated_reply;
                return (
                  <div
                    key={h.id}
                    style={{
                      background: C.surface2,
                      border: `1px solid ${C.border}`,
                      borderRadius: 10,
                      padding: 12,
                    }}
                    className="flex flex-col gap-2"
                  >
                    <button
                      onClick={() => setExpandedId(expanded ? null : h.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
                      className="flex items-center justify-between gap-2"
                    >
                      <span
                        style={{
                          color: C.muted,
                          fontSize: 12,
                          fontFamily: F.body,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          flex: 1,
                        }}
                      >
                        {h.incoming_email.slice(0, 110)}
                      </span>
                      <span style={pillStyle(modePill(h.mode))}>{modeLabel(h.mode)}</span>
                      <span style={pillStyle('muted')}>{channelLabel(h.channel)}</span>
                      <span style={labelMono}>{new Date(h.created_at).toLocaleDateString()}</span>
                    </button>

                    {expanded && (
                      <>
                        <div style={{ ...labelMono }}>Incoming</div>
                        <div
                          style={{
                            whiteSpace: 'pre-wrap',
                            fontSize: 12,
                            color: C.muted,
                            fontFamily: F.body,
                            lineHeight: 1.5,
                          }}
                        >
                          {h.incoming_email}
                        </div>
                        <div style={{ ...labelMono }}>
                          {h.edited_reply ? 'Draft (edited)' : 'Draft'}
                        </div>
                        <div
                          style={{
                            whiteSpace: 'pre-wrap',
                            fontSize: 13,
                            fontFamily: F.body,
                            lineHeight: 1.6,
                          }}
                        >
                          {finalText}
                        </div>
                        <div>
                          <CopyButton text={finalText} />
                        </div>
                      </>
                    )}
                  </div>
                );
              })
            ))}
        </div>
      </main>
    </div>
    </AuthGate>
  );
}
