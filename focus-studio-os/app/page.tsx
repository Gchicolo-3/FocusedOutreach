'use client';

import { useState, useEffect } from 'react';
import TabNav, { TabId } from '@/components/TabNav';
import DoThisNow from '@/components/DoThisNow';
import BrokerEngine from '@/components/BrokerEngine';
import TextLauncher from '@/components/TextLauncher';
import SequencesTab from '@/components/Sequences';
import Contacts from '@/components/Contacts';
import CSVUploader from '@/components/CSVUploader';
import { getLastImport } from '@/lib/storage';

function LiveClock() {
  const [time, setTime] = useState('');

  useEffect(() => {
    function update() {
      setTime(
        new Date().toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
        })
      );
    }
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, []);

  return <span className="text-sm text-gray-500">{time}</span>;
}

export default function Home() {
  const [tab, setTab] = useState<TabId>('do-this-now');
  const [lastImport, setLastImportState] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setLastImportState(getLastImport());
  }, []);

  function handleImport() {
    setLastImportState(getLastImport());
    setRefreshKey((k) => k + 1);
  }

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-[#e8e8e0] px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-[#1a1a1a]">
              Focus Studio — Prospecting OS
            </h1>
            <div className="flex items-center gap-3 text-sm text-gray-500">
              <span>{today}</span>
              <LiveClock />
            </div>
          </div>
          <div className="flex items-center gap-3">
            {lastImport && (
              <span className="text-xs text-gray-400">
                Last import: {new Date(lastImport).toLocaleDateString()}
              </span>
            )}
            <CSVUploader onImport={handleImport} />
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="max-w-5xl mx-auto w-full">
        <TabNav active={tab} onChange={setTab} />
      </div>

      {/* Content */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6">
        {tab === 'do-this-now' && <DoThisNow key={refreshKey} />}
        {tab === 'broker-engine' && <BrokerEngine key={refreshKey} />}
        {tab === 'text-launcher' && <TextLauncher key={refreshKey} />}
        {tab === 'sequences' && <SequencesTab />}
        {tab === 'contacts' && <Contacts key={refreshKey} />}
      </main>
    </div>
  );
}
