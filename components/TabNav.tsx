'use client';

import Link from 'next/link';
import { C, F } from '@/lib/design';

// Do This Now / Drafts are the daily workflow queues. Contacts holds every
// record view as an in-page filter (see RecordsView) — not separate tabs.
const tabs = [
  { id: 'do-this-now', label: 'Do This Now' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'contacts', label: 'Contacts' },
] as const;

export type TabId = (typeof tabs)[number]['id'];

export default function TabNav({
  active,
  onChange,
}: {
  active: TabId;
  onChange: (tab: TabId) => void;
}) {
  return (
    <nav
      style={{
        background: C.bg,
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      {/* Wrap to a second row on narrow screens. The old overflowX: auto strip
          silently pushed the page links (Reply Generator, etc.) past the right
          edge on phones with no scroll affordance — they looked deleted. */}
      <div
        style={{
          maxWidth: 900,
          margin: '0 auto',
          padding: '0 20px',
          display: 'flex',
          flexWrap: 'wrap',
        }}
      >
        {tabs.map((tab) => {
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              style={{
                padding: '14px 16px',
                fontSize: 13,
                fontFamily: F.body,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? C.text : C.muted,
                borderBottom: `2px solid ${isActive ? C.accent : 'transparent'}`,
                whiteSpace: 'nowrap',
                transition: 'color 0.15s, border-color 0.15s',
                marginBottom: -1,
              }}
            >
              {tab.label}
            </button>
          );
        })}
        {/* Separate pages, not tabs — same styling so they read as part of the nav. */}
        <Link
          href="/review"
          style={{
            padding: '14px 16px',
            fontSize: 13,
            fontFamily: F.body,
            fontWeight: 400,
            color: C.muted,
            borderBottom: '2px solid transparent',
            whiteSpace: 'nowrap',
            textDecoration: 'none',
            marginBottom: -1,
          }}
        >
          Draft Review ↗
        </Link>
        <Link
          href="/reply"
          style={{
            padding: '14px 16px',
            fontSize: 13,
            fontFamily: F.body,
            fontWeight: 400,
            color: C.muted,
            borderBottom: '2px solid transparent',
            whiteSpace: 'nowrap',
            textDecoration: 'none',
            marginBottom: -1,
          }}
        >
          Reply Generator ↗
        </Link>
        <Link
          href="/triage"
          style={{
            padding: '14px 16px',
            fontSize: 13,
            fontFamily: F.body,
            fontWeight: 400,
            color: C.muted,
            borderBottom: '2px solid transparent',
            whiteSpace: 'nowrap',
            textDecoration: 'none',
            marginBottom: -1,
          }}
        >
          Tier Triage ↗
        </Link>
      </div>
    </nav>
  );
}
