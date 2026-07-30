'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { buildSmsLink, composeInOutlook } from '@/lib/sendActions';
import type { ReplyChannel, ReplyMode } from '@/lib/replyPrompts';
import { C, F, labelMono, card, btnPrimary, btnSecondary, btnGhost, inputBase, pillStyle } from '@/lib/design';

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
  rating: 'good' | 'bad' | null;
  rating_note: string | null;
};

// Split an email-channel draft into its subject and body for the mailto /
// Outlook-draft handoff. Non-email drafts pass through as body only.
function splitDraftForEmail(draft: string): { subject: string; body: string } {
  const m = draft.match(/^subject:\s*(.+)\r?\n\r?\n?/i);
  if (!m) return { subject: '', body: draft.trim() };
  return { subject: m[1].trim(), body: draft.slice(m[0].length).trim() };
}

// Result of the server-side audit pass (banned phrases + editor checklist),
// shown under the draft so George sees a real check happened and what it
// caught. Shape mirrors the route's AuditOutcome.
type AuditSummary = {
  passed: boolean | null;
  checked: string;
  findings: string[];
  warning: string | null;
};

// A CRM contact George can connect a draft to via the search bar. The
// server loads the full row (tier, deals, last touch, notes, touch log) and
// feeds it to the generation and the audit's trigger check.
type ConnectedContact = {
  id: string;
  table: 'brokers' | 'partners' | 'prospects' | 'cold_brokers';
  name: string;
  company: string;
  // For the Open in Mail / Open in Text handoff.
  email: string;
  phone: string;
  mobile: string;
};

const contactTablePill: Record<ConnectedContact['table'], { label: string; pill: Pill }> = {
  brokers: { label: 'Broker', pill: 'purple' },
  partners: { label: 'Partner', pill: 'teal' },
  prospects: { label: 'Prospect', pill: 'accent' },
  cold_brokers: { label: 'Cold Broker', pill: 'blue' },
};

// Loads a slim name/company list from all four contact tables once, for the
// client-side typeahead. ~850 rows total, small columns — cheap to hold.
async function loadContactIndex(): Promise<ConnectedContact[]> {
  const [brokers, partners, prospects, cold] = await Promise.all([
    supabase.from('brokers').select('id, first_name, last_name, firm, email, phone, mobile'),
    supabase.from('partners').select('id, first_name, last_name, company, email, phone'),
    supabase.from('prospects').select('id, contact, company, email, phone'),
    supabase.from('cold_brokers').select('id, name, firm, email, phone, mobile'),
  ]);
  const out: ConnectedContact[] = [];
  for (const r of brokers.data || []) {
    out.push({
      id: r.id, table: 'brokers', name: `${r.first_name} ${r.last_name}`.trim(),
      company: r.firm || '', email: r.email || '', phone: r.phone || '', mobile: r.mobile || '',
    });
  }
  for (const r of partners.data || []) {
    out.push({
      id: r.id, table: 'partners', name: `${r.first_name} ${r.last_name}`.trim(),
      company: r.company || '', email: r.email || '', phone: r.phone || '', mobile: '',
    });
  }
  for (const r of prospects.data || []) {
    out.push({
      id: r.id, table: 'prospects', name: r.contact || '', company: r.company || '',
      email: r.email || '', phone: r.phone || '', mobile: '',
    });
  }
  for (const r of cold.data || []) {
    out.push({
      id: r.id, table: 'cold_brokers', name: r.name || '', company: r.firm || '',
      email: r.email || '', phone: r.phone || '', mobile: r.mobile || '',
    });
  }
  return out.filter((c) => c.name);
}

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
  const [audit, setAudit] = useState<AuditSummary | null>(null);
  // Contact connect: search over the CRM, pick the account this draft is for.
  const [contact, setContact] = useState<ConnectedContact | null>(null);
  const [contactQuery, setContactQuery] = useState('');
  const [contactIndex, setContactIndex] = useState<ConnectedContact[] | null>(null);
  // Feedback loop: opt-in thumbs on the generated draft, note on thumbs down.
  const [rating, setRating] = useState<'good' | 'bad' | null>(null);
  const [showRatingNote, setShowRatingNote] = useState(false);
  const [ratingNote, setRatingNote] = useState('');
  const [historyBadOnly, setHistoryBadOnly] = useState(false);
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

  // Lazily fill the typeahead index the first time George types in the
  // contact search.
  async function ensureContactIndex() {
    if (contactIndex) return;
    setContactIndex(await loadContactIndex());
  }

  const contactMatches =
    contactQuery.trim().length >= 2 && contactIndex
      ? contactIndex
          .filter((c) => {
            const q = contactQuery.trim().toLowerCase();
            return c.name.toLowerCase().includes(q) || c.company.toLowerCase().includes(q);
          })
          .slice(0, 8)
      : [];

  async function loadHistory() {
    const { data, error: err } = await supabase
      .from('reply_drafts')
      .select('id, mode, channel, incoming_email, generated_reply, edited_reply, created_at, rating, rating_note')
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
          contactId: contact?.id,
          contactTable: contact?.table,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setReply(data.generatedReply);
      setLastGenerated(data.generatedReply);
      setReplyId(data.id || null);
      setAudit(data.audit || null);
      setRating(null);
      setShowRatingNote(false);
      setRatingNote('');
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
      // The audit summary describes the generated draft; after a review pass
      // of George's own edits it no longer applies.
      setAudit(null);
      loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setReviewing(false);
    }
  }

  // Thumbs on the generated draft. Clicking the active thumb again clears it.
  // Opt-in — nothing in the flow depends on rating.
  async function rate(value: 'good' | 'bad') {
    if (!replyId) return;
    const next = rating === value ? null : value;
    setRating(next);
    setShowRatingNote(next === 'bad');
    if (next !== 'bad') setRatingNote('');
    const { error: err } = await supabase
      .from('reply_drafts')
      .update({ rating: next, ...(next === 'bad' ? {} : { rating_note: null }) })
      .eq('id', replyId);
    if (err) console.error('rate:', err);
    loadHistory();
  }

  async function saveRatingNote() {
    if (!replyId) return;
    const note = ratingNote.trim();
    const { error: err } = await supabase
      .from('reply_drafts')
      .update({ rating_note: note || null })
      .eq('id', replyId);
    if (err) console.error('saveRatingNote:', err);
    loadHistory();
  }

  // Open-in-app handoff, reusing the exact Do This Now mechanism
  // (composeInOutlook: Graph draft -> mailto fallback; sms: link for texts).
  function openInMail() {
    const { subject, body } = splitDraftForEmail(reply);
    composeInOutlook(contact?.email || '', subject, body);
  }

  // Texts never carry a subject line; strip one if the draft has it (only
  // happens when switching channel after generating an email draft).
  const smsHref =
    channel === 'text'
      ? buildSmsLink(contact?.mobile || contact?.phone || '', splitDraftForEmail(reply).body)
      : null;

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

          {/* Contact connect — search the CRM and tie this draft to the real
              account, so the model works from actual relationship facts
              (deals, last touch, notes) instead of guessing. */}
          <div>
            <label style={labelMono}>Connect contact (optional)</label>
            {contact ? (
              <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 6 }}>
                <span style={pillStyle(contactTablePill[contact.table].pill)}>
                  {contactTablePill[contact.table].label}
                </span>
                <span style={{ fontFamily: F.body, fontSize: 13, color: C.text }}>
                  {contact.name}
                  {contact.company ? ` · ${contact.company}` : ''}
                </span>
                <button
                  onClick={() => {
                    setContact(null);
                    setContactQuery('');
                  }}
                  title="Disconnect contact"
                  style={{ ...btnGhost, padding: '3px 9px', fontSize: 11 }}
                >
                  ✕
                </button>
              </div>
            ) : (
              <div style={{ position: 'relative', marginTop: 6 }}>
                <input
                  value={contactQuery}
                  onChange={(e) => setContactQuery(e.target.value)}
                  onFocus={ensureContactIndex}
                  placeholder="Search name or company to connect the account…"
                  style={{ ...inputBase, fontSize: 13 }}
                />
                {contactMatches.length > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 4px)',
                      left: 0,
                      right: 0,
                      zIndex: 20,
                      background: C.surface,
                      border: `1px solid ${C.border2}`,
                      borderRadius: 10,
                      overflow: 'hidden',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                    }}
                  >
                    {contactMatches.map((c) => (
                      <button
                        key={`${c.table}-${c.id}`}
                        onClick={() => {
                          setContact(c);
                          setContactQuery('');
                        }}
                        className="flex items-center gap-2"
                        style={{
                          display: 'flex',
                          width: '100%',
                          textAlign: 'left',
                          padding: '8px 12px',
                          background: 'transparent',
                          border: 'none',
                          borderBottom: `1px solid ${C.border}`,
                          cursor: 'pointer',
                        }}
                      >
                        <span style={pillStyle(contactTablePill[c.table].pill)}>
                          {contactTablePill[c.table].label}
                        </span>
                        <span style={{ fontFamily: F.body, fontSize: 13, color: C.text }}>
                          {c.name}
                        </span>
                        <span style={{ fontFamily: F.mono, fontSize: 11, color: C.muted }}>
                          {c.company}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {contactQuery.trim().length >= 2 && contactIndex && contactMatches.length === 0 && (
                  <div style={{ ...labelMono, marginTop: 4, textTransform: 'none', letterSpacing: 0 }}>
                    No matching account — draft will run without CRM context.
                  </div>
                )}
              </div>
            )}
          </div>

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
                {channel === 'email' && (
                  <button onClick={openInMail} style={btnSecondary} title={contact?.email ? `To: ${contact.email}` : 'Recipient left blank — fill it in the mail app'}>
                    ✉ Open in Mail
                  </button>
                )}
                {channel === 'text' && smsHref && (
                  <a href={smsHref} style={{ ...btnSecondary, textDecoration: 'none', display: 'inline-block' }} title={contact?.mobile || contact?.phone ? `To: ${contact.mobile || contact.phone}` : 'Recipient left blank — pick it in the messages app'}>
                    💬 Open in Text
                  </a>
                )}
                {replyId && (
                  <>
                    <button
                      onClick={() => rate('good')}
                      title="This one landed"
                      style={{ ...btnGhost, padding: '8px 10px', borderColor: rating === 'good' ? C.accent : C.border, color: rating === 'good' ? C.accent : C.muted }}
                    >
                      👍
                    </button>
                    <button
                      onClick={() => rate('bad')}
                      title="This one was off"
                      style={{ ...btnGhost, padding: '8px 10px', borderColor: rating === 'bad' ? C.red : C.border, color: rating === 'bad' ? C.red : C.muted }}
                    >
                      👎
                    </button>
                  </>
                )}
              </div>
            </div>
            {channel === 'text' && (
              <span style={{ color: C.muted2, fontSize: 11, fontFamily: F.body, marginTop: -6 }}>
                Open in Text works reliably on your phone; desktop browsers often have no app registered for sms links.
              </span>
            )}
            {showRatingNote && (
              <div className="flex items-center gap-2">
                <input
                  value={ratingNote}
                  onChange={(e) => setRatingNote(e.target.value)}
                  onBlur={saveRatingNote}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                  placeholder="What was off? (optional)"
                  style={{ ...inputBase, fontSize: 12, maxWidth: 420 }}
                />
              </div>
            )}
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
            {/* Audit summary — the visible record that a real check ran and
                what it caught. */}
            {audit && (
              <div
                style={{
                  background: C.surface2,
                  border: `1px solid ${audit.warning ? C.red : C.border}`,
                  borderRadius: 8,
                  padding: '10px 12px',
                  fontSize: 12,
                  fontFamily: F.mono,
                  lineHeight: 1.7,
                }}
              >
                <div style={{ color: C.muted }}>Checked: {audit.checked}</div>
                {audit.warning && (
                  <div style={{ color: C.red }}>⚠ Warning: {audit.warning}. Do not copy as is.</div>
                )}
                {audit.findings.length === 0 ? (
                  <div style={{ color: C.accent }}>No issues found</div>
                ) : (
                  audit.findings
                    .filter((f) => f !== audit.warning)
                    .map((f, i) => (
                      <div key={i} style={{ color: C.amber }}>
                        Fixed: {f}
                      </div>
                    ))
                )}
                {audit.passed === null && (
                  <div style={{ color: C.muted }}>
                    (editor pass unavailable this run, mechanical checks only)
                  </div>
                )}
              </div>
            )}
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

          {showHistory && (
            <div className="flex gap-2">
              <button
                onClick={() => setHistoryBadOnly((v) => !v)}
                style={{ ...(historyBadOnly ? btnPrimary : btnGhost), padding: '5px 10px', fontSize: 11 }}
              >
                👎 Rated bad only
              </button>
            </div>
          )}

          {showHistory &&
            (history.length === 0 ? (
              <div style={{ color: C.muted, fontSize: 13, fontFamily: F.body }}>
                No drafts generated yet.
              </div>
            ) : (
              history
                .filter((h) => !historyBadOnly || h.rating === 'bad')
                .map((h) => {
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
                      {h.rating && (
                        <span
                          title={h.rating === 'bad' ? h.rating_note || 'Rated bad' : 'Rated good'}
                          style={{ fontSize: 13, flexShrink: 0 }}
                        >
                          {h.rating === 'good' ? '👍' : '👎'}
                        </span>
                      )}
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
                        {h.rating === 'bad' && h.rating_note && (
                          <div style={{ fontSize: 12, color: C.red, fontFamily: F.body }}>
                            👎 {h.rating_note}
                          </div>
                        )}
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
  );
}
