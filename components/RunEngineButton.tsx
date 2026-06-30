'use client';

import { useState } from 'react';
import { C, F, labelMono, btnPrimary } from '@/lib/design';

type RunResult = {
  success?: boolean;
  signalsFound?: number;
  signalsQualified?: number;
  draftsCreated?: number;
  contactsFlagged?: number;
  errors?: string[];
  runtimeMs?: number;
};

function Spinner() {
  return (
    <span
      className="spin"
      style={{
        display: 'inline-block',
        width: 13,
        height: 13,
        borderRadius: '50%',
        border: '2px solid rgba(14,14,14,0.35)',
        borderTopColor: '#0e0e0e',
      }}
    />
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      style={{
        background: C.surface2,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: '12px 14px',
        flex: 1,
        minWidth: 96,
      }}
    >
      <div style={{ fontFamily: F.display, fontSize: 26, fontWeight: 800, color, lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ ...labelMono, marginTop: 6 }}>{label}</div>
    </div>
  );
}

export default function RunEngineButton({ onComplete }: { onComplete?: () => void }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/engine/trigger', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `Engine run failed (HTTP ${res.status})`);
      } else {
        setResult(data);
        onComplete?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error reaching the engine');
    } finally {
      setLoading(false);
    }
  }

  const hadErrors = !!result?.errors && result.errors.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleRun}
          disabled={loading}
          style={{
            ...btnPrimary,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            opacity: loading ? 0.7 : 1,
            cursor: loading ? 'default' : 'pointer',
          }}
        >
          {loading && <Spinner />}
          {loading ? 'Running engine…' : 'Run Engine Now'}
        </button>
        {result && typeof result.runtimeMs === 'number' && (
          <span style={labelMono}>Completed in {(result.runtimeMs / 1000).toFixed(1)}s</span>
        )}
      </div>

      {error && (
        <div
          className="fade-up"
          style={{
            background: C.redBg,
            border: `1px solid ${C.red}`,
            borderRadius: 10,
            padding: '10px 14px',
            color: C.red,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {result && (
        <div className="fade-up flex flex-col gap-2">
          <div className="flex gap-2 flex-wrap">
            <Stat label="Signals found" value={result.signalsFound ?? 0} color={C.accent} />
            <Stat label="Drafts created" value={result.draftsCreated ?? 0} color={C.teal} />
            <Stat label="Contacts flagged" value={result.contactsFlagged ?? 0} color={C.amber} />
          </div>
          {hadErrors && (
            <div
              style={{
                background: C.amberBg,
                border: `1px solid ${C.amber}`,
                borderRadius: 10,
                padding: '10px 14px',
                color: C.amber,
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              Completed with warnings: {result.errors!.join('; ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
