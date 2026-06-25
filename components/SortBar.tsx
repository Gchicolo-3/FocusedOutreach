'use client';

import { SortKey } from '@/types';
import { C, F, labelMono } from '@/lib/design';

export const SORT_LABELS: Record<SortKey, string> = {
  priority: 'Priority',
  last_contact: 'Last Contact Date',
  overdue: 'Overdue Days',
  contact_type: 'Contact Type',
  company: 'Company A-Z',
};

const ALL_KEYS: SortKey[] = ['priority', 'last_contact', 'overdue', 'contact_type', 'company'];

// Compact sort dropdown. Tabs with a single contact type can drop the
// "contact_type" option via `options`.
export default function SortBar({
  value,
  onChange,
  options = ALL_KEYS,
}: {
  value: SortKey;
  onChange: (key: SortKey) => void;
  options?: SortKey[];
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={labelMono}>Sort</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortKey)}
        style={{
          background: C.surface2,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          color: C.text,
          fontFamily: F.body,
          fontSize: 13,
          padding: '6px 10px',
          outline: 'none',
          cursor: 'pointer',
        }}
      >
        {options.map((k) => (
          <option key={k} value={k}>
            {SORT_LABELS[k]}
          </option>
        ))}
      </select>
    </div>
  );
}

// Shared comparators so every tab sorts the same way.
type Sortable = {
  score?: number;
  lastTouch?: string;
  daysSinceTouch?: number;
  source?: string;
  company?: string;
};

export function compareBy<T extends Sortable>(key: SortKey) {
  return (a: T, b: T): number => {
    switch (key) {
      case 'last_contact': {
        // Most recently contacted first; never-contacted sinks to the bottom.
        const av = a.lastTouch || '';
        const bv = b.lastTouch || '';
        if (!av && !bv) return 0;
        if (!av) return 1;
        if (!bv) return -1;
        return bv.localeCompare(av);
      }
      case 'overdue':
        return (b.daysSinceTouch ?? -1) - (a.daysSinceTouch ?? -1);
      case 'contact_type':
        return (a.source || '').localeCompare(b.source || '');
      case 'company':
        return (a.company || '').localeCompare(b.company || '');
      case 'priority':
      default:
        return (b.score ?? 0) - (a.score ?? 0);
    }
  };
}
