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
  dismissContact,
  restoreContact,
} from '@/lib/storage';
import { startCall, openInMessages, openInOutlook } from '@/lib/sendActions';
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
  dismissed: boolean;
};
type SortKey = 'name' | 'company' | 'source' | 'tier' | 'lastTouch' | 'nextDue';
type SortDir = 'asc' | 'desc';

const tierRank: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, T1: 4, T2: 5, T3: 6 };

const sortOptions: Array<{ key: SortKey; label: string }> = [
  { key: 'nextDue', label: 'Next due' },
  { key: 'lastTouch', label: 'Last touch' },
  { key: 'tier', label: 'Tier' },
  { key: 'name', label: 'Name' },
  { key: 'company', label: 'Company' },
  { key: 'source', label: 'Type' },
];

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
    if (aNan && bNan) return 0;
    if (aNan) return 1; // blanks always last
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
  { id: 'cold_broker', label: 'New' },
];

// Compact icon button for the per-row channel actions.
function iconBtn(onClick: () => void, icon: string, title: string, disabled?: boolean) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? `${title} (none on file)` : title}
      style={{
        fontSize: 15,
        lineHeight: 1,
        padding: '7px 9px',
        borderRadius: 8,
        cursor: disabled ? 'default' : 'pointer',
        background: C.surface2,
        border: `1px solid ${C.border}`,
        opacity: disabled ? 0.3 : 1,
      }}
    >
      {icon}
    </button>
  );
}

export default function Contacts({ onGoToToday }: { onGoToToday?: () => void }) {
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [showDismissed, setShowDismissed] = useState(false);
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
        id: x.id, source: 'broker', name: `${x.firstName} ${x.lastName}`.trim(),
        company: x.firm, tier: x.tier, lastTouch: x.lastTouch || '', nextDue: x.nextDue || '',
        email: x.email, phone: x.mobile || x.phone, dismissed: !!x.dismissed,
      }));
      const partnerRows: ContactRow[] = partners.map((x) => ({
        id: x.id, source: 'partner', name: `${x.firstName} ${x.lastName}`.trim(),
        company: x.company, tier: x.tier, lastTouch: x.lastTouch || '', nextDue: x.nextDue || '',
        email: x.email, phone: x.phone, dismissed: !!x.dismissed,
      }));
      const prospectRows: ContactRow[] = prospects.map((x) => ({
        id: x.id, source: 'prospect', name: x.contact, company: x.company,
        tier: x.tier ? `T${x.tier}` : '', lastTouch: x.lastTouch || x.date || '', nextDue: '',
        email: x.email, phone: x.phone, dismissed: !!x.dismissed,
      }));
      const coldRows: ContactRow[] = cold.map((x) => ({
        id: x.id, source: 'cold_broker', name: x.name, company: x.firm, tier: '',
        lastTouch: '', nextDue: '', email: x.email, phone: x.mobile || x.phone,
        dismissed: !!x.dismissed,
      }));
      const all = [...brokerRows, ...partnerRows, ...prospectRows, ...coldRows];
      setRows(all);
      setPinnedIds(new Set(pinned.map((e) => e.id)));
      setDismissedIds(new Set(all.filter((r) => r.dismissed).map((r) => r.id)));
      setLoading(false);
    })();
  }, []);

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

  async function handleDismiss(row: ContactRow) {
    setDismissedIds((prev) => new Set(prev).add(row.id));
    // If it was pinned, unpin it too so it doesn't linger in Today.
    if (pinnedIds.has(row.id)) {
      setPinnedIds((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
      await unpinToday(row.id);
    }
    await dismissContact(row.id, row.source);
  }

  async function handleRestore(row: ContactRow) {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.delete(row.id);
      return next;
    });
    await restoreContact(row.id, row.source);
  }

  const q = search.trim().toLowerCase();
  const filtered = rows
    .filter((r) => (showDismissed ? dismissedIds.has(r.id) : !dismissedIds.has(r.id)))
    .filter((r) => sourceFilter === 'all' || r.source === sourceFilter)
    .filter((r) => !q || r.name.toLowerCase().includes(q) || r.company.toLowerCase().includes(q))
    .sort((a, b) => compareRows(a, b, sortKey, sortDir));

  const pinnedCount = pinnedIds.size;
  const dismissedCount = dismissedIds.size;
  const selectStyle: React.CSSProperties = {
    background: C.surface2,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: '7px 10px',
    fontSize: 12,
    color: C.text,
    fontFamily: F.mono,
  };

  return (
    <div className="flex flex-col gap-3 fade-up">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 style={{ fontFamily: F.display, fontSize: 18, fontWeight: 700, color: C.text }}>Contacts</h2>
        <div className="flex items-center gap-3">
          {pinnedCount > 0 && onGoToToday && (
            <button onClick={onGoToToday} style={{ ...labelMono, color: C.accent, cursor: 'pointer' }}>
              {pinnedCount} pinned → Today
            </button>
          )}
          <span style={labelMono}>{filtered.length} shown</span>
        </div>
      </div>

      {/* Search */}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search name or company…"
        style={{
          background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8,
          padding: '9px 12px', fontSize: 14, color: C.text, width: '100%',
        }}
      />

      {/* Source filter */}
      <div className="flex gap-2 flex-wrap">
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => setSourceFilter(f.id)}
            style={{ ...(sourceFilter === f.id ? btnPrimary : btnGhost), padding: '6px 12px' }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Sort control */}
      <div className="flex items-center gap-2">
        <span style={labelMono}>Sort</span>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          style={selectStyle}
        >
          {sortOptions.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
          title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
          style={{ ...selectStyle, cursor: 'pointer', minWidth: 40 }}
        >
          {sortDir === 'asc' ? '↑' : '↓'}
        </button>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setShowDismissed((v) => !v)}
          style={{ ...(showDismissed ? btnPrimary : btnGhost), padding: '6px 12px' }}
        >
          {showDismissed ? '← Active' : `Not a fit${dismissedCount ? ` (${dismissedCount})` : ''}`}
        </button>
      </div>

      {loading ? (
        <div style={{ ...labelMono, padding: 24, textAlign: 'center' }}>Loading contacts…</div>
      ) : filtered.length === 0 ? (
        <div
          style={{
            background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12,
            padding: 24, textAlign: 'center', color: C.muted,
          }}
        >
          No contacts match.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((r) => {
            const isPinned = pinnedIds.has(r.id);
            const meta = [r.lastTouch && `Last ${r.lastTouch}`, r.nextDue && `Due ${r.nextDue}`]
              .filter(Boolean)
              .join(' · ');
            return (
              <div
                key={`${r.source}-${r.id}`}
                style={{
                  background: C.surface,
                  border: `1px solid ${isPinned ? 'rgba(200,240,74,0.35)' : C.border}`,
                  borderRadius: 12,
                  padding: '12px 14px',
                }}
                className="flex items-center justify-between gap-3 flex-wrap"
              >
                {/* Identity */}
                <div style={{ minWidth: 0, flex: '1 1 200px' }}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      style={{
                        fontFamily: F.display, fontWeight: 600, fontSize: 15, color: C.text,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                    >
                      {r.name}
                    </span>
                    <span style={pillStyle(sourcePill[r.source])}>{sourceLabel[r.source]}</span>
                    {r.tier && <span style={pillStyle('muted')}>{r.tier}</span>}
                  </div>
                  <div style={{ ...labelMono, marginTop: 3, textTransform: 'none', letterSpacing: 0 }}>
                    {r.company}
                    {meta ? ` · ${meta}` : ''}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {showDismissed ? (
                    <button
                      onClick={() => handleRestore(r)}
                      style={{ ...btnGhost, padding: '7px 12px', whiteSpace: 'nowrap', fontSize: 12 }}
                    >
                      ↩ Restore
                    </button>
                  ) : (
                    <>
                      {iconBtn(
                        () => r.email && openInOutlook(r.email, '', ''),
                        '✉️',
                        'Email in Outlook',
                        !r.email
                      )}
                      {iconBtn(() => r.phone && openInMessages(r.phone, ''), '💬', 'Text', !r.phone)}
                      {iconBtn(() => r.phone && startCall(r.phone), '📞', 'Call', !r.phone)}
                      <button
                        onClick={() => togglePin(r)}
                        style={{
                          ...(isPinned ? btnGhost : btnPrimary),
                          padding: '7px 12px',
                          whiteSpace: 'nowrap',
                          fontSize: 12,
                        }}
                      >
                        {isPinned ? '✓ Added' : '+ Today'}
                      </button>
                      {iconBtn(() => handleDismiss(r), '⊘', 'Not a fit — remove from lists')}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ ...labelMono, color: C.muted2 }}>
        Tap a channel to reach someone now, or + Today to compose in your voice from Do This Now.
      </div>
    </div>
  );
}
