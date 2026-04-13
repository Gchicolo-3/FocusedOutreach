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
  return <span className="label-mono">{time}</span>;
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
  });

  return (
    <header className="border-b border-[var(--border)] px-6 py-5" style={{ background: 'var(--bg)' }}>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-[var(--text)]">
              Focus Studio
            </h1>
            <div className="flex items-center gap-4 mt-1 flex-wrap">
              <span className="label-mono">Prospecting OS</span>
              <span className="label-mono" style={{ color: 'var(--muted2)' }}>·</span>
              <span className="label-mono">{today}</span>
              <LiveClock />
            </div>
          </div>
          <div className="flex items-center gap-3">
            {mounted && lastImport && (
              <span className="label-mono" style={{ color: 'var(--muted2)' }}>
                Last import {new Date(lastImport).toLocaleDateString()}
              </span>
            )}
            <CSVUploader onImport={onImport} />
          </div>
        </div>

        {mounted && (stats.prospects + stats.brokers + stats.partners > 0) && (
          <div className="grid grid-cols-3 gap-3 mt-6 max-w-md">
            <div className="stat-card">
              <div className="stat-num">{stats.prospects}</div>
              <div className="stat-label">Prospects</div>
            </div>
            <div className="stat-card">
              <div className="stat-num">{stats.brokers}</div>
              <div className="stat-label">Brokers</div>
            </div>
            <div className="stat-card">
              <div className="stat-num">{stats.partners}</div>
              <div className="stat-label">Partners</div>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
