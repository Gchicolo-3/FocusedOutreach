'use client';

// Import Review: the queue of activity rows the matcher refused to guess at.
// Two kinds land here:
//   ambiguous  — the name matched more than one contact; pick the right one
//   needs_type — a clean new person with no Contact Type; pick their table
// Every action here writes the same linkage/enrichment the automatic path
// would have written, just with a human making the call.

import { useEffect, useState } from 'react';
import {
  getReviewRecords,
  resolveReviewLink,
  resolveReviewCreate,
  resolveReviewJunk,
  type ReviewRecord,
} from '@/lib/importApply';
import type { ContactTable } from '@/lib/identity';
import { C, F, card, labelMono, pillStyle, btnSecondary, btnGhost } from '@/lib/design';

const TABLE_LABEL: Record<string, string> = {
  brokers: 'Broker',
  partners: 'Partner',
  prospects: 'Prospect',
  cold_brokers: 'Cold Broker',
};

export default function ImportReview() {
  const [records, setRecords] = useState<ReviewRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setRecords(await getReviewRecords());
      setLoading(false);
    })();
  }, []);

  async function act(rec: ReviewRecord, fn: () => Promise<string | null>) {
    setBusyKey(rec.contactKey);
    const err = await fn();
    setBusyKey(null);
    if (err) {
      alert(err);
      return;
    }
    setRecords((rs) => rs.filter((r) => r.contactKey !== rec.contactKey));
  }

  if (loading) {
    return <div style={{ color: C.muted, fontFamily: F.body, fontSize: 14 }}>Loading review queue…</div>;
  }

  if (records.length === 0) {
    return (
      <div style={{ ...card, padding: 24, textAlign: 'center' }}>
        <div style={{ fontFamily: F.body, fontSize: 14, color: C.muted }}>
          Nothing to review. Ambiguous or untyped contacts from imports will appear here.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div style={{ ...labelMono }}>
        {records.length} unresolved {records.length === 1 ? 'contact' : 'contacts'}
      </div>
      {records.map((rec) => {
        const busy = busyKey === rec.contactKey;
        return (
          <div key={rec.contactKey} style={{ ...card, padding: 16, opacity: busy ? 0.6 : 1 }}>
            <div className="flex items-center gap-2 flex-wrap">
              <span style={{ fontFamily: F.body, fontWeight: 600, fontSize: 15, color: C.text }}>
                {rec.name}
              </span>
              {rec.company && (
                <span style={{ fontFamily: F.body, fontSize: 13, color: C.muted }}>
                  · {rec.company}
                </span>
              )}
              <span style={pillStyle(rec.reason === 'ambiguous' ? 'amber' : 'blue')}>
                {rec.reason === 'ambiguous' ? 'Ambiguous match' : 'Needs type'}
              </span>
            </div>

            <div className="flex gap-3 flex-wrap" style={{ marginTop: 6 }}>
              {rec.email && <span style={{ ...labelMono, textTransform: 'none' }}>{rec.email}</span>}
              {rec.mobile && <span style={{ ...labelMono, textTransform: 'none' }}>{rec.mobile}</span>}
              {rec.date && <span style={{ ...labelMono, textTransform: 'none' }}>Last activity {rec.date}</span>}
            </div>

            {rec.comments && (
              <div
                style={{
                  marginTop: 8, fontFamily: F.body, fontSize: 12, color: C.muted,
                  maxHeight: 54, overflow: 'hidden',
                }}
              >
                {rec.comments}
              </div>
            )}

            {rec.reason === 'ambiguous' && rec.candidates.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={labelMono}>Link to</div>
                <div className="flex gap-2 flex-wrap" style={{ marginTop: 6 }}>
                  {rec.candidates.map((c) => (
                    <button
                      key={`${c.table}:${c.id}`}
                      type="button"
                      disabled={busy}
                      style={btnSecondary}
                      onClick={() => act(rec, () => resolveReviewLink(rec, c))}
                      title={c.id}
                    >
                      {c.name || c.id}
                      <span style={{ color: C.muted, marginLeft: 6 }}>
                        {TABLE_LABEL[c.table]}{c.company ? ` · ${c.company}` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <div style={labelMono}>
                {rec.reason === 'ambiguous' ? 'Or create new' : 'Create as'}
              </div>
              <div className="flex gap-2 flex-wrap" style={{ marginTop: 6 }}>
                {(['brokers', 'partners', 'prospects'] as ContactTable[]).map((table) => (
                  <button
                    key={table}
                    type="button"
                    disabled={busy}
                    style={btnSecondary}
                    onClick={() => act(rec, () => resolveReviewCreate(rec, table))}
                  >
                    {TABLE_LABEL[table]}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={busy}
                  style={btnGhost}
                  onClick={() => act(rec, () => resolveReviewJunk(rec))}
                >
                  Not a contact
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
