'use client';

// Pending Drafts Review Queue. One card at a time over every pending draft
// that came from a signal (the old copywriter engine wrote these before the
// audit pipeline existed). Each draft runs through the existing /reply audit
// (lib/replyAudit via /api/reply-generator's auditDraft path) before George
// sees it, so the queue never shows an unchecked draft. Approve copies the
// audited text and marks the row approved; Skip kills it; both advance.
//
// Deliberately narrower than the speced cadence-digest card queue — this only
// reviews existing pending signal drafts, it doesn't touch the engine, the
// cron, or how signals get created.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  getSignalDraftQueue,
  getContactsForSignalDrafts,
  resolveSignalDraft,
  type ResolvedContact,
  type SignalDraft,
} from '@/lib/storage';
import type { ReplyChannel, ReplyMode } from '@/lib/replyPrompts';
import { C, F, labelMono, card, btnPrimary, btnGhost, inputBase, pillStyle } from '@/lib/design';

// ---- audit plumbing -------------------------------------------------------

// Shape mirrors the reply-generator route's AuditOutcome, same as /reply.
type AuditSummary = {
  passed: boolean | null;
  checked: string;
  findings: string[];
  warning: string | null;
};

type AuditState =
  | { status: 'loading' }
  | { status: 'done'; text: string; audit: AuditSummary | null }
  | { status: 'error'; message: string };

// Which /reply voice mode audits this draft. The contact table is the
// strongest signal; with no resolvable contact, congratulatory drafts go to
// brokers about their announced deals and everything else (expansion, hires,
// acquisitions) targets the end user company itself.
function auditMode(d: SignalDraft): ReplyMode {
  if (d.contactTable === 'brokers' || d.contactTable === 'cold_brokers') return 'broker_prospecting';
  if (d.contactTable === 'partners') return 'cre_referral';
  if (d.contactTable === 'prospects') return 'client_prospecting';
  return d.draftType === 'congratulatory' ? 'broker_prospecting' : 'client_prospecting';
}

// Every signal draft the engine has written is an email today; the fallbacks
// keep a future text/linkedin draft from being audited against email rules.
function auditChannel(channel: string): ReplyChannel {
  if (channel === 'text') return 'text';
  if (channel === 'linkedin') return 'linkedin_message';
  return 'email';
}

// The audit runs on the same combined form /reply uses for email drafts —
// subject line first — so the channel format check sees the real shape.
function combinedText(d: SignalDraft): string {
  return auditChannel(d.channel) === 'email' && d.subject
    ? `Subject: ${d.subject}\n\n${d.body}`
    : d.body;
}

// What the editor pass audits the draft against: the actual trigger, stated
// as the situation. A trigger drawn from this counts as real for checklist
// item 2, exactly like pasted notes on /reply.
function triggerContext(d: SignalDraft, contact: ResolvedContact | null): string {
  const who = contact?.name || d.contactName;
  return [
    `News signal picked up about ${d.signalCompany || 'a company in Focus Studio\'s market'}:`,
    d.signalSummary,
    '',
    `George is sending fresh outreach reacting to this news${who ? ` to ${who}` : ''}. This is a first message about the signal, not a reply to anything received.`,
  ].join('\n');
}

function splitDraftForEmail(draft: string): { subject: string; body: string } {
  const m = draft.match(/^subject:\s*(.+)\r?\n\r?\n?/i);
  if (!m) return { subject: '', body: draft.trim() };
  return { subject: m[1].trim(), body: draft.slice(m[0].length).trim() };
}

// ---- presentation helpers -------------------------------------------------

const tierPill: Record<string, 'accent' | 'amber' | 'muted'> = {
  '1': 'accent',
  '2': 'amber',
};

function prettyType(t: string | null): string {
  return (t || '').replace(/_/g, ' ');
}

const textareaStyle: React.CSSProperties = {
  ...inputBase,
  resize: 'vertical',
  lineHeight: 1.6,
  fontSize: 14,
  padding: 14,
};

// ---- page -----------------------------------------------------------------

export default function ReviewQueuePage() {
  const [queue, setQueue] = useState<SignalDraft[] | null>(null);
  const [contacts, setContacts] = useState<Map<string, ResolvedContact>>(new Map());
  const [idx, setIdx] = useState(0);
  const [audits, setAudits] = useState<Record<string, AuditState>>({});
  // The editable draft text for the current card, seeded from its audit
  // result. textFor tracks which draft seeded it so a slow audit response
  // can't clobber the next card's text.
  const [text, setText] = useState('');
  const [textFor, setTextFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  // Audit requests already started, across renders (state updates lag).
  const started = useRef<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      const q = await getSignalDraftQueue();
      setContacts(await getContactsForSignalDrafts(q));
      setQueue(q);
    })();
  }, []);

  const contactFor = useCallback(
    (d: SignalDraft): ResolvedContact | null =>
      (d.contactTable && d.contactId && contacts.get(`${d.contactTable}:${d.contactId}`)) || null,
    [contacts]
  );

  const runAudit = useCallback(
    async (d: SignalDraft, force = false) => {
      if (!force && started.current.has(d.id)) return;
      started.current.add(d.id);
      setAudits((a) => ({ ...a, [d.id]: { status: 'loading' } }));
      try {
        const res = await fetch('/api/reply-generator', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: auditMode(d),
            channel: auditChannel(d.channel),
            incomingEmail: triggerContext(d, contactFor(d)),
            auditDraft: combinedText(d),
            contactId: d.contactId || undefined,
            contactTable: d.contactTable || undefined,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Audit request failed (${res.status})`);
        setAudits((a) => ({
          ...a,
          [d.id]: { status: 'done', text: data.generatedReply || combinedText(d), audit: data.audit || null },
        }));
      } catch (e) {
        setAudits((a) => ({
          ...a,
          [d.id]: { status: 'error', message: e instanceof Error ? e.message : 'Audit failed' },
        }));
      }
    },
    [contactFor]
  );

  // Audit the current card and prefetch the next one, so the
  // click-review-next rhythm never waits on the model twice in a row.
  useEffect(() => {
    if (!queue) return;
    for (const d of [queue[idx], queue[idx + 1]]) {
      if (d) runAudit(d);
    }
  }, [queue, idx, runAudit]);

  // Seed the editable text when the current card's audit resolves. An error
  // fails open to the raw draft — same philosophy as the /reply route.
  const current = queue?.[idx] || null;
  const currentAudit = current ? audits[current.id] : undefined;
  useEffect(() => {
    if (!current || textFor === current.id) return;
    if (currentAudit?.status === 'done') {
      setText(currentAudit.text);
      setTextFor(current.id);
    } else if (currentAudit?.status === 'error') {
      setText(combinedText(current));
      setTextFor(current.id);
    }
  }, [current, currentAudit, textFor]);

  function advance() {
    setReviewed((n) => n + 1);
    setIdx((i) => i + 1);
  }

  async function approve() {
    if (!current || busy || textFor !== current.id) return;
    setBusy(true);
    try {
      // Clipboard first — that's the point of Approve. A denied clipboard
      // shouldn't lose the review though, so fail open and keep going.
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        console.error('clipboard write failed — draft still approved');
      }
      const { subject, body } = splitDraftForEmail(text);
      await resolveSignalDraft(
        current.id,
        'approved',
        body !== current.originalBody || subject
          ? { subject: subject || null, body }
          : undefined
      );
      advance();
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    if (!current || busy) return;
    setBusy(true);
    try {
      await resolveSignalDraft(current.id, 'killed');
      advance();
    } finally {
      setBusy(false);
    }
  }

  const total = queue?.length || 0;
  const edited =
    currentAudit?.status === 'done' && textFor === current?.id && text.trim() !== currentAudit.text.trim();

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: '100vh' }}>
      <header style={{ borderBottom: `1px solid ${C.border}` }}>
        <div
          style={{ maxWidth: 780, margin: '0 auto', padding: '18px 20px' }}
          className="flex items-baseline justify-between flex-wrap gap-2"
        >
          <div className="flex items-baseline gap-3">
            <h1 style={{ fontFamily: F.display, fontSize: 20, fontWeight: 700 }}>Draft Review</h1>
            <span style={labelMono}>signal drafts · audited before you see them</span>
          </div>
          <Link href="/" style={{ ...labelMono, color: C.muted, textDecoration: 'none' }}>
            ← Back to app
          </Link>
        </div>
      </header>

      <main
        style={{ maxWidth: 780, margin: '0 auto', padding: '24px 20px 48px' }}
        className="flex flex-col gap-4 fade-up"
      >
        {!queue ? (
          <div style={{ ...labelMono, padding: 24, textAlign: 'center' }}>Loading queue…</div>
        ) : !current ? (
          // Caught up — either the queue was empty to begin with or George
          // just reviewed the last card.
          <div
            style={{ ...card, padding: 40, textAlign: 'center' }}
            className="flex flex-col gap-2 items-center"
          >
            <span style={{ fontSize: 28 }}>✓</span>
            <span style={{ fontFamily: F.display, fontSize: 18, fontWeight: 700 }}>
              You&apos;re caught up
            </span>
            <span style={{ color: C.muted, fontSize: 13, fontFamily: F.body }}>
              {reviewed > 0
                ? `${reviewed} signal draft${reviewed === 1 ? '' : 's'} reviewed. Nothing pending.`
                : 'No pending signal drafts to review.'}
            </span>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span style={labelMono}>
                {idx + 1} of {total}
              </span>
              <div className="flex gap-1.5 flex-wrap">
                <span style={pillStyle(tierPill[current.tierRecommendation] || 'muted')}>
                  Tier {current.tierRecommendation}
                </span>
                {current.signalType && (
                  <span style={pillStyle('blue')}>{prettyType(current.signalType)}</span>
                )}
                {current.draftType && (
                  <span style={pillStyle('muted')}>{prettyType(current.draftType)}</span>
                )}
              </div>
            </div>

            <div style={{ ...card, padding: 18 }} className="flex flex-col gap-3">
              {/* Company + the actual trigger, plain language */}
              <div>
                <div style={{ fontFamily: F.display, fontSize: 17, fontWeight: 700 }}>
                  {current.signalCompany || current.contactCompany || 'Unknown company'}
                </div>
                <div
                  style={{
                    marginTop: 8,
                    background: 'rgba(255,201,74,0.06)',
                    borderLeft: `2px solid ${C.amber}`,
                    borderRadius: '0 8px 8px 0',
                    padding: '8px 12px',
                    fontSize: 13,
                    color: '#c8a84a',
                    lineHeight: 1.5,
                  }}
                >
                  {current.signalSummary || 'No signal summary recorded.'}
                  {current.signalSourceUrl && (
                    <>
                      {' '}
                      <a
                        href={current.signalSourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: C.amber, textDecoration: 'underline' }}
                      >
                        {current.signalSourceName || 'Source'} ↗
                      </a>
                    </>
                  )}
                </div>
              </div>

              {/* Contact, when the id resolves to a real record */}
              {(() => {
                const c = contactFor(current);
                if (c) {
                  return (
                    <div style={{ fontSize: 13, fontFamily: F.body, color: C.text }}>
                      <span style={{ fontWeight: 600 }}>{c.name || current.contactName}</span>
                      {c.email && <span style={{ color: C.muted }}> · {c.email}</span>}
                      {c.phone && <span style={{ color: C.muted }}> · {c.phone}</span>}
                    </div>
                  );
                }
                return (
                  <div style={{ fontSize: 12, fontFamily: F.body, color: C.muted }}>
                    {current.contactName
                      ? `${current.contactName} — no matching CRM record`
                      : 'No contact attached — find the right person before sending'}
                  </div>
                );
              })()}

              {/* The draft, post-audit, editable */}
              {textFor === current.id ? (
                <>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={Math.min(16, Math.max(6, text.split('\n').length + 2))}
                    style={textareaStyle}
                  />
                  {currentAudit?.status === 'done' && currentAudit.audit && (
                    <div
                      style={{
                        background: C.surface2,
                        border: `1px solid ${currentAudit.audit.warning ? C.red : C.border}`,
                        borderRadius: 8,
                        padding: '10px 12px',
                        fontSize: 12,
                        fontFamily: F.mono,
                        lineHeight: 1.7,
                      }}
                    >
                      <div style={{ color: C.muted }}>Checked: {currentAudit.audit.checked}</div>
                      {currentAudit.audit.warning && (
                        <div style={{ color: C.red }}>
                          ⚠ Warning: {currentAudit.audit.warning}. Do not copy as is.
                        </div>
                      )}
                      {currentAudit.audit.findings.length === 0 ? (
                        <div style={{ color: C.accent }}>No issues found</div>
                      ) : (
                        currentAudit.audit.findings
                          .filter((f) => f !== currentAudit.audit!.warning)
                          .map((f, i) => (
                            <div key={i} style={{ color: C.amber }}>
                              Fixed: {f}
                            </div>
                          ))
                      )}
                      {currentAudit.audit.passed === null && (
                        <div style={{ color: C.muted }}>
                          (editor pass unavailable this run, mechanical checks only)
                        </div>
                      )}
                    </div>
                  )}
                  {currentAudit?.status === 'error' && (
                    <div
                      style={{
                        background: C.surface2,
                        border: `1px solid ${C.red}`,
                        borderRadius: 8,
                        padding: '10px 12px',
                        fontSize: 12,
                        fontFamily: F.mono,
                        lineHeight: 1.7,
                        color: C.red,
                      }}
                      className="flex items-center justify-between gap-2 flex-wrap"
                    >
                      <span>
                        ⚠ Audit couldn&apos;t run ({currentAudit.message}) — this is the raw,
                        unchecked draft.
                      </span>
                      <button onClick={() => runAudit(current, true)} style={{ ...btnGhost, padding: '4px 10px', fontSize: 11 }}>
                        Retry audit
                      </button>
                    </div>
                  )}
                  {edited && (
                    <span style={{ color: C.muted, fontSize: 12, fontFamily: F.body }}>
                      Edited — Approve copies and saves your version.
                    </span>
                  )}
                </>
              ) : (
                <div
                  style={{
                    background: C.surface2,
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    padding: '18px 14px',
                    fontSize: 13,
                    fontFamily: F.mono,
                    color: C.muted,
                  }}
                >
                  Running audit… banned phrases, closing ask, trigger, format.
                </div>
              )}

              <div className="flex gap-2 flex-wrap items-center">
                <button
                  onClick={approve}
                  disabled={busy || textFor !== current.id || !text.trim()}
                  style={{
                    ...btnPrimary,
                    opacity: busy || textFor !== current.id || !text.trim() ? 0.5 : 1,
                  }}
                  title="Copy the draft and mark it approved"
                >
                  ✓ Approve + Copy
                </button>
                <button
                  onClick={skip}
                  disabled={busy}
                  style={{ ...btnGhost, color: C.red, opacity: busy ? 0.5 : 1 }}
                  title="Kill this draft — nothing gets used"
                >
                  Skip
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
