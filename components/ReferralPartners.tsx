'use client';

import { useState, useEffect } from 'react';
import { Partner, PartnerType, RelationshipTier } from '@/types';
import {
  getPartners,
  setPartners,
  updatePartner,
  logPartnerTouch,
} from '@/lib/storage';
import { getPartnerNurtureText, getPartnerNurtureEmail, getPartnerLinkedIn } from '@/lib/messages';
import { computeStatus, defaultTierForPartner } from '@/lib/cadence';

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

const partnerTypeLabels: Record<PartnerType, string> = {
  attorney: 'Attorney',
  accountant: 'Accountant',
  property_manager: 'Property Mgr',
  networking: 'Networking',
  past_client: 'Past Client',
  other: 'Other',
};

function getInitials(firstName: string, lastName: string): string {
  return `${firstName[0] || ''}${lastName[0] || ''}`.toUpperCase();
}

function newId(): string {
  return `partner-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export default function ReferralPartners() {
  const [partners, setPartnersState] = useState<Partner[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [mounted, setMounted] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newPartner, setNewPartner] = useState({
    firstName: '',
    lastName: '',
    company: '',
    partnerType: 'other' as PartnerType,
  });

  useEffect(() => {
    setMounted(true);
    setPartnersState(getPartners());
  }, []);

  function refresh() {
    setPartnersState(getPartners());
  }

  function logTouch(id: string) {
    logPartnerTouch(id);
    refresh();
  }

  function changeTier(id: string, tier: RelationshipTier) {
    updatePartner(id, { tier });
    refresh();
  }

  function changeType(id: string, partnerType: PartnerType) {
    updatePartner(id, { partnerType });
    refresh();
  }

  function copyText(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  function handleNoteChange(id: string, text: string) {
    setNotes((prev) => ({ ...prev, [id]: text }));
    updatePartner(id, { notes: text });
  }

  function addPartner() {
    if (!newPartner.firstName.trim()) return;
    const tier = defaultTierForPartner(newPartner.partnerType);
    const partner: Partner = {
      id: newId(),
      firstName: newPartner.firstName.trim(),
      lastName: newPartner.lastName.trim(),
      company: newPartner.company.trim(),
      title: '',
      partnerType: newPartner.partnerType,
      tier,
      referralCount: 0,
      lastTouch: '',
      nextDue: '',
      notes: '',
    };
    const updated = [...getPartners(), partner];
    setPartners(updated);
    refresh();
    setShowAdd(false);
    setNewPartner({ firstName: '', lastName: '', company: '', partnerType: 'other' });
  }

  if (!mounted) return null;

  const sorted = [...partners].sort((a, b) => {
    const order: Record<string, number> = { overdue: 0, due_soon: 1, on_track: 2 };
    const sa = order[computeStatus(a.lastTouch, a.tier)];
    const sb = order[computeStatus(b.lastTouch, b.tier)];
    if (sa !== sb) return sa - sb;
    const tierOrder = { A: 0, B: 1, C: 2 };
    return tierOrder[a.tier] - tierOrder[b.tier];
  });

  return (
    <div className="space-y-4 fade-up">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="font-display text-xl font-bold">Referral Partners</h2>
          <span className="label-mono">{sorted.length} total</span>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} className={showAdd ? 'btn-ghost' : 'btn-primary'}>
          {showAdd ? 'Cancel' : '+ Add partner'}
        </button>
      </div>

      {showAdd && (
        <div className="card p-5 space-y-3 fade-up">
          <div className="grid grid-cols-2 gap-3">
            <input
              placeholder="First name"
              value={newPartner.firstName}
              onChange={(e) => setNewPartner((p) => ({ ...p, firstName: e.target.value }))}
            />
            <input
              placeholder="Last name"
              value={newPartner.lastName}
              onChange={(e) => setNewPartner((p) => ({ ...p, lastName: e.target.value }))}
            />
          </div>
          <input
            placeholder="Company"
            value={newPartner.company}
            onChange={(e) => setNewPartner((p) => ({ ...p, company: e.target.value }))}
          />
          <select
            value={newPartner.partnerType}
            onChange={(e) => setNewPartner((p) => ({ ...p, partnerType: e.target.value as PartnerType }))}
          >
            {(Object.keys(partnerTypeLabels) as PartnerType[]).map((t) => (
              <option key={t} value={t}>
                {partnerTypeLabels[t]}
              </option>
            ))}
          </select>
          <button onClick={addPartner} className="btn-primary">
            Add partner
          </button>
        </div>
      )}

      {sorted.length === 0 && !showAdd && (
        <div className="card p-8 text-center" style={{ color: 'var(--muted)' }}>
          No referral partners yet. Add one or import a CSV with Focus_Type__c set to &quot;Referral Partner&quot;.
        </div>
      )}

      <div className="space-y-3">
        {sorted.map((partner, idx) => {
          const status = computeStatus(partner.lastTouch, partner.tier);
          const sp = statusPill[status];
          const isExpanded = expanded === partner.id;
          const fadeClass = `fade-up-${Math.min(idx + 1, 5)}`;
          return (
            <div key={partner.id} className={`card card-hover ${fadeClass}`}>
              <button onClick={() => setExpanded(isExpanded ? null : partner.id)} className="w-full p-5 text-left">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm font-display font-bold"
                      style={{ background: 'var(--teal-bg)', color: 'var(--teal)' }}
                    >
                      {getInitials(partner.firstName, partner.lastName)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-display font-semibold text-base">
                          {partner.firstName} {partner.lastName}
                        </span>
                        <span className="pill pill-muted">{partnerTypeLabels[partner.partnerType]}</span>
                        <span className={`pill ${tierPill[partner.tier]}`}>Tier {partner.tier}</span>
                      </div>
                      <div className="flex gap-3 mt-1 flex-wrap">
                        <span className="label-mono">{partner.company}</span>
                        <span className="label-mono" style={{ color: 'var(--muted2)' }}>·</span>
                        <span className="label-mono">{partner.referralCount} referrals</span>
                        <span className="label-mono" style={{ color: 'var(--muted2)' }}>·</span>
                        <span className="label-mono">Last {partner.lastTouch || 'never'}</span>
                        <span className="label-mono" style={{ color: 'var(--muted2)' }}>·</span>
                        <span className="label-mono">Due {partner.nextDue || 'ASAP'}</span>
                      </div>
                    </div>
                  </div>
                  <span className={`pill ${sp.className} flex-shrink-0`}>{sp.label}</span>
                </div>
              </button>

              {isExpanded && (
                <div className="px-5 pb-5 border-t border-[var(--border)] pt-4 space-y-4">
                  <div>
                    <div className="label-mono mb-2">Type</div>
                    <select
                      value={partner.partnerType}
                      onChange={(e) => changeType(partner.id, e.target.value as PartnerType)}
                      style={{ width: 'auto', minWidth: '200px' }}
                    >
                      {(Object.keys(partnerTypeLabels) as PartnerType[]).map((t) => (
                        <option key={t} value={t}>
                          {partnerTypeLabels[t]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className="label-mono mb-2">Tier</div>
                    <div className="flex gap-2">
                      {(['A', 'B', 'C'] as RelationshipTier[]).map((t) => (
                        <button
                          key={t}
                          onClick={() => changeTier(partner.id, t)}
                          className={partner.tier === t ? 'btn-primary' : 'btn-ghost'}
                        >
                          Tier {t}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={() => logTouch(partner.id)} className="btn-primary">
                      Log touch today
                    </button>
                    <button
                      onClick={() => copyText(getPartnerNurtureText(partner), `${partner.id}-text`)}
                      className="btn-secondary"
                    >
                      {copied === `${partner.id}-text` ? 'Copied' : 'Copy text'}
                    </button>
                    <button
                      onClick={() => copyText(getPartnerNurtureEmail(partner), `${partner.id}-email`)}
                      className="btn-secondary"
                    >
                      {copied === `${partner.id}-email` ? 'Copied' : 'Copy email'}
                    </button>
                    <button
                      onClick={() => copyText(getPartnerLinkedIn(partner), `${partner.id}-li`)}
                      className="btn-secondary"
                    >
                      {copied === `${partner.id}-li` ? 'Copied' : 'Copy LinkedIn'}
                    </button>
                  </div>
                  <div>
                    <div className="label-mono mb-2">Notes</div>
                    <textarea
                      placeholder="Add notes..."
                      value={notes[partner.id] ?? partner.notes}
                      onChange={(e) => handleNoteChange(partner.id, e.target.value)}
                      className="resize-none h-20"
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
