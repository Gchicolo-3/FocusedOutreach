'use client';

import Link from 'next/link';
import { C, F } from '@/lib/design';

const tabs = [
  { id: 'do-this-now', label: 'Do This Now' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'broker-engine', label: 'Broker Engine' },
  { id: 'referral-partners', label: 'Referral Partners' },
  { id: 'text-launcher', label: 'Text Launcher' },
  { id: 'sequences', label: 'Sequences' },
  { id: 'new-contacts', label: 'New Contacts' },
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
        overflowX: 'auto',
        whiteSpace: 'nowrap',
      }}
    >
      <div
        style={{
          maxWidth: 900,
          margin: '0 auto',
          padding: '0 20px',
          display: 'flex',
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
        {/* Separate page, not a tab — same styling so it reads as part of the nav. */}
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
      </div>
    </nav>
  );
}
