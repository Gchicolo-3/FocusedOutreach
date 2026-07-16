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
  logTouch,
  type EngineDraft,
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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const [d, brokers, partners, prospects, cold] = await Promise.all([
      getPendingEngineDrafts(),
      getBrokers(),
      getPartners(),
      getProspects(),
      getColdBrokers(),
    ]);
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

  async function resolve(d: EngineDraft, status: 'sent' | 'killed') {
    setBusy(d.id);
    await setEngineDraftStatus(d.id, status);
    // "Mark done" (sent) is a completed outreach action, so record a touch to
    // reset the contact's cadence and keep the engine from re-drafting them.
    // "Dismiss" (killed) is a rejection, not outreach, so it logs nothing.
    if (status === 'sent' && d.contactId) {
      const today = new Date().toISOString().split('T')[0];
      await logTouch(d.contactId, today, toTouchChannel(d.channel));
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
        <span style={labelMono}>
          {drafts.length} waiting{drafts.length >= 60 ? '+ (newest first)' : ''}
        </span>
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
                </div>
              </div>

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
