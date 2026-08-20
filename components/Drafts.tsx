'use client';

import { useState, useEffect } from 'react';
import type { GenerateChannel } from '@/lib/toneProfile';
import type { Channel } from '@/types';
import {
  getPendingEngineDrafts,
  setEngineDraftStatus,
  getBrokers,
  getPartners,
  getProspects,
  getColdBrokers,
  getSignalSources,
  recordOutreachTouch,
  type EngineDraft,
  type SignalSource,
} from '@/lib/storage';
import MessageCard from '@/components/MessageCard';
import { C, F, labelMono, btnGhost, pillStyle } from '@/lib/design';

type ContactInfo = { email?: string; phone?: string };

const channelPill: Record<string, 'blue' | 'amber' | 'purple' | 'accent'> = {
  text: 'blue',
  email: 'amber',
  linkedin: 'purple',
  call: 'accent',
  voicemail: 'accent',
};

// Only channels MessageCard knows how to compose. Others fall back to email.
function toGenerateChannel(ch: string): GenerateChannel {
  return ch === 'text' || ch === 'linkedin' || ch === 'call' ? ch : 'email';
}

// touch_log's Channel type has no 'voicemail'; fold it into 'call', everything
// else unknown into 'email'.
function toTouchChannel(ch: string): Channel {
  if (ch === 'text' || ch === 'linkedin' || ch === 'call' || ch === 'email') return ch;
  if (ch === 'voicemail') return 'call';
  return 'email';
}

export default function Drafts() {
  const [drafts, setDrafts] = useState<EngineDraft[]>([]);
  const [info, setInfo] = useState<Map<string, ContactInfo>>(new Map());
  const [sources, setSources] = useState<Map<string, SignalSource>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [auditStatus, setAuditStatus] = useState<string | null>(null);

  async function load() {
    const [d, brokers, partners, prospects, cold] = await Promise.all([
      getPendingEngineDrafts(),
      getBrokers(),
      getPartners(),
      getProspects(),
      getColdBrokers(),
    ]);
    setSources(await getSignalSources(d.map((x) => x.signalId).filter((x): x is string => !!x)));
    const m = new Map<string, ContactInfo>();
    brokers.forEach((b) => m.set(`brokers:${b.id}`, { email: b.email, phone: b.mobile || b.phone }));
    partners.forEach((p) => m.set(`partners:${p.id}`, { email: p.email, phone: p.phone }));
    prospects.forEach((p) => m.set(`prospects:${p.id}`, { email: p.email, phone: p.phone }));
    cold.forEach((c) => m.set(`cold_brokers:${c.id}`, { email: c.email, phone: c.mobile || c.phone }));
    setInfo(m);
    setDrafts(d);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  // Works through the unaudited backlog batch by batch (the server audits 20
  // per call) until nothing pending is left unaudited, then reloads so fresh
  // audit pills and any auto-corrected bodies show up.
  async function runAudit() {
    setAuditing(true);
    setAuditStatus('Auditing…');
    let passed = 0;
    let fixed = 0;
    let failed = 0;
    try {
      // Hard iteration cap so a stuck server can't loop forever.
      for (let i = 0; i < 50; i++) {
        const res = await fetch('/api/engine/audit-trigger', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setAuditStatus(data?.error || `Audit failed (HTTP ${res.status})`);
          setAuditing(false);
          return;
        }
        passed += data.passed || 0;
        fixed += data.fixed || 0;
        failed += data.failed || 0;
        const remaining = data.remaining ?? 0;
        setAuditStatus(`Audited ${passed + fixed + failed} · ${remaining} left…`);
        if (remaining <= 0 || (data.audited || 0) === 0) break;
      }
      setAuditStatus(
        `Audit done: ${passed} clean · ${fixed} auto-corrected · ${failed} flagged`
      );
      await load();
    } catch (err) {
      setAuditStatus(err instanceof Error ? err.message : 'Audit failed');
    }
    setAuditing(false);
  }

  async function resolve(d: EngineDraft, status: 'sent' | 'killed') {
    setBusy(d.id);
    await setEngineDraftStatus(d.id, status);
    // "Sent" is a completed outreach action: write the touch AND advance the
    // contact's cadence (last_touch + next_due) in one call, so the queue
    // actually drains. "Dismiss" (killed) is a rejection, logs nothing.
    if (status === 'sent' && d.contactId) {
      await recordOutreachTouch(d.contactTable, d.contactId, toTouchChannel(d.channel));
    }
    setDrafts((prev) => prev.filter((x) => x.id !== d.id));
    setBusy(null);
  }

  if (loading) {
    return <div style={{ ...labelMono, padding: 24, textAlign: 'center' }}>Loading drafts…</div>;
  }

  return (
    <div className="flex flex-col gap-4 fade-up">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 style={{ fontFamily: F.display, fontSize: 18, fontWeight: 700, color: C.text }}>
          Drafts
        </h2>
        <div className="flex items-center gap-3 flex-wrap">
          {auditStatus && <span style={labelMono}>{auditStatus}</span>}
          {drafts.some((d) => d.auditPassed === null) && (
            <button
              onClick={runAudit}
              disabled={auditing}
              style={{ ...btnGhost, opacity: auditing ? 0.6 : 1 }}
              title="Run the banned-phrase + editor audit over every pending draft that hasn't been audited yet."
            >
              {auditing ? 'Auditing…' : 'Audit unaudited drafts'}
            </button>
          )}
          <span style={labelMono}>
            {drafts.length} waiting{drafts.length >= 60 ? '+ (newest first)' : ''}
          </span>
        </div>
      </div>

      {drafts.length === 0 ? (
        <div
          style={{
            background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12,
            padding: 28, textAlign: 'center', color: C.muted,
          }}
        >
          No drafts waiting. The engine drops new ones here each morning.
        </div>
      ) : (
        drafts.map((d) => {
          const ci = (d.contactTable && d.contactId && info.get(`${d.contactTable}:${d.contactId}`)) || {};
          return (
            <div
              key={d.id}
              style={{
                background: C.surface,
                border: `1px solid ${C.border}`,
                borderRadius: 14,
                padding: 18,
              }}
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <span style={{ fontFamily: F.display, fontWeight: 600, fontSize: 15, color: C.text }}>
                    {d.contactName || 'Unknown'}
                  </span>
                  {d.contactCompany && (
                    <span style={{ ...labelMono, marginLeft: 8 }}>{d.contactCompany}</span>
                  )}
                </div>
                <div className="flex gap-1.5">
                  <span style={pillStyle(channelPill[d.channel] || 'muted')}>{d.channel}</span>
                  {d.draftType && <span style={pillStyle('muted')}>{d.draftType.replace(/_/g, ' ')}</span>}
                  {d.auditPassed === true && <span style={pillStyle('teal')}>audited ✓</span>}
                  {d.auditPassed === false && <span style={pillStyle('red')}>audit ⚠</span>}
                  {d.auditPassed === null && <span style={pillStyle('muted')}>unaudited</span>}
                </div>
              </div>

              {d.auditFindings && (
                <div
                  style={{
                    marginTop: 10,
                    background: d.auditPassed === false ? 'rgba(255,107,107,0.06)' : 'rgba(74,255,212,0.05)',
                    borderLeft: `2px solid ${d.auditPassed === false ? C.red : C.teal}`,
                    borderRadius: '0 8px 8px 0',
                    padding: '8px 12px',
                    fontSize: 12,
                    color: d.auditPassed === false ? C.red : C.teal,
                    lineHeight: 1.5,
                  }}
                >
                  {d.auditPassed === false ? 'Audit flagged: ' : 'Audit corrected: '}
                  {d.auditFindings}
                </div>
              )}

              {d.signalSummary && (
                <div
                  style={{
                    marginTop: 10,
                    background: 'rgba(255,201,74,0.06)',
                    borderLeft: `2px solid ${C.amber}`,
                    borderRadius: '0 8px 8px 0',
                    padding: '8px 12px',
                    fontSize: 12,
                    color: '#c8a84a',
                    lineHeight: 1.5,
                  }}
                >
                  {d.signalSummary}
                  {d.signalId && sources.get(d.signalId) && (
                    <>
                      {' '}
                      <a
                        href={sources.get(d.signalId)!.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: C.amber, textDecoration: 'underline' }}
                      >
                        {sources.get(d.signalId)!.name} ↗
                      </a>
                    </>
                  )}
                </div>
              )}

              <MessageCard
                contactName={d.contactName || ''}
                company={d.contactCompany || ''}
                email={ci.email}
                phone={ci.phone}
                channel={toGenerateChannel(d.channel)}
                initialMessage={d.body}
                subject={d.subject || undefined}
                // Manual send means the loop only closes if the click is
                // recorded — so opening Mail/Text/Call from a draft marks it
                // sent and advances the cadence in the same gesture. Sending
                // from a phone instead silently breaks the loop; this button
                // is the one that counts.
                onOpened={() => resolve(d, 'sent')}
              />

              <div className="flex gap-2 flex-wrap" style={{ marginTop: 12 }}>
                <button
                  onClick={() => resolve(d, 'sent')}
                  disabled={busy === d.id}
                  style={{ ...btnGhost, opacity: busy === d.id ? 0.5 : 1 }}
                >
                  ✓ Mark done
                </button>
                <button
                  onClick={() => resolve(d, 'killed')}
                  disabled={busy === d.id}
                  style={{ ...btnGhost, color: C.red, opacity: busy === d.id ? 0.5 : 1 }}
                >
                  Dismiss draft
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
