'use client';

import { useState, useEffect } from 'react';
import TabNav, { TabId } from '@/components/TabNav';
import Header from '@/components/Header';
import DoThisNow from '@/components/DoThisNow';
import Drafts from '@/components/Drafts';
import RecordsView, { RecordTab } from '@/components/RecordsView';
import ImportReview from '@/components/ImportReview';
import ExportCSV from '@/components/ExportCSV';
import RunEngineButton from '@/components/RunEngineButton';
import RunClassifierButton from '@/components/RunClassifierButton';
import { C, F } from '@/lib/design';

// Every record view lives under the Contacts tab as a sub-tab pill —
// including Monthly Outreach (parked cold contacts) and Import Review
// (unresolved contacts from imports), which render their own components.
type ContactsSubTab = RecordTab | 'import-review';

const recordSubTabs: { id: ContactsSubTab; label: string }[] = [
  { id: 'brokers', label: 'Brokers' },
  { id: 'cold-brokers', label: 'Cold Brokers' },
  { id: 'projects', label: 'Potential Projects' },
  { id: 'partners', label: 'Referral Partners' },
  { id: 'not-worth-pursuing', label: 'Not Worth Pursuing' },
  { id: 'blast-only', label: 'Blast Only' },
  { id: 'monthly-outreach', label: 'Monthly Outreach' },
  { id: 'import-review', label: 'Import Review' },
];

export default function Home() {
  const [tab, setTab] = useState<TabId>('do-this-now');
  const [recordSubTab, setRecordSubTab] = useState<ContactsSubTab>('brokers');
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
          <ExportCSV />
        </div>
        {tab === 'do-this-now' && <DoThisNow key={refreshKey} />}
        {tab === 'drafts' && <Drafts key={refreshKey} />}
        {tab === 'contacts' && (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              {recordSubTabs.map((rt) => {
                const isActive = recordSubTab === rt.id;
                return (
                  <button
                    key={rt.id}
                    onClick={() => setRecordSubTab(rt.id)}
                    style={{
                      padding: '6px 12px',
                      fontSize: 12,
                      fontFamily: F.body,
                      fontWeight: isActive ? 600 : 400,
                      color: isActive ? C.text : C.muted,
                      background: isActive ? C.border : 'transparent',
                      border: `1px solid ${C.border}`,
                      borderRadius: 6,
                      cursor: 'pointer',
                    }}
                  >
                    {rt.label}
                  </button>
                );
              })}
            </div>
            {recordSubTab === 'import-review' ? (
              <ImportReview key={refreshKey} />
            ) : (
              <RecordsView key={`${refreshKey}-${recordSubTab}`} view={recordSubTab} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
