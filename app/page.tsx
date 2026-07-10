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
import RunEngineButton from '@/components/RunEngineButton';
import RunClassifierButton from '@/components/RunClassifierButton';
import { C } from '@/lib/design';

export default function Home() {
  const [tab, setTab] = useState<TabId>('do-this-now');
  const [refreshKey, setRefreshKey] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  function handleImport() {
    setRefreshKey((k) => k + 1);
  }

  if (!mounted) return null;

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: '100vh' }}>
      <Header onImport={handleImport} refreshKey={refreshKey} />
      <TabNav active={tab} onChange={setTab} />
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '24px 20px 48px' }}>
        <div
          style={{ marginBottom: 24 }}
          className="flex gap-6 flex-wrap items-start"
        >
          <RunEngineButton onComplete={handleImport} />
          <RunClassifierButton onComplete={handleImport} />
        </div>
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
