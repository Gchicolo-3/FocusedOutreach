'use client';

import { useState, useEffect } from 'react';
import { Partner, PartnerType, RelationshipTier } from '@/types';
import { getPartners, setPartners, updatePartner, logPartnerTouch } from '@/lib/storage';
import { getPartnerNurtureText, getPartnerNurtureEmail, getPartnerLinkedIn } from '@/lib/messages';
import { computeStatus, defaultTierForPartner } from '@/lib/cadence';
import { C, F, labelMono, btnPrimary, btnSecondary, btnGhost, pillStyle, inputBase } from '@/lib/design';
import MessageCard from '@/components/MessageCard';

const tierPill: Record<RelationshipTier, 'purple' | 'teal' | 'amber'> = { A: 'purple', B: 'teal', C: 'amber' };
const statusPill: Record<string, { label: string; variant: 'red' | 'amber' | 'accent' }> = {
  overdue: { label: 'Overdue', variant: 'red' },
  due_soon: { label: 'Due soon', variant: 'amber' },
  on_track: { label: 'On track', variant: 'accent' },
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
  const [showAdd, setShowAdd] = useState(false);
  const [newPartner, setNewPartner] = useState({
    firstName: '',
    lastName: '',
    company: '',
    partnerType: 'other' as PartnerType,
  });

  useEffect(() => {
    (async () => {
      await refresh();
    })();
  }, []);

  async function refresh() {
    setPartnersState(await getPartners());
  }

  async function logTouch(id: string) {
    await logPartnerTouch(id);
    await refresh();
  }

  async function changeTier(id: string, tier: RelationshipTier) {
    await updatePartner(id, { tier });
    await refresh();
  }

  async function changeType(id: string, partnerType: PartnerType) {
    await updatePartner(id, { partnerType });
    await refresh();
  }

  function copyText(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  async function handleNoteChange(id: string, text: string) {
    setNotes((prev) => ({ ...prev, [id]: text }));
    await updatePartner(id, { notes: text });
  }

  async function addPartner() {
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
    const updated = [...(await getPartners()), partner];
    await setPartners(updated);
    await refresh();
    setShowAdd(false);
    setNewPartner({ firstName: '', lastName: '', company: '', partnerType: 'other' });
  }

  const sorted = [...partners].sort((a, b) => {
    const order: Record<string, number> = { overdue: 0, due_soon: 1, on_track: 2 };
    const sa = order[computeStatus(a.lastTouch, a.tier)];
    const sb = order[computeStatus(b.lastTouch, b.tier)];
    if (sa !== sb) return sa - sb;
    const tierOrder = { A: 0, B: 1, C: 2 };
    return tierOrder[a.tier] - tierOrder[b.tier];
  });

  return (
    <div className="flex flex-col gap-4 fade-up">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 style={{ fontFamily: F.display, fontSize: 18, fontWeight: 700, color: C.text }}>Referral Partners</h2>
          <span style={labelMono}>{sorted.length} total</span>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} style={showAdd ? btnGhost : btnPrimary}>
          {showAdd ? 'Cancel' : '+ Add partner'}
        </button>
      </div>

      {showAdd && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
          <div className="grid grid-cols-2 gap-3" style={{ marginBottom: 12 }}>
            <input
              placeholder="First name"
              value={newPartner.firstName}
              onChange={(e) => setNewPartner((p) => ({ ...p, firstName: e.target.value }))}
              style={inputBase}
            />
            <input
              placeholder="Last name"
              value={newPartner.lastName}
              onChange={(e) => setNewPartner((p) => ({ ...p, lastName: e.target.value }))}
              style={inputBase}
            />
          </div>
          <input
            placeholder="Company"
            value={newPartner.company}
            onChange={(e) => setNewPartner((p) => ({ ...p, company: e.target.value }))}
            style={{ ...inputBase, marginBottom: 12 }}
          />
          <select
            value={newPartner.partnerType}
            onChange={(e) => setNewPartner((p) => ({ ...p, partnerType: e.target.value as PartnerType }))}
            style={{ ...inputBase, marginBottom: 12 }}
          >
            {(Object.keys(partnerTypeLabels) as PartnerType[]).map((t) => (
              <option key={t} value={t}>
                {partnerTypeLabels[t]}
              </option>
            ))}
          </select>
          <button onClick={addPartner} style={btnPrimary}>
            Add partner
          </button>
        </div>
      )}

      {sorted.length === 0 && !showAdd && (
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
          No referral partners yet. Add one or import a CSV with Contact Type set to &quot;Referral Partner&quot;.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {sorted.map((partner) => {
          const status = computeStatus(partner.lastTouch, partner.tier);
          const sp = statusPill[status];
          const isExpanded = expanded === partner.id;
          return (
            <div
              key={partner.id}
              style={{
                background: C.surface,
                border: `1px solid ${isExpanded ? C.border2 : C.border}`,
                borderRadius: 12,
              }}
            >
              <button
                onClick={() => setExpanded(isExpanded ? null : partner.id)}
                style={{ width: '100%', padding: 20, textAlign: 'left' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: '50%',
                        background: C.tealBg,
                        color: C.teal,
                        fontFamily: F.display,
                        fontWeight: 700,
                        fontSize: 13,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {getInitials(partner.firstName, partner.lastName)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span style={{ fontFamily: F.display, fontWeight: 600, fontSize: 15, color: C.text }}>
                          {partner.firstName} {partner.lastName}
                        </span>
                        <span style={pillStyle('muted')}>{partnerTypeLabels[partner.partnerType]}</span>
                        <span style={pillStyle(tierPill[partner.tier])}>Tier {partner.tier}</span>
                      </div>
                      <div className="flex gap-3 mt-1 flex-wrap">
                        <span style={labelMono}>{partner.company}</span>
                        <span style={{ ...labelMono, color: C.muted2 }}>·</span>
                        <span style={labelMono}>{partner.referralCount} referrals</span>
                        <span style={{ ...labelMono, color: C.muted2 }}>·</span>
                        <span style={labelMono}>Last {partner.lastTouch || 'never'}</span>
                      </div>
                    </div>
                  </div>
                  <span style={{ ...pillStyle(sp.variant), flexShrink: 0 }}>{sp.label}</span>
                </div>
              </button>

              {isExpanded && (
                <div style={{ padding: '16px 20px 20px', borderTop: `1px solid ${C.border}` }}>
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ ...labelMono, marginBottom: 8 }}>Type</div>
                    <select
                      value={partner.partnerType}
                      onChange={(e) => changeType(partner.id, e.target.value as PartnerType)}
                      style={{ ...inputBase, width: 'auto', minWidth: 200 }}
                    >
                      {(Object.keys(partnerTypeLabels) as PartnerType[]).map((t) => (
                        <option key={t} value={t}>
                          {partnerTypeLabels[t]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ ...labelMono, marginBottom: 8 }}>Tier</div>
                    <div className="flex gap-2">
                      {(['A', 'B', 'C'] as RelationshipTier[]).map((t) => (
                        <button
                          key={t}
                          onClick={() => changeTier(partner.id, t)}
                          style={partner.tier === t ? btnPrimary : btnGhost}
                        >
                          Tier {t}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap" style={{ marginBottom: 16 }}>
                    <button onClick={() => logTouch(partner.id)} style={btnPrimary}>
                      Log touch today
                    </button>
                    <button
                      onClick={() => copyText(getPartnerNurtureEmail(partner), `${partner.id}-email`)}
                      style={btnSecondary}
                    >
                      {copied === `${partner.id}-email` ? 'Copied' : 'Copy email template'}
                    </button>
                    <button
                      onClick={() => copyText(getPartnerLinkedIn(partner), `${partner.id}-li`)}
                      style={btnSecondary}
                    >
                      {copied === `${partner.id}-li` ? 'Copied' : 'Copy LinkedIn template'}
                    </button>
                  </div>
                  <MessageCard
                    contactName={`${partner.firstName} ${partner.lastName}`}
                    company={partner.company}
                    email={partner.email}
                    phone={partner.phone}
                    channel="text"
                    initialMessage={getPartnerNurtureText(partner)}
                    intel={
                      partner.notes ||
                      `${partner.partnerType} referral partner at ${partner.company}. ${partner.referralCount} referrals given.`
                    }
                    lastTouch={partner.lastTouch}
                  />
                  <div style={{ ...labelMono, marginBottom: 8, marginTop: 16 }}>Notes</div>
                  <textarea
                    placeholder="Add notes..."
                    value={notes[partner.id] ?? partner.notes}
                    onChange={(e) => handleNoteChange(partner.id, e.target.value)}
                    style={{ ...inputBase, height: 80, resize: 'none' }}
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
