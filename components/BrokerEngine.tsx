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

const tierPill: Record<RelationshipTier, string> = {
  A: 'pill-purple',
  B: 'pill-teal',
  C: 'pill-amber',
};

const statusPill: Record<string, { label: string; className: string }> = {
  overdue: { label: 'Overdue', className: 'pill-red' },
  due_soon: { label: 'Due soon', className: 'pill-amber' },
  on_track: { label: 'On track', className: 'pill-accent' },
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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
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

  if (!mounted) return null;

  const sortedBrokers = [...brokers].sort((a, b) => {
    const order: Record<string, number> = { overdue: 0, due_soon: 1, on_track: 2 };
    const sa = order[computeStatus(a.lastTouch, a.tier)];
    const sb = order[computeStatus(b.lastTouch, b.tier)];
    if (sa !== sb) return sa - sb;
    const tierOrder = { A: 0, B: 1, C: 2 };
    return tierOrder[a.tier] - tierOrder[b.tier];
  });

  return (
    <div className="space-y-8">
      <section className="fade-up">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="font-display text-xl font-bold">Active Brokers</h2>
          <span className="label-mono">{sortedBrokers.length} total</span>
        </div>
        <div className="space-y-3">
          {sortedBrokers.map((broker, idx) => {
            const status = computeStatus(broker.lastTouch, broker.tier);
            const sp = statusPill[status];
            const isExpanded = expanded === broker.id;
            const fadeClass = `fade-up-${Math.min(idx + 1, 5)}`;
            return (
              <div key={broker.id} className={`card card-hover ${fadeClass}`}>
                <button onClick={() => setExpanded(isExpanded ? null : broker.id)} className="w-full p-5 text-left">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div
                        className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm font-display font-bold"
                        style={{ background: 'var(--purple-bg)', color: 'var(--purple)' }}
                      >
                        {getInitials(broker.firstName, broker.lastName)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-display font-semibold text-base">
                            {broker.firstName} {broker.lastName}
                          </span>
                          <span className={`pill ${tierPill[broker.tier]}`}>Tier {broker.tier}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          <span className="label-mono">{broker.firm}</span>
                          <span className="label-mono" style={{ color: 'var(--muted2)' }}>·</span>
                          <span className="label-mono">{broker.dealCount} deals</span>
                          <span className="label-mono" style={{ color: 'var(--muted2)' }}>·</span>
                          <span className="label-mono">
                            Last {broker.lastTouch || 'never'}
                          </span>
                          <span className="label-mono" style={{ color: 'var(--muted2)' }}>·</span>
                          <span className="label-mono">
                            Due {broker.nextDue || 'ASAP'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <span className={`pill ${sp.className} flex-shrink-0`}>{sp.label}</span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-5 pb-5 border-t border-[var(--border)] pt-4 space-y-4">
                    <div>
                      <div className="label-mono mb-2">Tier</div>
                      <div className="flex gap-2">
                        {(['A', 'B', 'C'] as RelationshipTier[]).map((t) => (
                          <button
                            key={t}
                            onClick={() => changeTier(broker.id, t)}
                            className={broker.tier === t ? 'btn-primary' : 'btn-ghost'}
                          >
                            Tier {t}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <button onClick={() => logTouch(broker.id)} className="btn-primary">
                        Log touch today
                      </button>
                      <button
                        onClick={() => copyText(getBrokerNurtureText(broker), `${broker.id}-text`)}
                        className="btn-secondary"
                      >
                        {copied === `${broker.id}-text` ? 'Copied' : 'Copy text'}
                      </button>
                      <button
                        onClick={() => copyText(getBrokerNurtureEmail(broker), `${broker.id}-email`)}
                        className="btn-secondary"
                      >
                        {copied === `${broker.id}-email` ? 'Copied' : 'Copy email'}
                      </button>
                      <button
                        onClick={() => copyText(getBrokerLinkedIn(broker), `${broker.id}-li`)}
                        className="btn-secondary"
                      >
                        {copied === `${broker.id}-li` ? 'Copied' : 'Copy LinkedIn'}
                      </button>
                    </div>
                    <div>
                      <div className="label-mono mb-2">Notes</div>
                      <textarea
                        placeholder="Add notes..."
                        value={notes[broker.id] ?? broker.notes}
                        onChange={(e) => handleNoteChange(broker.id, e.target.value)}
                        className="resize-none h-20"
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {coldBrokers.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-display text-xl font-bold">Cold Broker Queue</h2>
            <span className="label-mono">
              {coldBrokers.filter((c) => c.status !== 'active_broker').length} pending
            </span>
          </div>
          <div className="space-y-3">
            {coldBrokers
              .filter((cb) => cb.status !== 'active_broker')
              .map((cb) => (
                <div key={cb.id} className="card card-hover p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-display font-semibold">{cb.name}</span>
                        <span className="label-mono">{cb.title}</span>
                      </div>
                      <div className="flex gap-3 mt-1 flex-wrap">
                        <span className="label-mono">{cb.firm}</span>
                        {cb.email && <span className="label-mono">{cb.email}</span>}
                        {cb.phone && <span className="label-mono">{cb.phone}</span>}
                      </div>
                    </div>
                    <span
                      className={`pill flex-shrink-0 ${
                        cb.status === 'outreach_sent'
                          ? 'pill-amber'
                          : cb.status === 'connected'
                            ? 'pill-accent'
                            : 'pill-blue'
                      }`}
                    >
                      {cb.status === 'outreach_sent' ? 'Outreach Sent' : cb.status === 'connected' ? 'Connected' : 'New'}
                    </span>
                  </div>
                  <div className="flex gap-2 mt-4 flex-wrap">
                    <button onClick={() => addToActive(cb)} className="btn-primary">
                      Move to active
                    </button>
                    <button onClick={() => markOutreachSent(cb.id)} className="btn-secondary">
                      Mark outreach sent
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}
