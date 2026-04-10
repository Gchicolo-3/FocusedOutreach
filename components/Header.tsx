'use client';

import { useState, useEffect } from 'react';
import CSVUploader from './CSVUploader';
import {
  getLastImport,
  getProspects,
  getBrokers,
  getPartners,
} from '@/lib/storage';

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
  if (!time) return null;
  return <span className="text-sm text-gray-500">{time}</span>;
}

export default function Header({ onImport, refreshKey }: { onImport: () => void; refreshKey: number }) {
  const [mounted, setMounted] = useState(false);
  const [lastImport, setLastImportState] = useState<string | null>(null);
  const [stats, setStats] = useState({ prospects: 0, brokers: 0, partners: 0 });

  useEffect(() => {
    setMounted(true);
    setLastImportState(getLastImport());
    setStats({
      prospects: getProspects().length,
      brokers: getBrokers().length,
      partners: getPartners().length,
    });
  }, [refreshKey]);

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <header className="bg-white border-b border-[#e8e8e0] px-4 py-3">
      <div className="max-w-5xl mx-auto flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-[#1a1a1a]">
            Focus Studio — Prospecting OS
          </h1>
          <div className="flex items-center gap-3 text-sm text-gray-500 flex-wrap">
            <span>{today}</span>
            <LiveClock />
            {mounted && (
              <span className="text-xs text-gray-400">
                {stats.prospects} prospects · {stats.brokers} brokers · {stats.partners} partners
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {mounted && lastImport && (
            <span className="text-xs text-gray-400">
              Last import: {new Date(lastImport).toLocaleDateString()}
            </span>
          )}
          <CSVUploader onImport={onImport} />
        </div>
      </div>
    </header>
  );
}
