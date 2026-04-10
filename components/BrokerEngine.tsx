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

const tierColors: Record<RelationshipTier, string> = {
  A: 'bg-purple-200 text-[#5b21b6]',
  B: 'bg-blue-100 text-blue-800',
  C: 'bg-gray-100 text-gray-700',
};

const statusPill: Record<string, { label: string; color: string }> = {
  overdue: { label: 'Overdue', color: 'bg-red-100 text-[#dc2626]' },
  due_soon: { label: 'Due this week', color: 'bg-amber-100 text-amber-700' },
  on_track: { label: 'On track', color: 'bg-green-100 text-[#059669]' },
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

  // Sort brokers: overdue first, then Tier A, then by lastTouch ascending
  const sortedBrokers = [...brokers].sort((a, b) => {
    const statusOrder: Record<string, number> = { overdue: 0, due_soon: 1, on_track: 2 };
    const sa = statusOrder[computeStatus(a.lastTouch, a.tier)];
    const sb = statusOrder[computeStatus(b.lastTouch, b.tier)];
    if (sa !== sb) return sa - sb;
    const tierOrder = { A: 0, B: 1, C: 2 };
    return tierOrder[a.tier] - tierOrder[b.tier];
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-3">Active Brokers</h2>
        <div className="space-y-3">
          {sortedBrokers.map((broker) => {
            const status = computeStatus(broker.lastTouch, broker.tier);
            const sp = statusPill[status];
            const isExpanded = expanded === broker.id;
            return (
              <div key={broker.id} className="bg-white rounded-lg border border-[#e8e8e0]">
                <button
                  onClick={() => setExpanded(isExpanded ? null : broker.id)}
                  className="w-full p-4 text-left"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[#5b21b6] text-white flex items-center justify-center text-sm font-bold">
                        {getInitials(broker.firstName, broker.lastName)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">
                            {broker.firstName} {broker.lastName}
                          </span>
                          <span className="text-sm text-gray-500">{broker.firm}</span>
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${tierColors[broker.tier]}`}>
                            Tier {broker.tier}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                          <span>{broker.dealCount} deals</span>
                          <span>Last: {broker.lastTouch || 'Never'}</span>
                          <span>Next due: {broker.nextDue || 'ASAP'}</span>
                        </div>
                      </div>
                    </div>
                    <span className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${sp.color}`}>
                      {sp.label}
                    </span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-[#e8e8e0] pt-3 space-y-3">
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-1">Tier</p>
                      <div className="flex gap-2">
                        {(['A', 'B', 'C'] as RelationshipTier[]).map((t) => (
                          <button
                            key={t}
                            onClick={() => changeTier(broker.id, t)}
                            className={`px-3 py-1 text-xs font-medium rounded-md ${
                              broker.tier === t
                                ? tierColors[t]
                                : 'bg-white border border-[#e8e8e0] text-gray-600 hover:bg-gray-50'
                            }`}
                          >
                            Tier {t}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={() => logTouch(broker.id)}
                        className="px-3 py-1.5 text-xs font-medium bg-[#059669] text-white rounded-md hover:bg-[#047857]"
                      >
                        Log touch today
                      </button>
                      <button
                        onClick={() => copyText(getBrokerNurtureText(broker), `${broker.id}-text`)}
                        className="px-3 py-1.5 text-xs font-medium bg-[#1a1a1a] text-white rounded-md hover:bg-[#333]"
                      >
                        {copied === `${broker.id}-text` ? 'Copied!' : 'Copy text'}
                      </button>
                      <button
                        onClick={() => copyText(getBrokerNurtureEmail(broker), `${broker.id}-email`)}
                        className="px-3 py-1.5 text-xs font-medium bg-[#5b21b6] text-white rounded-md hover:bg-[#4c1d95]"
                      >
                        {copied === `${broker.id}-email` ? 'Copied!' : 'Copy email'}
                      </button>
                      <button
                        onClick={() => copyText(getBrokerLinkedIn(broker), `${broker.id}-li`)}
                        className="px-3 py-1.5 text-xs font-medium bg-[#1e40af] text-white rounded-md hover:bg-[#1e3a8a]"
                      >
                        {copied === `${broker.id}-li` ? 'Copied!' : 'Copy LinkedIn'}
                      </button>
                    </div>
                    <textarea
                      placeholder="Add notes..."
                      value={notes[broker.id] ?? broker.notes}
                      onChange={(e) => handleNoteChange(broker.id, e.target.value)}
                      className="w-full border border-[#e8e8e0] rounded-md p-2 text-sm resize-none h-20"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {coldBrokers.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Cold Broker Queue</h2>
          <div className="space-y-3">
            {coldBrokers
              .filter((cb) => cb.status !== 'active_broker')
              .map((cb) => (
                <div key={cb.id} className="bg-white rounded-lg border border-[#e8e8e0] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{cb.name}</span>
                        <span className="text-sm text-gray-500">{cb.title}</span>
                      </div>
                      <p className="text-sm text-gray-500 mt-0.5">{cb.firm}</p>
                      <div className="flex gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                        {cb.email && <span>{cb.email}</span>}
                        {cb.phone && <span>{cb.phone}</span>}
                      </div>
                    </div>
                    <span
                      className={`flex-shrink-0 px-2 py-0.5 rounded text-xs font-medium ${
                        cb.status === 'outreach_sent'
                          ? 'bg-amber-100 text-amber-700'
                          : cb.status === 'connected'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-blue-100 text-[#1e40af]'
                      }`}
                    >
                      {cb.status === 'outreach_sent' ? 'Outreach Sent' : cb.status === 'connected' ? 'Connected' : 'New'}
                    </span>
                  </div>
                  <div className="flex gap-2 mt-3 flex-wrap">
                    <button
                      onClick={() => addToActive(cb)}
                      className="px-3 py-1.5 text-xs font-medium bg-[#5b21b6] text-white rounded-md hover:bg-[#4c1d95]"
                    >
                      Move to active brokers
                    </button>
                    <button
                      onClick={() => markOutreachSent(cb.id)}
                      className="px-3 py-1.5 text-xs font-medium bg-[#1a1a1a] text-white rounded-md hover:bg-[#333]"
                    >
                      Mark outreach sent
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
