'use client';

import { useState, useEffect } from 'react';
import { Broker, ColdBroker } from '@/types';
import {
  getBrokers,
  setBrokers,
  updateBroker,
  initDefaultBrokers,
  getColdBrokers,
  updateColdBroker,
} from '@/lib/storage';
import { getBrokerNurtureText, getBrokerNurtureEmail } from '@/lib/messages';
import { daysSince } from '@/lib/prioritize';

function brokerStatus(lastTouch: string): { label: string; color: string } {
  if (!lastTouch) return { label: 'Overdue', color: 'bg-red-100 text-[#dc2626]' };
  const days = daysSince(lastTouch);
  if (days > 28) return { label: 'Overdue', color: 'bg-red-100 text-[#dc2626]' };
  if (days > 21) return { label: 'Due this week', color: 'bg-amber-100 text-amber-700' };
  return { label: 'On track', color: 'bg-green-100 text-[#059669]' };
}

function nextDueDate(lastTouch: string): string {
  if (!lastTouch) return 'ASAP';
  const d = new Date(lastTouch);
  d.setDate(d.getDate() + 28);
  return d.toLocaleDateString();
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
    setBrokersState(getBrokers());
    setColdBrokersState(getColdBrokers());
  }, []);

  function logTouch(brokerId: string) {
    const today = new Date().toISOString().split('T')[0];
    updateBroker(brokerId, { lastTouch: today });
    setBrokersState(getBrokers());
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
    const newBroker: Broker = {
      id: `broker-${Date.now()}`,
      name: coldBroker.name,
      firm: coldBroker.firm,
      dealCount: 0,
      lastTouch: new Date().toISOString().split('T')[0],
      notes: '',
    };
    const updated = [...getBrokers(), newBroker];
    setBrokers(updated);
    setBrokersState(updated);
    updateColdBroker(coldBroker.id, { status: 'active_broker' });
    setColdBrokersState(getColdBrokers());
  }

  function markOutreachSent(id: string) {
    updateColdBroker(id, { status: 'outreach_sent' });
    setColdBrokersState(getColdBrokers());
  }

  if (!mounted) return null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-3">Active Brokers</h2>
        <div className="space-y-3">
          {brokers.map((broker) => {
            const status = brokerStatus(broker.lastTouch);
            const isExpanded = expanded === broker.id;
            return (
              <div key={broker.id} className="bg-white rounded-lg border border-[#e8e8e0]">
                <button
                  onClick={() => setExpanded(isExpanded ? null : broker.id)}
                  className="w-full p-4 text-left"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{broker.name}</span>
                        <span className="text-sm text-gray-500">{broker.firm}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                        <span>{broker.dealCount} deals</span>
                        <span>Last: {broker.lastTouch || 'Never'}</span>
                        <span>Next due: {nextDueDate(broker.lastTouch)}</span>
                      </div>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${status.color}`}>
                      {status.label}
                    </span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-[#e8e8e0] pt-3 space-y-3">
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
                        {copied === `${broker.id}-text` ? 'Copied!' : 'Copy nurture text'}
                      </button>
                      <button
                        onClick={() => copyText(getBrokerNurtureEmail(broker), `${broker.id}-email`)}
                        className="px-3 py-1.5 text-xs font-medium bg-[#5b21b6] text-white rounded-md hover:bg-[#4c1d95]"
                      >
                        {copied === `${broker.id}-email` ? 'Copied!' : 'Copy nurture email'}
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
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
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
                      className={`px-2 py-0.5 rounded text-xs font-medium ${
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
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => addToActive(cb)}
                      className="px-3 py-1.5 text-xs font-medium bg-[#5b21b6] text-white rounded-md hover:bg-[#4c1d95]"
                    >
                      Add to active
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
