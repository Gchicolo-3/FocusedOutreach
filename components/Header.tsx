'use client';

import { useState, useEffect } from 'react';
import CSVUploader from './CSVUploader';
import {
  getLastImport,
  getLastActivityImport,
  getProspects,
  getBrokers,
  getPartners,
} from '@/lib/storage';
import { C, F, labelMono } from '@/lib/design';

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
  return <span style={labelMono}>{time}</span>;
}

export default function Header({ onImport, refreshKey }: { onImport: () => void; refreshKey: number }) {
  const [lastImport, setLastImportState] = useState<string | null>(null);
  const [lastActivity, setLastActivityState] = useState<string | null>(null);
  const [stats, setStats] = useState({ prospects: 0, brokers: 0, partners: 0, tier1: 0 });
  const [today, setToday] = useState('');

  useEffect(() => {
    setLastImportState(getLastImport());
    setLastActivityState(getLastActivityImport());
    (async () => {
      const [prospects, brokers, partners] = await Promise.all([
        getProspects(),
        getBrokers(),
        getPartners(),
      ]);
      setStats({
        prospects: prospects.length,
        brokers: brokers.length,
        partners: partners.length,
        tier1: prospects.filter((p) => p.tier === 1).length,
      });
    })();
    setToday(
      new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
    );
  }, [refreshKey]);

  const totalItems = stats.prospects + stats.brokers + stats.partners;

  const statCardStyle: React.CSSProperties = {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    padding: 16,
  };

  const statNumStyle: React.CSSProperties = {
    fontFamily: F.display,
    fontSize: 32,
    fontWeight: 800,
    color: C.text,
    lineHeight: 1,
  };

  const statLabelStyle: React.CSSProperties = {
    ...labelMono,
    marginTop: 6,
  };

  return (
    <header
      style={{
        background: C.bg,
        borderBottom: `1px solid ${C.border}`,
        padding: '20px 20px 24px',
      }}
    >
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1
              style={{
                fontFamily: F.display,
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: '-0.02em',
                color: C.text,
              }}
            >
              Focus Studio
            </h1>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <span style={labelMono}>Prospecting OS</span>
              {today && (
                <>
                  <span style={{ ...labelMono, color: C.muted2 }}>·</span>
                  <span style={labelMono}>{today}</span>
                </>
              )}
              <LiveClock />
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {(lastImport || lastActivity) && (
              <div className="flex flex-col items-end text-right">
                {lastImport && (
                  <span style={{ ...labelMono, color: C.muted2 }}>
                    Contacts {new Date(lastImport).toLocaleDateString()}
                  </span>
                )}
                {lastActivity && (
                  <span style={{ ...labelMono, color: C.muted2 }}>
                    Activities {new Date(lastActivity).toLocaleDateString()}
                  </span>
                )}
              </div>
            )}
            <CSVUploader onImport={onImport} />
          </div>
        </div>

        {totalItems > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 12,
              marginTop: 24,
            }}
          >
            <div style={statCardStyle}>
              <div style={statNumStyle}>{stats.prospects}</div>
              <div style={statLabelStyle}>Prospects</div>
            </div>
            <div style={statCardStyle}>
              <div style={statNumStyle}>{stats.brokers}</div>
              <div style={statLabelStyle}>Brokers</div>
            </div>
            <div style={statCardStyle}>
              <div style={statNumStyle}>{stats.partners}</div>
              <div style={statLabelStyle}>Partners</div>
            </div>
            <div style={statCardStyle}>
              <div style={{ ...statNumStyle, color: C.accent }}>{stats.tier1}</div>
              <div style={statLabelStyle}>Tier 1</div>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
