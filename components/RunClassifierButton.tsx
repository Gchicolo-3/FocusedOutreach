'use client';

import { useState } from 'react';
import { C, labelMono, btnPrimary } from '@/lib/design';

// Shape returned by /api/engine/classify (via the classify-trigger proxy).
type TableResult = {
  classified?: number;
  disqualified?: number;
  needsReview?: number;
  errors?: string[];
};
type ClassifyResult = {
  success?: boolean;
  limit?: number;
  results?: Record<string, TableResult>;
  error?: string;
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

function sum(results: Record<string, TableResult> | undefined, key: keyof TableResult): number {
  if (!results) return 0;
  return Object.values(results).reduce((n, r) => n + (Number(r[key]) || 0), 0);
}

export default function RunClassifierButton({ onComplete }: { onComplete?: () => void }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ClassifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/engine/classify-trigger', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `Classification failed (HTTP ${res.status})`);
      } else {
        setResult(data);
        onComplete?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error reaching the classifier');
    } finally {
      setLoading(false);
    }
  }

  const classified = sum(result?.results, 'classified');
  const disqualified = sum(result?.results, 'disqualified');
  const needsReview = sum(result?.results, 'needsReview');
  const errorCount = result?.results
    ? Object.values(result.results).reduce((n, r) => n + (r.errors?.length || 0), 0)
    : 0;

  return (
    <div className="flex flex-col gap-2">
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
          {loading ? 'Classifying…' : 'Run Classifier'}
        </button>
        {result && (
          <span style={labelMono}>
            {classified > 0
              ? `Classified ${classified} contact${classified === 1 ? '' : 's'}` +
                (disqualified || needsReview
                  ? ` · ${disqualified} not a fit · ${needsReview} to review`
                  : '')
              : 'All contacts already classified'}
          </span>
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

      {result && errorCount > 0 && (
        <div
          className="fade-up"
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
          Completed with {errorCount} error{errorCount === 1 ? '' : 's'}; some contacts were skipped.
        </div>
      )}
    </div>
  );
}
