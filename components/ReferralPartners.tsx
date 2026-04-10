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

const partnerTypeLabels: Record<PartnerType, string> = {
  attorney: 'Attorney',
  accountant: 'Accountant',
  property_manager: 'Property Mgr',
  networking: 'Networking',
  past_client: 'Past Client',
  other: 'Other',
};

const partnerTypeColors: Record<PartnerType, string> = {
  attorney: 'bg-indigo-100 text-indigo-800',
  accountant: 'bg-teal-100 text-teal-800',
  property_manager: 'bg-amber-100 text-amber-800',
  networking: 'bg-pink-100 text-pink-800',
  past_client: 'bg-green-100 text-green-800',
  other: 'bg-gray-100 text-gray-700',
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
    const statusOrder: Record<string, number> = { overdue: 0, due_soon: 1, on_track: 2 };
    const sa = statusOrder[computeStatus(a.lastTouch, a.tier)];
    const sb = statusOrder[computeStatus(b.lastTouch, b.tier)];
    if (sa !== sb) return sa - sb;
    const tierOrder = { A: 0, B: 1, C: 2 };
    return tierOrder[a.tier] - tierOrder[b.tier];
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Referral Partners</h2>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="px-3 py-1.5 text-xs font-medium bg-[#1a1a1a] text-white rounded-md hover:bg-[#333]"
        >
          {showAdd ? 'Cancel' : '+ Add partner'}
        </button>
      </div>

      {showAdd && (
        <div className="bg-white rounded-lg border border-[#e8e8e0] p-4 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="First name"
              value={newPartner.firstName}
              onChange={(e) => setNewPartner((p) => ({ ...p, firstName: e.target.value }))}
              className="border border-[#e8e8e0] rounded-md px-2 py-1.5 text-sm"
            />
            <input
              placeholder="Last name"
              value={newPartner.lastName}
              onChange={(e) => setNewPartner((p) => ({ ...p, lastName: e.target.value }))}
              className="border border-[#e8e8e0] rounded-md px-2 py-1.5 text-sm"
            />
          </div>
          <input
            placeholder="Company"
            value={newPartner.company}
            onChange={(e) => setNewPartner((p) => ({ ...p, company: e.target.value }))}
            className="w-full border border-[#e8e8e0] rounded-md px-2 py-1.5 text-sm"
          />
          <select
            value={newPartner.partnerType}
            onChange={(e) => setNewPartner((p) => ({ ...p, partnerType: e.target.value as PartnerType }))}
            className="w-full border border-[#e8e8e0] rounded-md px-2 py-1.5 text-sm"
          >
            {(Object.keys(partnerTypeLabels) as PartnerType[]).map((t) => (
              <option key={t} value={t}>
                {partnerTypeLabels[t]}
              </option>
            ))}
          </select>
          <button
            onClick={addPartner}
            className="px-3 py-1.5 text-xs font-medium bg-[#059669] text-white rounded-md hover:bg-[#047857]"
          >
            Add
          </button>
        </div>
      )}

      {sorted.length === 0 && !showAdd && (
        <div className="bg-white rounded-lg p-8 border border-[#e8e8e0] text-center text-gray-500">
          No referral partners yet. Click &quot;Add partner&quot; to get started, or import a CSV with Focus_Type__c set to &quot;Referral Partner&quot;.
        </div>
      )}

      <div className="space-y-3">
        {sorted.map((partner) => {
          const status = computeStatus(partner.lastTouch, partner.tier);
          const sp = statusPill[status];
          const isExpanded = expanded === partner.id;
          return (
            <div key={partner.id} className="bg-white rounded-lg border border-[#e8e8e0]">
              <button
                onClick={() => setExpanded(isExpanded ? null : partner.id)}
                className="w-full p-4 text-left"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-teal-600 text-white flex items-center justify-center text-sm font-bold">
                      {getInitials(partner.firstName, partner.lastName)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">
                          {partner.firstName} {partner.lastName}
                        </span>
                        <span className="text-sm text-gray-500">{partner.company}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${partnerTypeColors[partner.partnerType]}`}>
                          {partnerTypeLabels[partner.partnerType]}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${tierColors[partner.tier]}`}>
                          Tier {partner.tier}
                        </span>
                        <span className="text-xs text-gray-500">{partner.referralCount} referrals</span>
                      </div>
                      <div className="flex gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                        <span>Last: {partner.lastTouch || 'Never'}</span>
                        <span>Next due: {partner.nextDue || 'ASAP'}</span>
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
                    <p className="text-xs font-medium text-gray-500 mb-1">Type</p>
                    <select
                      value={partner.partnerType}
                      onChange={(e) => changeType(partner.id, e.target.value as PartnerType)}
                      className="border border-[#e8e8e0] rounded-md px-2 py-1 text-xs"
                    >
                      {(Object.keys(partnerTypeLabels) as PartnerType[]).map((t) => (
                        <option key={t} value={t}>
                          {partnerTypeLabels[t]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">Tier</p>
                    <div className="flex gap-2">
                      {(['A', 'B', 'C'] as RelationshipTier[]).map((t) => (
                        <button
                          key={t}
                          onClick={() => changeTier(partner.id, t)}
                          className={`px-3 py-1 text-xs font-medium rounded-md ${
                            partner.tier === t
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
                      onClick={() => logTouch(partner.id)}
                      className="px-3 py-1.5 text-xs font-medium bg-[#059669] text-white rounded-md hover:bg-[#047857]"
                    >
                      Log touch today
                    </button>
                    <button
                      onClick={() => copyText(getPartnerNurtureText(partner), `${partner.id}-text`)}
                      className="px-3 py-1.5 text-xs font-medium bg-[#1a1a1a] text-white rounded-md hover:bg-[#333]"
                    >
                      {copied === `${partner.id}-text` ? 'Copied!' : 'Copy text'}
                    </button>
                    <button
                      onClick={() => copyText(getPartnerNurtureEmail(partner), `${partner.id}-email`)}
                      className="px-3 py-1.5 text-xs font-medium bg-[#5b21b6] text-white rounded-md hover:bg-[#4c1d95]"
                    >
                      {copied === `${partner.id}-email` ? 'Copied!' : 'Copy email'}
                    </button>
                    <button
                      onClick={() => copyText(getPartnerLinkedIn(partner), `${partner.id}-li`)}
                      className="px-3 py-1.5 text-xs font-medium bg-[#1e40af] text-white rounded-md hover:bg-[#1e3a8a]"
                    >
                      {copied === `${partner.id}-li` ? 'Copied!' : 'Copy LinkedIn'}
                    </button>
                  </div>
                  <textarea
                    placeholder="Add notes..."
                    value={notes[partner.id] ?? partner.notes}
                    onChange={(e) => handleNoteChange(partner.id, e.target.value)}
                    className="w-full border border-[#e8e8e0] rounded-md p-2 text-sm resize-none h-20"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
