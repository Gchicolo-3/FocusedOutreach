'use client';

import { useState, useEffect } from 'react';
import TabNav, { TabId } from '@/components/TabNav';
import Header from '@/components/Header';
import DoThisNow from '@/components/DoThisNow';
import BrokerEngine from '@/components/BrokerEngine';
import ReferralPartners from '@/components/ReferralPartners';
import TextLauncher from '@/components/TextLauncher';
import SequencesTab from '@/components/Sequences';
import NewContacts from '@/components/NewContacts';
import { C } from '@/lib/design';
import type { DoThisNowFilter } from '@/components/DoThisNow';

export default function Home() {
  const [tab, setTab] = useState<TabId>('do-this-now');
  const [dtnFilter, setDtnFilter] = useState<DoThisNowFilter>('all');
  const [refreshKey, setRefreshKey] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  function handleImport() {
    setRefreshKey((k) => k + 1);
  }

  // Banner stats and other shortcuts navigate here. An optional Do This Now
  // filter rides along so e.g. "Prospects" lands pre-filtered.
  function navigate(target: TabId, filter?: DoThisNowFilter) {
    if (filter) setDtnFilter(filter);
    setTab(target);
  }

  if (!mounted) return null;

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: '100vh' }}>
      <Header onImport={handleImport} refreshKey={refreshKey} onNavigate={navigate} />
      <TabNav active={tab} onChange={setTab} />
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '24px 20px 48px' }}>
        {tab === 'do-this-now' && <DoThisNow key={refreshKey} filter={dtnFilter} onFilterChange={setDtnFilter} />}
        {tab === 'broker-engine' && <BrokerEngine key={refreshKey} />}
        {tab === 'referral-partners' && <ReferralPartners key={refreshKey} />}
        {tab === 'text-launcher' && <TextLauncher key={refreshKey} />}
        {tab === 'sequences' && <SequencesTab />}
        {tab === 'new-contacts' && <NewContacts key={refreshKey} />}
      </main>
    </div>
  );
}
