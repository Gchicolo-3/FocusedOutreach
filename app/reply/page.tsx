'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import type { ReplyMode } from '@/lib/replyPrompts';
import { C, F, labelMono, card, btnPrimary, btnGhost, inputBase, pillStyle } from '@/lib/design';

const MODES: { id: ReplyMode; label: string; pill: 'teal' | 'accent' | 'purple' }[] = [
  { id: 'cre_referral', label: 'CRE / Referral', pill: 'teal' },
  { id: 'prospecting', label: 'Prospecting', pill: 'accent' },
  { id: 'internal', label: 'Internal', pill: 'purple' },
];

const MODE_STORAGE_KEY = 'reply-generator-mode';

type HistoryRow = {
  id: string;
  mode: ReplyMode;
  incoming_email: string;
  generated_reply: string;
  created_at: string;
};

function modeLabel(mode: ReplyMode): string {
  return MODES.find((m) => m.id === mode)?.label || mode;
}

function modePill(mode: ReplyMode): 'teal' | 'accent' | 'purple' | 'muted' {
  return MODES.find((m) => m.id === mode)?.pill || 'muted';
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

export default function ReplyPage() {
  const [mode, setMode] = useState<ReplyMode>('cre_referral');
  const [incomingEmail, setIncomingEmail] = useState('');
  const [threadContext, setThreadContext] = useState('');
  const [showContext, setShowContext] = useState(false);
  const [reply, setReply] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(MODE_STORAGE_KEY);
    if (saved && MODES.some((m) => m.id === saved)) setMode(saved as ReplyMode);
    setMounted(true);
    loadHistory();
  }, []);

  function pickMode(m: ReplyMode) {
    setMode(m);
    localStorage.setItem(MODE_STORAGE_KEY, m);
  }

  async function loadHistory() {
    const { data, error: err } = await supabase
      .from('reply_drafts')
      .select('id, mode, incoming_email, generated_reply, created_at')
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
          incomingEmail,
          threadContext: threadContext.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setReply(data.generatedReply);
      loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setGenerating(false);
    }
  }

  if (!mounted) return null;

  return (
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
        <div className="flex gap-2 flex-wrap">
          {MODES.map((m) => {
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => pickMode(m.id)}
                style={{
                  ...btnGhost,
                  background: active ? C.accentBg : 'transparent',
                  borderColor: active ? C.accent : C.border,
                  color: active ? C.accent : C.muted,
                  fontWeight: 600,
                }}
              >
                {m.label}
              </button>
            );
          })}
        </div>

        {/* Incoming email */}
        <div style={{ ...card, padding: 16 }} className="flex flex-col gap-3">
          <label style={labelMono}>Paste the email you&apos;re replying to</label>
          <textarea
            value={incomingEmail}
            onChange={(e) => setIncomingEmail(e.target.value)}
            rows={8}
            placeholder="Paste the full email here..."
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

        {/* Output */}
        {reply && (
          <div style={{ ...card, padding: 16 }} className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span style={labelMono}>Reply draft · {modeLabel(mode)}</span>
              <div className="flex gap-2">
                <button onClick={generate} disabled={generating} style={btnGhost}>
                  {generating ? '…' : 'Regenerate'}
                </button>
                <CopyButton text={reply} primary />
              </div>
            </div>
            <div
              style={{
                background: C.surface2,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: 14,
                whiteSpace: 'pre-wrap',
                fontFamily: F.body,
                fontSize: 14,
                lineHeight: 1.6,
              }}
            >
              {reply}
            </div>
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
                No replies generated yet.
              </div>
            ) : (
              history.map((h) => {
                const expanded = expandedId === h.id;
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
                        <div style={{ ...labelMono }}>Reply</div>
                        <div
                          style={{
                            whiteSpace: 'pre-wrap',
                            fontSize: 13,
                            fontFamily: F.body,
                            lineHeight: 1.6,
                          }}
                        >
                          {h.generated_reply}
                        </div>
                        <div>
                          <CopyButton text={h.generated_reply} />
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
  );
}
