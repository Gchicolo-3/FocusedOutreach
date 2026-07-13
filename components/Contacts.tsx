'use client';

import { useState, useEffect } from 'react';
import {
  getBrokers,
  getPartners,
  getProspects,
  getColdBrokers,
  getPinnedToday,
  pinToToday,
  unpinToday,
} from '@/lib/storage';
import { startCall } from '@/lib/sendActions';
import { C, F, labelMono, btnPrimary, btnGhost, pillStyle } from '@/lib/design';

type Source = 'broker' | 'partner' | 'prospect' | 'cold_broker';
type ContactRow = {
  id: string;
  source: Source;
  name: string;
  company: string;
  tier: string; // A/B/C for relationships, T1/T2/T3 for prospects, '' for cold
  lastTouch: string;
  nextDue: string;
  email?: string;
  phone?: string;
};
type SortKey = 'name' | 'company' | 'source' | 'tier' | 'lastTouch' | 'nextDue';
type SortDir = 'asc' | 'desc';

// Unified tier ordering across sources: relationship tiers first (A..D), then
// prospect lead tiers (hottest first), cold/unknown last.
const tierRank: Record<string, number> = {
  A: 0, B: 1, C: 2, D: 3, T1: 4, T2: 5, T3: 6,
};

function dateVal(v: string): number {
  if (!v) return NaN;
  return Date.parse(v);
}

function compareRows(a: ContactRow, b: ContactRow, key: SortKey, dir: SortDir): number {
  const flip = dir === 'asc' ? 1 : -1;

  if (key === 'tier') {
    return flip * ((tierRank[a.tier] ?? 9) - (tierRank[b.tier] ?? 9));
  }
  if (key === 'lastTouch' || key === 'nextDue') {
    const av = dateVal(a[key]);
    const bv = dateVal(b[key]);
    const aNan = Number.isNaN(av);
    const bNan = Number.isNaN(bv);
    // Blanks always sort last, regardless of direction.
    if (aNan && bNan) return 0;
    if (aNan) return 1;
    if (bNan) return -1;
    return flip * (av - bv);
  }
  return flip * String(a[key] || '').localeCompare(String(b[key] || ''));
}

const sourceLabel: Record<Source, string> = {
  broker: 'Broker',
  partner: 'Partner',
  prospect: 'Prospect',
  cold_broker: 'New Broker',
};
const sourcePill: Record<Source, 'purple' | 'teal' | 'accent' | 'blue'> = {
  broker: 'purple',
  partner: 'teal',
  prospect: 'accent',
  cold_broker: 'blue',
};
const filters: Array<{ id: 'all' | Source; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'broker', label: 'Brokers' },
  { id: 'partner', label: 'Partners' },
  { id: 'prospect', label: 'Prospects' },
  { id: 'cold_broker', label: 'New Brokers' },
];

export default function Contacts({ onGoToToday }: { onGoToToday?: () => void }) {
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | Source>('all');
  const [sortKey, setSortKey] = useState<SortKey>('nextDue');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  useEffect(() => {
    (async () => {
      const [brokers, partners, prospects, cold, pinned] = await Promise.all([
        getBrokers(),
        getPartners(),
        getProspects(),
        getColdBrokers(),
        getPinnedToday(),
      ]);
      const brokerRows: ContactRow[] = brokers.map((x) => ({
        id: x.id,
        source: 'broker',
        name: `${x.firstName} ${x.lastName}`.trim(),
        company: x.firm,
        tier: x.tier,
        lastTouch: x.lastTouch || '',
        nextDue: x.nextDue || '',
        email: x.email,
        phone: x.mobile || x.phone,
      }));
      const partnerRows: ContactRow[] = partners.map((x) => ({
        id: x.id,
        source: 'partner',
        name: `${x.firstName} ${x.lastName}`.trim(),
        company: x.company,
        tier: x.tier,
        lastTouch: x.lastTouch || '',
        nextDue: x.nextDue || '',
        email: x.email,
        phone: x.phone,
      }));
      const prospectRows: ContactRow[] = prospects.map((x) => ({
        id: x.id,
        source: 'prospect',
        name: x.contact,
        company: x.company,
        tier: x.tier ? `T${x.tier}` : '',
        lastTouch: x.lastTouch || x.date || '',
        nextDue: '',
        email: x.email,
        phone: x.phone,
      }));
      const coldRows: ContactRow[] = cold.map((x) => ({
        id: x.id,
        source: 'cold_broker',
        name: x.name,
        company: x.firm,
        tier: '',
        lastTouch: '',
        nextDue: '',
        email: x.email,
        phone: x.mobile || x.phone,
      }));
      setRows([...brokerRows, ...partnerRows, ...prospectRows, ...coldRows]);
      setPinnedIds(new Set(pinned.map((e) => e.id)));
      setLoading(false);
    })();
  }, []);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  async function togglePin(row: ContactRow) {
    if (pinnedIds.has(row.id)) {
      await unpinToday(row.id);
      setPinnedIds((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
    } else {
      await pinToToday(row.id, row.source);
      setPinnedIds((prev) => new Set(prev).add(row.id));
    }
  }

  const q = search.trim().toLowerCase();
  const filtered = rows
    .filter((r) => sourceFilter === 'all' || r.source === sourceFilter)
    .filter((r) => !q || r.name.toLowerCase().includes(q) || r.company.toLowerCase().includes(q))
    .sort((a, b) => compareRows(a, b, sortKey, sortDir));

  const pinnedCount = pinnedIds.size;

  const th = (label: string, key: SortKey, align: 'left' | 'center' = 'left') => (
    <th
      onClick={() => toggleSort(key)}
      style={{
        ...labelMono,
        textAlign: align,
        padding: '10px 12px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        userSelect: 'none',
        borderBottom: `1px solid ${C.border}`,
        color: sortKey === key ? C.text : C.muted,
      }}
    >
      {label}
      {sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  );

  return (
    <div className="flex flex-col gap-4 fade-up">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 style={{ fontFamily: F.display, fontSize: 18, fontWeight: 700, color: C.text }}>
          Contacts
        </h2>
        <div className="flex items-center gap-3">
          {pinnedCount > 0 && onGoToToday && (
            <button onClick={onGoToToday} style={{ ...labelMono, color: C.accent, cursor: 'pointer' }}>
              {pinnedCount} pinned → view in Today
            </button>
          )}
          <span style={labelMono}>{filtered.length} shown</span>
        </div>
      </div>

      {/* Search + source filter */}
      <div className="flex gap-2 flex-wrap items-center">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or company…"
          style={{
            flex: '1 1 220px',
            background: C.surface2,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 13,
            color: C.text,
          }}
        />
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => setSourceFilter(f.id)}
            style={sourceFilter === f.id ? btnPrimary : btnGhost}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ ...labelMono, padding: 24, textAlign: 'center' }}>Loading contacts…</div>
      ) : (
        <div
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            overflowX: 'auto',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {th('Name', 'name')}
                {th('Company', 'company')}
                {th('Type', 'source')}
                {th('Tier', 'tier', 'center')}
                {th('Last touch', 'lastTouch')}
                {th('Next due', 'nextDue')}
                <th
                  style={{
                    ...labelMono,
                    textAlign: 'right',
                    padding: '10px 12px',
                    borderBottom: `1px solid ${C.border}`,
                  }}
                >
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const isPinned = pinnedIds.has(r.id);
                return (
                  <tr key={`${r.source}-${r.id}`} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: C.text, whiteSpace: 'nowrap' }}>
                      {r.name}
                    </td>
                    <td style={{ padding: '10px 12px', color: C.muted }}>{r.company}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={pillStyle(sourcePill[r.source])}>{sourceLabel[r.source]}</span>
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'center', color: C.text }}>
                      {r.tier || '—'}
                    </td>
                    <td style={{ padding: '10px 12px', color: C.muted, whiteSpace: 'nowrap' }}>
                      {r.lastTouch || '—'}
                    </td>
                    <td style={{ padding: '10px 12px', color: C.muted, whiteSpace: 'nowrap' }}>
                      {r.nextDue || '—'}
                    </td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <div className="flex gap-2 justify-end">
                        {r.phone && (
                          <button
                            onClick={() => startCall(r.phone!)}
                            title={`Call ${r.name}`}
                            style={{ ...btnGhost, padding: '6px 10px' }}
                          >
                            📞
                          </button>
                        )}
                        <button
                          onClick={() => togglePin(r)}
                          style={{
                            ...(isPinned ? btnGhost : btnPrimary),
                            padding: '6px 12px',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {isPinned ? '✓ Added' : '+ Today'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ ...labelMono, padding: 24, textAlign: 'center' }}>
                    No contacts match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ ...labelMono, color: C.muted2 }}>
        Added contacts appear at the top of Do This Now, where you can email, text, or call them.
      </div>
    </div>
  );
}
