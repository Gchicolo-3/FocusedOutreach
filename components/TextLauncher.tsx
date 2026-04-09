'use client';

import { useState, useEffect } from 'react';
import { getLeads, getBrokers, initDefaultBrokers } from '@/lib/storage';
import { getLeadMessage, getBrokerNurtureText, getColdBrokerIntro } from '@/lib/messages';

type TextCard = {
  id: string;
  contactName: string;
  context: string;
  message: string;
  category: 'broker-nurture' | 'prospect-followup' | 'cold-intro';
  sent: boolean;
  sentAt?: string;
};

const categoryLabels: Record<string, string> = {
  'broker-nurture': 'Broker Nurture',
  'prospect-followup': 'Prospect Follow-up',
  'cold-intro': 'New Broker Intro',
};

export default function TextLauncher() {
  const [cards, setCards] = useState<TextCard[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    initDefaultBrokers();
    buildCards();
  }, []);

  function buildCards() {
    const brokers = getBrokers();
    const leads = getLeads();
    const allCards: TextCard[] = [];

    brokers.forEach((b) => {
      allCards.push({
        id: `bnurture-${b.id}`,
        contactName: b.name,
        context: `${b.firm} — ${b.dealCount} deals`,
        message: getBrokerNurtureText(b),
        category: 'broker-nurture',
        sent: false,
      });
    });

    leads
      .filter((l) => l.tier === 1 || l.tier === 2)
      .slice(0, 10)
      .forEach((l) => {
        const textLead = { ...l, channel: 'text' as const };
        allCards.push({
          id: `prospect-${l.id}`,
          contactName: l.contact,
          context: `${l.company} — Tier ${l.tier}`,
          message: getLeadMessage(textLead),
          category: 'prospect-followup',
          sent: false,
        });
      });

    brokers
      .filter((b) => !b.lastTouch)
      .forEach((b) => {
        allCards.push({
          id: `coldintro-${b.id}`,
          contactName: b.name,
          context: `New intro — ${b.firm}`,
          message: getColdBrokerIntro(b.name, b.firm),
          category: 'cold-intro',
          sent: false,
        });
      });

    const sentData = JSON.parse(localStorage.getItem('fs_text_sent') || '{}');
    allCards.forEach((c) => {
      if (sentData[c.id]) {
        c.sent = true;
        c.sentAt = sentData[c.id];
      }
    });

    setCards(allCards);
  }

  function copyMessage(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  function markSent(id: string) {
    const now = new Date().toISOString();
    const sentData = JSON.parse(localStorage.getItem('fs_text_sent') || '{}');
    sentData[id] = now;
    localStorage.setItem('fs_text_sent', JSON.stringify(sentData));
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, sent: true, sentAt: now } : c)));
  }

  if (!mounted) return null;

  const filtered = filter === 'all' ? cards : cards.filter((c) => c.category === filter);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {['all', 'broker-nurture', 'prospect-followup', 'cold-intro'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              filter === f
                ? 'bg-[#1a1a1a] text-white'
                : 'bg-white text-gray-600 border border-[#e8e8e0] hover:bg-gray-50'
            }`}
          >
            {f === 'all' ? 'All' : categoryLabels[f]}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="bg-white rounded-lg p-8 border border-[#e8e8e0] text-center text-gray-500">
          No texts to display. Import leads to generate prospect messages.
        </div>
      )}

      {filtered.map((card) => (
        <div
          key={card.id}
          className={`bg-white rounded-lg border border-[#e8e8e0] p-4 ${card.sent ? 'opacity-60' : ''}`}
        >
          <div className="flex items-center justify-between mb-2 gap-2">
            <div className="min-w-0">
              <span className="font-semibold">{card.contactName}</span>
              <span className="text-sm text-gray-500 ml-2">{card.context}</span>
            </div>
            <span
              className={`flex-shrink-0 px-2 py-0.5 rounded text-xs font-medium ${
                card.category === 'broker-nurture'
                  ? 'bg-purple-100 text-[#5b21b6]'
                  : card.category === 'prospect-followup'
                    ? 'bg-green-100 text-[#059669]'
                    : 'bg-blue-100 text-[#1e40af]'
              }`}
            >
              {categoryLabels[card.category]}
            </span>
          </div>

          <div className="flex justify-end mb-3">
            <div className="bg-[#007AFF] text-white rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[85%] text-sm whitespace-pre-wrap">
              {card.message}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">{card.message.length} chars</span>
            <div className="flex gap-2">
              <button
                onClick={() => copyMessage(card.message, card.id)}
                className="px-3 py-1.5 text-xs font-medium bg-[#1a1a1a] text-white rounded-md hover:bg-[#333]"
              >
                {copied === card.id ? 'Copied!' : 'Copy'}
              </button>
              <button
                onClick={() => markSent(card.id)}
                disabled={card.sent}
                className="px-3 py-1.5 text-xs font-medium bg-[#059669] text-white rounded-md hover:bg-[#047857] disabled:opacity-50"
              >
                {card.sent ? 'Sent' : 'Mark sent'}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
