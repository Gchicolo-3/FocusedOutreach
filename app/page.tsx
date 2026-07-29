'use client';

import { useState, useEffect } from 'react';
import TabNav, { TabId } from '@/components/TabNav';
import Header from '@/components/Header';
import DoThisNow from '@/components/DoThisNow';
import Drafts from '@/components/Drafts';
import RecordsView, { RecordTab } from '@/components/RecordsView';
import ExportCSV from '@/components/ExportCSV';
import RunEngineButton from '@/components/RunEngineButton';
import RunClassifierButton from '@/components/RunClassifierButton';
import { C } from '@/lib/design';

const recordTabs: ReadonlyArray<TabId> = [
  'brokers',
  'cold-brokers',
  'projects',
  'partners',
  'not-worth-pursuing',
  'blast-only',
];

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

  const isRecordTab = recordTabs.includes(tab);

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
          <ExportCSV />
        </div>
        {tab === 'do-this-now' && <DoThisNow key={refreshKey} />}
        {tab === 'drafts' && <Drafts key={refreshKey} />}
        {/* One RecordsView instance for all record tabs: switching tabs just
            changes the filter over the already-loaded dataset — no reload,
            no navigation. */}
        {isRecordTab && <RecordsView key={refreshKey} view={tab as RecordTab} />}
      </main>
    </div>
  );
}
