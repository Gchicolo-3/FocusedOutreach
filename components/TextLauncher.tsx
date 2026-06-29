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
import { C, F, labelMono, btnPrimary, btnSecondary, btnGhost, pillStyle } from '@/lib/design';

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

const categoryPill: Record<string, 'purple' | 'teal' | 'accent'> = {
  'broker-nurture': 'purple',
  'partner-nurture': 'teal',
  'prospect-followup': 'accent',
};

export default function TextLauncher() {
  const [cards, setCards] = useState<TextCard[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    (async () => {
      await initDefaultBrokers();
      await buildCards();
    })();
  }, []);

  async function buildCards() {
    const [brokers, partners, prospects] = await Promise.all([
      getBrokers(),
      getPartners(),
      getProspects(),
    ]);
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
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, sent: true, sentAt: sentData[id] } : c)));
  }

  const filtered = filter === 'all' ? cards : cards.filter((c) => c.category === filter);

  return (
    <div className="flex flex-col gap-4 fade-up">
      <div className="flex items-baseline justify-between">
        <h2 style={{ fontFamily: F.display, fontSize: 18, fontWeight: 700, color: C.text }}>Text Launcher</h2>
        <span style={labelMono}>{filtered.length} ready</span>
      </div>

      <div className="flex gap-2 flex-wrap">
        {['all', 'broker-nurture', 'partner-nurture', 'prospect-followup'].map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={filter === f ? btnPrimary : btnGhost}>
            {f === 'all' ? 'All' : categoryLabels[f]}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: 32,
            textAlign: 'center',
            color: C.muted,
          }}
        >
          No texts to display. Import leads to generate prospect messages.
        </div>
      )}

      {filtered.map((card) => (
        <div
          key={card.id}
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: 20,
            opacity: card.sent ? 0.5 : 1,
          }}
        >
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <div style={{ minWidth: 0 }}>
              <span style={{ fontFamily: F.display, fontWeight: 600 }}>{card.contactName}</span>
              <span style={{ ...labelMono, marginLeft: 8 }}>{card.context}</span>
            </div>
            <span style={pillStyle(categoryPill[card.category])}>{categoryLabels[card.category]}</span>
          </div>

          <div
            style={{
              background: C.surface2,
              border: `1px solid ${C.border}`,
              borderRadius: 12,
              padding: 14,
              fontSize: 13,
              lineHeight: 1.7,
              whiteSpace: 'pre-wrap',
              marginBottom: 12,
            }}
          >
            {card.message}
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2">
            <span style={labelMono}>{card.message.length} chars</span>
            <div className="flex gap-2">
              <button onClick={() => copyMessage(card.message, card.id)} style={btnPrimary}>
                {copied === card.id ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={() => markSent(card.id)}
                disabled={card.sent}
                style={{ ...btnSecondary, opacity: card.sent ? 0.4 : 1 }}
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
