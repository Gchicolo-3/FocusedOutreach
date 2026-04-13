'use client';

import { useState, useEffect } from 'react';
import { Broker, ColdBroker, RelationshipTier } from '@/types';
import {
  getBrokers,
  setBrokers,
  updateBroker,
  logBrokerTouch,
  initDefaultBrokers,
  getColdBrokers,
  updateColdBroker,
  initDefaultColdBrokers,
} from '@/lib/storage';
import { getBrokerNurtureText, getBrokerNurtureEmail, getBrokerLinkedIn } from '@/lib/messages';
import { computeStatus } from '@/lib/cadence';
import { C, F, labelMono, btnPrimary, btnSecondary, btnGhost, pillStyle, inputBase } from '@/lib/design';

const tierPill: Record<RelationshipTier, 'purple' | 'teal' | 'amber'> = {
  A: 'purple',
  B: 'teal',
  C: 'amber',
};

const statusPill: Record<string, { label: string; variant: 'red' | 'amber' | 'accent' }> = {
  overdue: { label: 'Overdue', variant: 'red' },
  due_soon: { label: 'Due soon', variant: 'amber' },
  on_track: { label: 'On track', variant: 'accent' },
};

function getInitials(firstName: string, lastName: string): string {
  return `${firstName[0] || ''}${lastName[0] || ''}`.toUpperCase();
}

export default function BrokerEngine() {
  const [brokers, setBrokersState] = useState<Broker[]>([]);
  const [coldBrokers, setColdBrokersState] = useState<ColdBroker[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    initDefaultBrokers();
    initDefaultColdBrokers();
    refresh();
  }, []);

  function refresh() {
    setBrokersState(getBrokers());
    setColdBrokersState(getColdBrokers());
  }

  function logTouch(id: string) {
    logBrokerTouch(id);
    refresh();
  }

  function changeTier(id: string, tier: RelationshipTier) {
    updateBroker(id, { tier });
    refresh();
  }

  function copyText(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  function handleNoteChange(brokerId: string, text: string) {
    setNotes((prev) => ({ ...prev, [brokerId]: text }));
    updateBroker(brokerId, { notes: text });
  }

  function addToActive(coldBroker: ColdBroker) {
    const [firstName, ...rest] = coldBroker.name.split(' ');
    const newBroker: Broker = {
      id: `broker-${Date.now()}`,
      firstName: firstName || coldBroker.name,
      lastName: rest.join(' '),
      firm: coldBroker.firm,
      title: coldBroker.title,
      email: coldBroker.email,
      phone: coldBroker.phone,
      mobile: coldBroker.mobile,
      tier: 'B',
      dealCount: 0,
      dealNames: [],
      lastTouch: new Date().toISOString().split('T')[0],
      nextDue: '',
      notes: '',
      status: 'on_track',
    };
    const updated = [...getBrokers(), newBroker];
    setBrokers(updated);
    updateColdBroker(coldBroker.id, { status: 'active_broker' });
    refresh();
  }

  function markOutreachSent(id: string) {
    updateColdBroker(id, { status: 'outreach_sent' });
    refresh();
  }

  const sortedBrokers = [...brokers].sort((a, b) => {
    const order: Record<string, number> = { overdue: 0, due_soon: 1, on_track: 2 };
    const sa = order[computeStatus(a.lastTouch, a.tier)];
    const sb = order[computeStatus(b.lastTouch, b.tier)];
    if (sa !== sb) return sa - sb;
    const tierOrder = { A: 0, B: 1, C: 2 };
    return tierOrder[a.tier] - tierOrder[b.tier];
  });

  const sectionHeader = (title: string, count: string) => (
    <div className="flex items-baseline justify-between mb-4">
      <h2 style={{ fontFamily: F.display, fontSize: 18, fontWeight: 700, color: C.text }}>{title}</h2>
      <span style={labelMono}>{count}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-8 fade-up">
      <section>
        {sectionHeader('Active Brokers', `${sortedBrokers.length} total`)}
        <div className="flex flex-col gap-3">
          {sortedBrokers.map((broker) => {
            const status = computeStatus(broker.lastTouch, broker.tier);
            const sp = statusPill[status];
            const isExpanded = expanded === broker.id;
            return (
              <div
                key={broker.id}
                style={{
                  background: C.surface,
                  border: `1px solid ${isExpanded ? C.border2 : C.border}`,
                  borderRadius: 12,
                  transition: 'border-color 0.15s',
                }}
              >
                <button
                  onClick={() => setExpanded(isExpanded ? null : broker.id)}
                  style={{ width: '100%', padding: 20, textAlign: 'left' }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: '50%',
                          background: C.purpleBg,
                          color: C.purple,
                          fontFamily: F.display,
                          fontWeight: 700,
                          fontSize: 13,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {getInitials(broker.firstName, broker.lastName)}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span style={{ fontFamily: F.display, fontWeight: 600, fontSize: 15, color: C.text }}>
                            {broker.firstName} {broker.lastName}
                          </span>
                          <span style={pillStyle(tierPill[broker.tier])}>Tier {broker.tier}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          <span style={labelMono}>{broker.firm}</span>
                          <span style={{ ...labelMono, color: C.muted2 }}>·</span>
                          <span style={labelMono}>{broker.dealCount} deals</span>
                          <span style={{ ...labelMono, color: C.muted2 }}>·</span>
                          <span style={labelMono}>Last {broker.lastTouch || 'never'}</span>
                        </div>
                      </div>
                    </div>
                    <span style={{ ...pillStyle(sp.variant), flexShrink: 0 }}>{sp.label}</span>
                  </div>
                </button>

                {isExpanded && (
                  <div style={{ padding: '16px 20px 20px', borderTop: `1px solid ${C.border}` }}>
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ ...labelMono, marginBottom: 8 }}>Tier</div>
                      <div className="flex gap-2">
                        {(['A', 'B', 'C'] as RelationshipTier[]).map((t) => (
                          <button
                            key={t}
                            onClick={() => changeTier(broker.id, t)}
                            style={broker.tier === t ? btnPrimary : btnGhost}
                          >
                            Tier {t}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap" style={{ marginBottom: 16 }}>
                      <button onClick={() => logTouch(broker.id)} style={btnPrimary}>
                        Log touch today
                      </button>
                      <button onClick={() => copyText(getBrokerNurtureText(broker), `${broker.id}-text`)} style={btnSecondary}>
                        {copied === `${broker.id}-text` ? 'Copied' : 'Copy text'}
                      </button>
                      <button onClick={() => copyText(getBrokerNurtureEmail(broker), `${broker.id}-email`)} style={btnSecondary}>
                        {copied === `${broker.id}-email` ? 'Copied' : 'Copy email'}
                      </button>
                      <button onClick={() => copyText(getBrokerLinkedIn(broker), `${broker.id}-li`)} style={btnSecondary}>
                        {copied === `${broker.id}-li` ? 'Copied' : 'Copy LinkedIn'}
                      </button>
                    </div>
                    <div style={{ ...labelMono, marginBottom: 8 }}>Notes</div>
                    <textarea
                      placeholder="Add notes..."
                      value={notes[broker.id] ?? broker.notes}
                      onChange={(e) => handleNoteChange(broker.id, e.target.value)}
                      style={{ ...inputBase, height: 80, resize: 'none' }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {coldBrokers.length > 0 && (
        <section>
          {sectionHeader('Cold Broker Queue', `${coldBrokers.filter((c) => c.status !== 'active_broker').length} pending`)}
          <div className="flex flex-col gap-3">
            {coldBrokers
              .filter((cb) => cb.status !== 'active_broker')
              .map((cb) => {
                const st =
                  cb.status === 'outreach_sent'
                    ? { label: 'Outreach Sent', variant: 'amber' as const }
                    : cb.status === 'connected'
                      ? { label: 'Connected', variant: 'accent' as const }
                      : { label: 'New', variant: 'blue' as const };
                return (
                  <div
                    key={cb.id}
                    style={{
                      background: C.surface,
                      border: `1px solid ${C.border}`,
                      borderRadius: 12,
                      padding: 20,
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div style={{ minWidth: 0 }}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span style={{ fontFamily: F.display, fontWeight: 600, fontSize: 15 }}>{cb.name}</span>
                          <span style={labelMono}>{cb.title}</span>
                        </div>
                        <div className="flex gap-3 mt-1 flex-wrap">
                          <span style={labelMono}>{cb.firm}</span>
                          {cb.email && <span style={labelMono}>{cb.email}</span>}
                          {cb.phone && <span style={labelMono}>{cb.phone}</span>}
                        </div>
                      </div>
                      <span style={{ ...pillStyle(st.variant), flexShrink: 0 }}>{st.label}</span>
                    </div>
                    <div className="flex gap-2 flex-wrap" style={{ marginTop: 16 }}>
                      <button onClick={() => addToActive(cb)} style={btnPrimary}>
                        Move to active
                      </button>
                      <button onClick={() => markOutreachSent(cb.id)} style={btnSecondary}>
                        Mark outreach sent
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        </section>
      )}
    </div>
  );
}
