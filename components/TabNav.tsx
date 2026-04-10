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
    <nav className="flex border-b border-[#e8e8e0] bg-white overflow-x-auto">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
            active === tab.id
              ? 'border-b-2 border-[#1a1a1a] text-[#1a1a1a]'
              : 'text-gray-500 hover:text-[#1a1a1a]'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
