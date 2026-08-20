'use client';

// Date-range CSV export of activities + touch_log, for manual reconciliation
// against Salesforce. Downloads two files, one per table.

import { useState } from 'react';
import { exportActivitiesAndTouchLog } from '@/lib/records';
import { C, F, labelMono, btnPrimary, btnSecondary, inputBase } from '@/lib/design';

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

export default function ExportCSV() {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(() => isoDaysAgo(30));
  const [end, setEnd] = useState(() => isoDaysAgo(0));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function runExport() {
    if (!start || !end || start > end) {
      setResult('Pick a valid date range.');
      return;
    }
    setBusy(true);
    setResult(null);
    const res = await exportActivitiesAndTouchLog(start, end);
    setBusy(false);
    if ('error' in res) {
      setResult(`Export failed — ${res.error}`);
    } else {
      setResult(`Downloaded ${res.activities} activities + ${res.touches} touches.`);
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen((v) => !v)} style={btnSecondary}>
        ⬇ Export CSV
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            zIndex: 20,
            background: C.surface,
            border: `1px solid ${C.border2}`,
            borderRadius: 12,
            padding: 16,
            width: 280,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          }}
        >
          <div style={{ ...labelMono, marginBottom: 10 }}>
            Activities + touch log → CSV
          </div>
          <div style={{ marginBottom: 10 }}>
            <span style={{ ...labelMono, display: 'block', marginBottom: 4 }}>From</span>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} style={inputBase} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <span style={{ ...labelMono, display: 'block', marginBottom: 4 }}>To</span>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} style={inputBase} />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={runExport} disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Exporting…' : 'Download'}
            </button>
            <button onClick={() => setOpen(false)} style={btnSecondary}>
              Close
            </button>
          </div>
          {result && (
            <div style={{ marginTop: 10, fontSize: 12, fontFamily: F.body, color: result.startsWith('Downloaded') ? C.accent : C.red }}>
              {result}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
