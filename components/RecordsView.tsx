'use client';

// The single-screen records view. Every record tab (Brokers, Cold Brokers,
// Potential Projects, Referral Partners, Not Worth Pursuing, Blast Only) is a
// filter over the same loaded dataset — one component, no navigation, no
// separate page per record. Rows expand in place for editing; bucket changes
// and cross-table moves are single actions.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Bucket, RelationshipTier } from '@/types';
import {
  getBrokers,
  getPartners,
  getProspects,
  getColdBrokers,
  getPinnedToday,
  pinToToday,
  unpinToday,
  getLastLoadError,
  clearLoadError,
} from '@/lib/storage';
import {
  RecordSource,
  BUCKET_OPTIONS,
  updateRecordColumns,
  setBucket,
  moveRecord,
} from '@/lib/records';
import { computeNextDue, computeStatus } from '@/lib/cadence';
import { startCall, openInMessages, openInOutlook } from '@/lib/sendActions';
import { C, F, labelMono, btnPrimary, btnSecondary, btnGhost, pillStyle, inputBase } from '@/lib/design';

export type RecordTab =
  | 'brokers'
  | 'cold-brokers'
  | 'projects'
  | 'partners'
  | 'not-worth-pursuing'
  | 'blast-only'
  | 'monthly-outreach';

type Row = {
  id: string;
  source: RecordSource;
  name: string;
  firstName: string;
  lastName: string;
  company: string;
  title: string;
  email: string;
  phone: string;
  mobile: string;
  linkedin: string;
  tier: string; // 'A'|'B'|'C' for relationships, '1'|'2'|'3' for prospects, '' for cold
  bucket: Bucket;
  persona: string | null;
  partnerType: string;
  coldStatus: string;
  isEnterprise: boolean;
  notes: string;
  lastTouch: string;
  nextDue: string;
  dealCount: number;
  referralCount: number;
  dismissed: boolean;
};

type SortKey = 'nextDue' | 'lastTouch' | 'tier' | 'name' | 'company';

const sourceLabel: Record<RecordSource, string> = {
  broker: 'Broker',
  partner: 'Partner',
  prospect: 'Prospect',
  cold_broker: 'Cold Broker',
};
const sourcePill: Record<RecordSource, 'purple' | 'teal' | 'accent' | 'blue'> = {
  broker: 'purple',
  partner: 'teal',
  prospect: 'accent',
  cold_broker: 'blue',
};

const personaLabels: Record<string, string> = {
  tenant_rep: 'Tenant Rep',
  landlord_rep: 'Landlord Rep',
  landlord: 'Landlord',
  property_mgr: 'Property Mgr',
  partner: 'Partner',
  end_user: 'End User',
  other: 'Other',
};

const partnerTypeLabels: Record<string, string> = {
  attorney: 'Attorney',
  accountant: 'Accountant',
  property_manager: 'Property Mgr',
  networking: 'Networking',
  past_client: 'Past Client',
  other: 'Other',
};

const coldStatusLabels: Record<string, string> = {
  new: 'New',
  outreach_sent: 'Outreach Sent',
  connected: 'Connected',
  active_broker: 'Promoted',
};

const viewTitles: Record<RecordTab, string> = {
  brokers: 'Brokers',
  'cold-brokers': 'Cold Brokers',
  projects: 'Potential Projects',
  partners: 'Referral Partners',
  'not-worth-pursuing': 'Not Worth Pursuing',
  'blast-only': 'Blast Only',
  'monthly-outreach': 'Monthly Outreach',
};

const viewHints: Record<RecordTab, string> = {
  brokers: 'Active broker relationships. Edit in place; use the bucket to move someone out.',
  'cold-brokers': 'Cold outreach queue — the cold_brokers list plus anyone bucketed Cold.',
  projects: 'Prospects. Toggle Enterprise to see the $200k+ end-user targets.',
  partners: 'Referral partner relationships.',
  'not-worth-pursuing': 'Parked across all tables. Set bucket back to Active to restore.',
  'blast-only': 'Mass-send only (Salesforce D tier) — no cadence, no daily queue.',
  'monthly-outreach':
    'Never-connected contacts after 3 unanswered touchpoints. One cold touch per 30 days; auto-restored to Active when they engage.',
};

const tierRank: Record<string, number> = { A: 0, B: 1, C: 2, '1': 0, '2': 1, '3': 2 };

function dateVal(v: string): number {
  if (!v) return NaN;
  return Date.parse(v);
}

function compareRows(a: Row, b: Row, key: SortKey): number {
  if (key === 'tier') return (tierRank[a.tier] ?? 9) - (tierRank[b.tier] ?? 9);
  if (key === 'lastTouch' || key === 'nextDue') {
    const av = dateVal(a[key]);
    const bv = dateVal(b[key]);
    const aNan = Number.isNaN(av);
    const bNan = Number.isNaN(bv);
    if (aNan && bNan) return 0;
    if (aNan) return 1; // blanks last
    if (bNan) return -1;
    return av - bv;
  }
  return String(a[key] || '').localeCompare(String(b[key] || ''));
}

const sortOptions: Array<{ key: SortKey; label: string }> = [
  { key: 'nextDue', label: 'Next due' },
  { key: 'lastTouch', label: 'Last touch' },
  { key: 'tier', label: 'Tier' },
  { key: 'name', label: 'Name' },
  { key: 'company', label: 'Company' },
];

// Maps an edited field back to the right column for the row's table.
function colsForField(row: Row, field: string, value: string): Record<string, unknown> | null {
  const v = value.trim();
  switch (field) {
    case 'name':
      if (row.source === 'prospect') return { contact: v };
      if (row.source === 'cold_broker') return { name: v };
      return null;
    case 'firstName':
      return { first_name: v };
    case 'lastName':
      return { last_name: v };
    case 'company':
      return row.source === 'broker' || row.source === 'cold_broker'
        ? { firm: v || 'Unknown' }
        : { company: v || 'Unknown' };
    case 'title':
      return { title: v };
    case 'email':
      return { email: v || null };
    case 'phone':
      return { phone: v || null };
    case 'mobile':
      return { mobile: v || null };
    case 'linkedin':
      return { linkedin: v || null };
    case 'notes':
      return row.source === 'prospect' ? { comments: value } : { notes: value };
    default:
      return null;
  }
}

function fieldLabelStyle(): React.CSSProperties {
  return { ...labelMono, marginBottom: 4, display: 'block' };
}

export default function RecordsView({ view }: { view: RecordTab }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('nextDue');
  const [personaFilter, setPersonaFilter] = useState<string>('all');
  const [enterpriseFilter, setEnterpriseFilter] = useState<'all' | 'standard' | 'enterprise'>('all');
  const [coldStatusFilter, setColdStatusFilter] = useState<string>('pending');
  const [moving, setMoving] = useState(false);

  const load = useCallback(async () => {
    clearLoadError();
    const [brokers, partners, prospects, cold, pinned] = await Promise.all([
      getBrokers(),
      getPartners(),
      getProspects(),
      getColdBrokers(),
      getPinnedToday(),
    ]);
    const all: Row[] = [
      ...brokers.map((b): Row => ({
        id: b.id, source: 'broker',
        name: `${b.firstName} ${b.lastName}`.trim(),
        firstName: b.firstName, lastName: b.lastName,
        company: b.firm, title: b.title || '',
        email: b.email || '', phone: b.phone || '', mobile: b.mobile || '', linkedin: b.linkedin || '',
        tier: b.tier, bucket: b.bucket ?? 'active', persona: b.persona ?? null,
        partnerType: '', coldStatus: '', isEnterprise: false,
        notes: b.notes || '', lastTouch: b.lastTouch || '', nextDue: b.nextDue || '',
        dealCount: b.dealCount || 0, referralCount: 0, dismissed: !!b.dismissed,
      })),
      ...partners.map((p): Row => ({
        id: p.id, source: 'partner',
        name: `${p.firstName} ${p.lastName}`.trim(),
        firstName: p.firstName, lastName: p.lastName,
        company: p.company, title: p.title || '',
        email: p.email || '', phone: p.phone || '', mobile: '', linkedin: '',
        tier: p.tier, bucket: p.bucket ?? 'active', persona: p.persona ?? null,
        partnerType: p.partnerType || 'other', coldStatus: '', isEnterprise: false,
        notes: p.notes || '', lastTouch: p.lastTouch || '', nextDue: p.nextDue || '',
        dealCount: 0, referralCount: p.referralCount || 0, dismissed: !!p.dismissed,
      })),
      ...prospects.map((p): Row => ({
        id: p.id, source: 'prospect',
        name: p.contact, firstName: '', lastName: '',
        company: p.company, title: '',
        email: p.email || '', phone: p.phone || '', mobile: '', linkedin: '',
        tier: p.tier ? String(p.tier) : '', bucket: p.bucket ?? 'active', persona: null,
        partnerType: '', coldStatus: '', isEnterprise: !!p.isEnterprise,
        notes: p.comments || '', lastTouch: p.lastTouch || p.date || '', nextDue: p.nextDue || '',
        dealCount: 0, referralCount: 0, dismissed: !!p.dismissed,
      })),
      ...cold.map((cb): Row => ({
        id: cb.id, source: 'cold_broker',
        name: cb.name, firstName: '', lastName: '',
        company: cb.firm, title: cb.title || '',
        email: cb.email || '', phone: cb.phone || '', mobile: cb.mobile || '', linkedin: cb.linkedin || '',
        tier: '', bucket: 'cold', persona: null,
        partnerType: '', coldStatus: cb.status || 'new', isEnterprise: false,
        notes: '', lastTouch: '', nextDue: '',
        dealCount: 0, referralCount: 0, dismissed: !!cb.dismissed,
      })),
    ];
    setRows(all);
    setPinnedIds(new Set(pinned.map((e) => e.id)));
    setLoadError(getLastLoadError());
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  // Collapse the open editor and clear stale save errors when switching tabs
  // (adjusting state during render, per the you-might-not-need-an-effect docs).
  const [prevView, setPrevView] = useState<RecordTab>(view);
  if (prevView !== view) {
    setPrevView(view);
    setExpanded(null);
    setSaveError(null);
  }

  function patchRow(id: string, source: RecordSource, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.id === id && r.source === source ? { ...r, ...patch } : r)));
  }

  async function persist(row: Row, cols: Record<string, unknown>, patch: Partial<Row>) {
    patchRow(row.id, row.source, patch); // optimistic
    const err = await updateRecordColumns(row.source, row.id, cols);
    if (err) {
      setSaveError(`Save failed — ${err}`);
      await load(); // reload truth from the DB
    } else {
      setSaveError(null);
    }
  }

  function saveField(row: Row, field: string, value: string) {
    if ((row[field as keyof Row] ?? '') === value) return;
    const cols = colsForField(row, field, value);
    if (!cols) return;
    const patch: Partial<Row> = { [field]: value } as Partial<Row>;
    if (field === 'name' || field === 'firstName' || field === 'lastName') {
      const merged = { ...row, ...patch };
      patch.name =
        row.source === 'prospect' || row.source === 'cold_broker'
          ? value
          : `${merged.firstName} ${merged.lastName}`.trim();
    }
    persist(row, cols, patch);
  }

  function saveTier(row: Row, tier: string) {
    if (row.tier === tier) return;
    if (row.source === 'prospect') {
      persist(row, { tier: Number(tier) }, { tier });
      return;
    }
    // Broker/partner tier changes reset the cadence math, same as the old views.
    const rel = tier as RelationshipTier;
    const nextDue = computeNextDue(row.lastTouch, rel);
    const cols: Record<string, unknown> =
      row.source === 'broker'
        ? { tier: rel, next_due: nextDue, status: computeStatus(row.lastTouch, rel) }
        : { tier: rel, next_due: nextDue };
    persist(row, cols, { tier, nextDue });
  }

  async function changeBucket(row: Row, bucket: Bucket) {
    if (row.source === 'cold_broker' || row.bucket === bucket) return;
    // Restoring to Active also clears the legacy dismissed flag so the record
    // actually re-enters the active views and the cadence engine.
    const clearsDismissed = bucket === 'active' && row.dismissed;
    patchRow(row.id, row.source, { bucket, ...(clearsDismissed ? { dismissed: false } : {}) });
    const err = clearsDismissed
      ? await updateRecordColumns(row.source, row.id, { bucket, dismissed: false, dismissed_reason: null })
      : await setBucket(row.source, row.id, bucket);
    if (err) {
      setSaveError(`Save failed — ${err}`);
      await load();
    } else {
      setSaveError(null);
    }
  }

  async function handleMove(row: Row, to: 'broker' | 'partner' | 'prospect') {
    const ok = window.confirm(
      `Move ${row.name || 'this record'} to ${viewTitles[to === 'prospect' ? 'projects' : to === 'broker' ? 'brokers' : 'partners']}? ` +
        `Same id, so touch history stays attached.`
    );
    if (!ok) return;
    setMoving(true);
    const err = await moveRecord(row.id, row.source, to);
    setMoving(false);
    if (err) {
      setSaveError(err);
    } else {
      setSaveError(null);
      setExpanded(null);
      await load();
    }
  }

  async function togglePin(row: Row) {
    if (pinnedIds.has(row.id)) {
      setPinnedIds((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
      await unpinToday(row.id);
    } else {
      setPinnedIds((prev) => new Set(prev).add(row.id));
      await pinToToday(row.id, row.source);
    }
  }

  // ---- filtering ----
  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    let out = rows;
    if (view === 'brokers') {
      out = out.filter((r) => r.source === 'broker' && r.bucket === 'active' && !r.dismissed);
      if (personaFilter !== 'all') {
        out = out.filter((r) => (personaFilter === 'none' ? !r.persona : r.persona === personaFilter));
      }
    } else if (view === 'cold-brokers') {
      out = out.filter((r) =>
        r.source === 'cold_broker' ? true : r.bucket === 'cold'
      );
      if (coldStatusFilter === 'pending') {
        out = out.filter((r) => r.source !== 'cold_broker' || r.coldStatus !== 'active_broker');
      } else if (coldStatusFilter !== 'all') {
        out = out.filter((r) => r.source === 'cold_broker' && r.coldStatus === coldStatusFilter);
      }
    } else if (view === 'projects') {
      out = out.filter((r) => r.source === 'prospect' && r.bucket === 'active' && !r.dismissed);
      if (enterpriseFilter === 'enterprise') out = out.filter((r) => r.isEnterprise);
      if (enterpriseFilter === 'standard') out = out.filter((r) => !r.isEnterprise);
    } else if (view === 'partners') {
      out = out.filter((r) => r.source === 'partner' && r.bucket === 'active' && !r.dismissed);
    } else if (view === 'monthly-outreach') {
      out = out.filter((r) => r.bucket === 'monthly_outreach');
    } else if (view === 'not-worth-pursuing') {
      // bucket is canonical; legacy dismissed rows surface here too so nothing
      // is invisible.
      out = out.filter(
        (r) => r.source !== 'cold_broker' && (r.bucket === 'not_worth_pursuing' || r.dismissed)
      );
    } else {
      out = out.filter((r) => r.bucket === 'blast_only');
    }
    if (q) {
      out = out.filter(
        (r) => r.name.toLowerCase().includes(q) || r.company.toLowerCase().includes(q)
      );
    }
    return [...out].sort((a, b) => compareRows(a, b, sortKey));
  }, [rows, view, q, sortKey, personaFilter, enterpriseFilter, coldStatusFilter]);

  const showSourcePill =
    view === 'cold-brokers' || view === 'not-worth-pursuing' || view === 'blast-only' || view === 'monthly-outreach';

  const personaChips = [
    { id: 'all', label: 'All' },
    { id: 'tenant_rep', label: 'Tenant Rep' },
    { id: 'landlord_rep', label: 'Landlord Rep' },
    { id: 'landlord', label: 'Landlord' },
    { id: 'property_mgr', label: 'Property Mgr' },
    { id: 'partner', label: 'Partner' },
    { id: 'other', label: 'Other' },
    { id: 'none', label: 'Unclassified' },
  ];

  const selectStyle: React.CSSProperties = {
    background: C.surface2,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: '7px 10px',
    fontSize: 12,
    color: C.text,
    fontFamily: F.mono,
  };

  // ---- inline editor ----
  function textField(row: Row, field: string, label: string, value: string, span2 = false) {
    return (
      <div style={span2 ? { gridColumn: 'span 2' } : undefined}>
        <span style={fieldLabelStyle()}>{label}</span>
        <input
          defaultValue={value}
          onBlur={(e) => saveField(row, field, e.target.value)}
          style={inputBase}
        />
      </div>
    );
  }

  function renderEditor(row: Row) {
    const tiers = row.source === 'prospect' ? ['1', '2', '3'] : ['A', 'B', 'C'];
    return (
      <div style={{ padding: '16px 20px 20px', borderTop: `1px solid ${C.border}` }}>
        {/* Contact info */}
        <div className="grid grid-cols-2 gap-3" style={{ marginBottom: 16 }}>
          {row.source === 'broker' || row.source === 'partner' ? (
            <>
              {textField(row, 'firstName', 'First name', row.firstName)}
              {textField(row, 'lastName', 'Last name', row.lastName)}
            </>
          ) : (
            textField(row, 'name', 'Name', row.name, true)
          )}
          {textField(row, 'company', row.source === 'partner' || row.source === 'prospect' ? 'Company' : 'Firm', row.company)}
          {row.source !== 'prospect' && textField(row, 'title', 'Title', row.title)}
          {textField(row, 'email', 'Email', row.email)}
          {textField(row, 'phone', 'Phone', row.phone)}
          {(row.source === 'broker' || row.source === 'cold_broker') && (
            <>
              {textField(row, 'mobile', 'Mobile', row.mobile)}
              {textField(row, 'linkedin', 'LinkedIn', row.linkedin)}
            </>
          )}
        </div>

        {/* Classification */}
        <div className="flex gap-6 flex-wrap" style={{ marginBottom: 16 }}>
          {row.source !== 'cold_broker' && (
            <div>
              <span style={fieldLabelStyle()}>Tier</span>
              <div className="flex gap-2">
                {tiers.map((t) => (
                  <button
                    key={t}
                    onClick={() => saveTier(row, t)}
                    style={{ ...(row.tier === t ? btnPrimary : btnGhost), padding: '6px 12px' }}
                  >
                    {row.source === 'prospect' ? `T${t}` : `Tier ${t}`}
                  </button>
                ))}
              </div>
            </div>
          )}
          {row.source === 'broker' && (
            <div>
              <span style={fieldLabelStyle()}>Persona</span>
              <select
                value={row.persona || ''}
                onChange={(e) =>
                  persist(row, { persona: e.target.value || null }, { persona: e.target.value || null })
                }
                style={{ ...inputBase, width: 'auto', minWidth: 160 }}
              >
                <option value="">Unclassified</option>
                {Object.entries(personaLabels).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
          )}
          {row.source === 'partner' && (
            <div>
              <span style={fieldLabelStyle()}>Type</span>
              <select
                value={row.partnerType}
                onChange={(e) => persist(row, { partner_type: e.target.value }, { partnerType: e.target.value })}
                style={{ ...inputBase, width: 'auto', minWidth: 160 }}
              >
                {Object.entries(partnerTypeLabels).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
          )}
          {row.source === 'prospect' && (
            <div>
              <span style={fieldLabelStyle()}>Deal size</span>
              <button
                onClick={() =>
                  persist(row, { is_enterprise: !row.isEnterprise }, { isEnterprise: !row.isEnterprise })
                }
                style={{ ...(row.isEnterprise ? btnPrimary : btnGhost), padding: '6px 12px' }}
              >
                {row.isEnterprise ? '★ Enterprise $200k+' : 'Standard'}
              </button>
            </div>
          )}
          {row.source === 'cold_broker' && (
            <div>
              <span style={fieldLabelStyle()}>Status</span>
              <select
                value={row.coldStatus}
                onChange={(e) => persist(row, { status: e.target.value }, { coldStatus: e.target.value })}
                style={{ ...inputBase, width: 'auto', minWidth: 160 }}
              >
                {Object.entries(coldStatusLabels).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Bucket — one click moves the record between tabs */}
        {row.source !== 'cold_broker' && (
          <div style={{ marginBottom: 16 }}>
            <span style={fieldLabelStyle()}>Bucket</span>
            <div className="flex gap-2 flex-wrap">
              {BUCKET_OPTIONS.map((b) => (
                <button
                  key={b.value}
                  onClick={() => changeBucket(row, b.value)}
                  style={{ ...(row.bucket === b.value ? btnPrimary : btnGhost), padding: '6px 12px' }}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        <div style={{ marginBottom: 16 }}>
          <span style={fieldLabelStyle()}>Notes</span>
          <textarea
            defaultValue={row.notes}
            placeholder="Add notes..."
            onBlur={(e) => saveField(row, 'notes', e.target.value)}
            style={{ ...inputBase, height: 80, resize: 'none' }}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => togglePin(row)}
            style={{ ...(pinnedIds.has(row.id) ? btnGhost : btnPrimary), padding: '7px 12px' }}
          >
            {pinnedIds.has(row.id) ? '✓ In Today' : '+ Today'}
          </button>
          <div style={{ flex: 1 }} />
          <span style={{ ...labelMono, marginRight: 4 }}>Move to</span>
          {row.source !== 'broker' && (
            <button disabled={moving} onClick={() => handleMove(row, 'broker')} style={btnSecondary}>
              Brokers
            </button>
          )}
          {row.source !== 'partner' && (
            <button disabled={moving} onClick={() => handleMove(row, 'partner')} style={btnSecondary}>
              Partners
            </button>
          )}
          {row.source !== 'prospect' && row.source !== 'cold_broker' && (
            <button disabled={moving} onClick={() => handleMove(row, 'prospect')} style={btnSecondary}>
              Projects
            </button>
          )}
        </div>
      </div>
    );
  }

  // ---- render ----
  return (
    <div className="flex flex-col gap-3 fade-up">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h2 style={{ fontFamily: F.display, fontSize: 18, fontWeight: 700, color: C.text }}>
            {viewTitles[view]}
          </h2>
          <span style={{ ...labelMono, textTransform: 'none', letterSpacing: 0 }}>{viewHints[view]}</span>
        </div>
        <span style={labelMono}>{filtered.length} shown</span>
      </div>

      {loadError && (
        <div style={{ background: C.redBg, border: `1px solid ${C.red}`, borderRadius: 8, padding: '10px 12px', color: C.red, fontSize: 13 }}>
          Data failed to load — {loadError}
        </div>
      )}
      {saveError && (
        <div style={{ background: C.redBg, border: `1px solid ${C.red}`, borderRadius: 8, padding: '10px 12px', color: C.red, fontSize: 13 }}>
          {saveError}
        </div>
      )}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search name or company…"
        style={{
          background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8,
          padding: '9px 12px', fontSize: 14, color: C.text, width: '100%',
        }}
      />

      {/* Per-view sub-filters */}
      {view === 'brokers' && (
        <div className="flex gap-2 flex-wrap">
          {personaChips.map((p) => (
            <button
              key={p.id}
              onClick={() => setPersonaFilter(p.id)}
              style={{ ...(personaFilter === p.id ? btnPrimary : btnGhost), padding: '6px 12px' }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      {view === 'projects' && (
        <div className="flex gap-2 flex-wrap">
          {(
            [
              { id: 'all', label: 'All' },
              { id: 'standard', label: 'Standard' },
              { id: 'enterprise', label: '★ Enterprise $200k+' },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              onClick={() => setEnterpriseFilter(f.id)}
              style={{ ...(enterpriseFilter === f.id ? btnPrimary : btnGhost), padding: '6px 12px' }}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
      {view === 'cold-brokers' && (
        <div className="flex gap-2 flex-wrap">
          {[
            { id: 'pending', label: 'Pending' },
            { id: 'new', label: 'New' },
            { id: 'outreach_sent', label: 'Outreach Sent' },
            { id: 'connected', label: 'Connected' },
            { id: 'active_broker', label: 'Promoted' },
            { id: 'all', label: 'All' },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setColdStatusFilter(f.id)}
              style={{ ...(coldStatusFilter === f.id ? btnPrimary : btnGhost), padding: '6px 12px' }}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* Sort */}
      <div className="flex items-center gap-2">
        <span style={labelMono}>Sort</span>
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} style={selectStyle}>
          {sortOptions.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div style={{ ...labelMono, padding: 24, textAlign: 'center' }}>Loading records…</div>
      ) : filtered.length === 0 ? (
        <div
          style={{
            background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12,
            padding: 24, textAlign: 'center', color: C.muted,
          }}
        >
          Nothing here{q ? ' matching your search' : ''}.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((r) => {
            const key = `${r.source}-${r.id}`;
            const isExpanded = expanded === key;
            const meta = [
              r.lastTouch && `Last ${r.lastTouch}`,
              r.nextDue && `Due ${r.nextDue}`,
              r.source === 'broker' && r.dealCount ? `${r.dealCount} deals` : '',
              r.source === 'partner' && r.referralCount ? `${r.referralCount} referrals` : '',
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <div
                key={key}
                style={{
                  background: C.surface,
                  border: `1px solid ${isExpanded ? C.border2 : C.border}`,
                  borderRadius: 12,
                }}
              >
                <div
                  className="flex items-center justify-between gap-3 flex-wrap"
                  style={{ padding: '12px 14px' }}
                >
                  <button
                    onClick={() => setExpanded(isExpanded ? null : key)}
                    style={{ minWidth: 0, flex: '1 1 220px', textAlign: 'left', cursor: 'pointer' }}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        style={{
                          fontFamily: F.display, fontWeight: 600, fontSize: 15, color: C.text,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}
                      >
                        {r.name || '(no name)'}
                      </span>
                      {showSourcePill && <span style={pillStyle(sourcePill[r.source])}>{sourceLabel[r.source]}</span>}
                      {r.tier && (
                        <span style={pillStyle('muted')}>
                          {r.source === 'prospect' ? `T${r.tier}` : r.tier}
                        </span>
                      )}
                      {r.source === 'broker' && r.persona && (
                        <span style={pillStyle('purple')}>{personaLabels[r.persona] || r.persona}</span>
                      )}
                      {r.source === 'partner' && (
                        <span style={pillStyle('teal')}>{partnerTypeLabels[r.partnerType] || r.partnerType}</span>
                      )}
                      {r.source === 'prospect' && r.isEnterprise && (
                        <span style={pillStyle('amber')}>★ $200k+</span>
                      )}
                      {r.source === 'cold_broker' && (
                        <span style={pillStyle(r.coldStatus === 'active_broker' ? 'purple' : r.coldStatus === 'connected' ? 'accent' : r.coldStatus === 'outreach_sent' ? 'amber' : 'blue')}>
                          {coldStatusLabels[r.coldStatus] || r.coldStatus}
                        </span>
                      )}
                      {view === 'not-worth-pursuing' && r.bucket !== 'not_worth_pursuing' && (
                        <span style={pillStyle('red')}>Dismissed</span>
                      )}
                    </div>
                    <div style={{ ...labelMono, marginTop: 3, textTransform: 'none', letterSpacing: 0 }}>
                      {r.company}
                      {meta ? ` · ${meta}` : ''}
                    </div>
                  </button>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {(view === 'not-worth-pursuing' || view === 'blast-only') && r.source !== 'cold_broker' && (
                      <button
                        onClick={() => changeBucket(r, 'active')}
                        style={{ ...btnGhost, padding: '7px 12px', fontSize: 12 }}
                      >
                        ↩ Restore
                      </button>
                    )}
                    {r.source === 'cold_broker' && r.coldStatus !== 'active_broker' && (
                      <button
                        onClick={() => handleMove(r, 'broker')}
                        disabled={moving}
                        style={{ ...btnSecondary, padding: '7px 12px', fontSize: 12 }}
                      >
                        → Active broker
                      </button>
                    )}
                    <button
                      onClick={() => r.email && openInOutlook(r.email, '', '')}
                      disabled={!r.email}
                      title={r.email ? 'Email in Outlook' : 'No email on file'}
                      style={{
                        fontSize: 15, lineHeight: 1, padding: '7px 9px', borderRadius: 8,
                        cursor: r.email ? 'pointer' : 'default',
                        background: C.surface2, border: `1px solid ${C.border}`,
                        opacity: r.email ? 1 : 0.3,
                      }}
                    >
                      ✉️
                    </button>
                    <button
                      onClick={() => (r.mobile || r.phone) && openInMessages(r.mobile || r.phone, '')}
                      disabled={!(r.mobile || r.phone)}
                      title={r.mobile || r.phone ? 'Text' : 'No phone on file'}
                      style={{
                        fontSize: 15, lineHeight: 1, padding: '7px 9px', borderRadius: 8,
                        cursor: r.mobile || r.phone ? 'pointer' : 'default',
                        background: C.surface2, border: `1px solid ${C.border}`,
                        opacity: r.mobile || r.phone ? 1 : 0.3,
                      }}
                    >
                      💬
                    </button>
                    <button
                      onClick={() => (r.mobile || r.phone) && startCall(r.mobile || r.phone)}
                      disabled={!(r.mobile || r.phone)}
                      title={r.mobile || r.phone ? 'Call' : 'No phone on file'}
                      style={{
                        fontSize: 15, lineHeight: 1, padding: '7px 9px', borderRadius: 8,
                        cursor: r.mobile || r.phone ? 'pointer' : 'default',
                        background: C.surface2, border: `1px solid ${C.border}`,
                        opacity: r.mobile || r.phone ? 1 : 0.3,
                      }}
                    >
                      📞
                    </button>
                    <button
                      onClick={() => setExpanded(isExpanded ? null : key)}
                      style={{ ...btnGhost, padding: '7px 12px', fontSize: 12 }}
                    >
                      {isExpanded ? 'Close' : 'Edit'}
                    </button>
                  </div>
                </div>

                {isExpanded && renderEditor(r)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
