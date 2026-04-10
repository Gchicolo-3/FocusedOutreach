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
    <div className="min-h-screen flex flex-col w-full">
      <Header onImport={handleImport} refreshKey={refreshKey} />

      <div className="max-w-5xl mx-auto w-full">
        <TabNav active={tab} onChange={setTab} />
      </div>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6">
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
