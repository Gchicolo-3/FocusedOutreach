'use client';

import { useState, useEffect } from 'react';
import {
  getProspects,
  getBrokers,
  getPartners,
  initDefaultBrokers,
  getTextSent,
  markTextSent,
} from '@/lib/storage';
import { getLeadMessage, getBrokerNurtureText, getPartnerNurtureText } from '@/lib/messages';

type TextCard = {
  id: string;
  contactName: string;
  context: string;
  message: string;
  category: 'broker-nurture' | 'partner-nurture' | 'prospect-followup';
  sent: boolean;
  sentAt?: string;
};

const categoryLabels: Record<string, string> = {
  'broker-nurture': 'Broker',
  'partner-nurture': 'Partner',
  'prospect-followup': 'Prospect',
};

const categoryPill: Record<string, string> = {
  'broker-nurture': 'pill-purple',
  'partner-nurture': 'pill-teal',
  'prospect-followup': 'pill-accent',
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
    const partners = getPartners();
    const prospects = getProspects();
    const allCards: TextCard[] = [];

    brokers.forEach((b) => {
      allCards.push({
        id: `bnurture-${b.id}`,
        contactName: `${b.firstName} ${b.lastName}`,
        context: `${b.firm} · Tier ${b.tier}`,
        message: getBrokerNurtureText(b),
        category: 'broker-nurture',
        sent: false,
      });
    });

    partners.forEach((p) => {
      allCards.push({
        id: `pnurture-${p.id}`,
        contactName: `${p.firstName} ${p.lastName}`,
        context: `${p.company} · Tier ${p.tier}`,
        message: getPartnerNurtureText(p),
        category: 'partner-nurture',
        sent: false,
      });
    });

    prospects
      .filter((l) => l.tier === 1 || l.tier === 2)
      .slice(0, 10)
      .forEach((l) => {
        const textLead = { ...l, channel: 'text' as const };
        allCards.push({
          id: `prospect-${l.id}`,
          contactName: l.contact,
          context: `${l.company} · Tier ${l.tier}`,
          message: getLeadMessage(textLead),
          category: 'prospect-followup',
          sent: false,
        });
      });

    const sentData = getTextSent();
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
    markTextSent(id);
    const sentData = getTextSent();
    setCards((prev) =>
      prev.map((c) => (c.id === id ? { ...c, sent: true, sentAt: sentData[id] } : c))
    );
  }

  if (!mounted) return null;

  const filtered = filter === 'all' ? cards : cards.filter((c) => c.category === filter);

  return (
    <div className="space-y-4 fade-up">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-xl font-bold">Text Launcher</h2>
        <span className="label-mono">{filtered.length} ready</span>
      </div>

      <div className="flex gap-2 flex-wrap">
        {['all', 'broker-nurture', 'partner-nurture', 'prospect-followup'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={filter === f ? 'btn-primary' : 'btn-ghost'}
          >
            {f === 'all' ? 'All' : categoryLabels[f]}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="card p-8 text-center" style={{ color: 'var(--muted)' }}>
          No texts to display. Import leads to generate prospect messages.
        </div>
      )}

      {filtered.map((card, idx) => {
        const fadeClass = `fade-up-${Math.min(idx + 1, 5)}`;
        return (
          <div key={card.id} className={`card card-hover p-5 ${fadeClass} ${card.sent ? 'opacity-50' : ''}`}>
            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
              <div className="min-w-0">
                <span className="font-display font-semibold">{card.contactName}</span>
                <span className="label-mono ml-2">{card.context}</span>
              </div>
              <span className={`pill ${categoryPill[card.category]}`}>{categoryLabels[card.category]}</span>
            </div>

            <div className="msg-bubble mb-3">{card.message}</div>

            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="label-mono">{card.message.length} chars</span>
              <div className="flex gap-2">
                <button onClick={() => copyMessage(card.message, card.id)} className="btn-primary">
                  {copied === card.id ? 'Copied' : 'Copy'}
                </button>
                <button onClick={() => markSent(card.id)} disabled={card.sent} className="btn-secondary">
                  {card.sent ? 'Sent' : 'Mark sent'}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
