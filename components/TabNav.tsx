'use client';

const tabs = [
  { id: 'do-this-now', label: 'Do This Now' },
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
    <nav className="flex border-b border-[var(--border)] overflow-x-auto px-6" style={{ background: 'var(--bg)' }}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className="px-4 py-3 text-sm whitespace-nowrap transition-colors relative"
          style={{
            color: active === tab.id ? 'var(--text)' : 'var(--muted)',
            fontWeight: active === tab.id ? 600 : 400,
          }}
        >
          {tab.label}
          {active === tab.id && (
            <span
              className="absolute left-4 right-4 -bottom-px h-px"
              style={{ background: 'var(--accent)' }}
            />
          )}
        </button>
      ))}
    </nav>
  );
}
