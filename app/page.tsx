'use client';

import { useState } from 'react';
import TabNav, { TabId } from '@/components/TabNav';
import Header from '@/components/Header';
import DoThisNow from '@/components/DoThisNow';
import BrokerEngine from '@/components/BrokerEngine';
import ReferralPartners from '@/components/ReferralPartners';
import TextLauncher from '@/components/TextLauncher';
import SequencesTab from '@/components/Sequences';
import NewContacts from '@/components/NewContacts';

export default function Home() {
  const [tab, setTab] = useState<TabId>('do-this-now');
  const [refreshKey, setRefreshKey] = useState(0);

  function handleImport() {
    setRefreshKey((k) => k + 1);
  }

  return (
    <div className="min-h-screen">
      <Header onImport={handleImport} refreshKey={refreshKey} />
      <TabNav active={tab} onChange={setTab} />
      <main className="max-w-6xl mx-auto px-6 py-8">
        {tab === 'do-this-now' && <DoThisNow key={refreshKey} />}
        {tab === 'broker-engine' && <BrokerEngine key={refreshKey} />}
        {tab === 'referral-partners' && <ReferralPartners key={refreshKey} />}
        {tab === 'text-launcher' && <TextLauncher key={refreshKey} />}
        {tab === 'sequences' && <SequencesTab />}
        {tab === 'new-contacts' && <NewContacts key={refreshKey} />}
      </main>
    </div>
  );
}
