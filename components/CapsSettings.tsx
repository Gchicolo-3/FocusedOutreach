'use client';

import { useEffect, useState } from 'react';
import {
  getOutreachCapsSetting,
  saveOutreachCapsSetting,
  type OutreachCaps,
} from '@/lib/storage';
import { normalizeCaps } from '@/lib/outreachCaps';
import { C, F, labelMono, btnGhost, inputBase } from '@/lib/design';

// Daily volume knobs (Amendment 1). Cold is 5-10 by George's own capacity
// call (0 pauses cold), warm caps at 12, and the two lanes share one daily
// total of 20 — the engine computes warm's real allowance as
// min(warm, total - cold used today), so editing here changes the next run
// with no deploy.
export default function CapsSettings() {
  const [caps, setCaps] = useState<OutreachCaps | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getOutreachCapsSetting().then(setCaps);
  }, []);

  if (!caps) return null;

  async function save() {
    if (!caps) return;
    setSaving(true);
    const normalized = normalizeCaps(caps);
    await saveOutreachCapsSetting(normalized);
    setCaps(normalized);
    setSaving(false);
    setEditing(false);
  }

  const numInput = (
    label: string,
    value: number,
    onChange: (n: number) => void
  ) => (
    <label style={{ ...labelMono, display: 'flex', alignItems: 'center', gap: 6 }}>
      {label}
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ...inputBase, width: 64, padding: '4px 8px' }}
      />
    </label>
  );

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        style={{ ...btnGhost, fontFamily: F.body, fontSize: 12 }}
        title="Daily outreach caps. Warm and cold share one total: if cold uses its allowance, warm yields down. Editable live, no deploy."
      >
        Daily caps: {caps.dailyTotal} total · {caps.warmDaily} warm · {caps.coldDaily} cold ✎
      </button>
    );
  }

  return (
    <div
      className="flex items-center gap-3 flex-wrap"
      style={{
        background: C.surface2,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: '8px 12px',
      }}
    >
      {numInput('Total/day', caps.dailyTotal, (n) => setCaps({ ...caps, dailyTotal: n }))}
      {numInput('Warm', caps.warmDaily, (n) => setCaps({ ...caps, warmDaily: n }))}
      {numInput('Cold (5–10)', caps.coldDaily, (n) => setCaps({ ...caps, coldDaily: n }))}
      <button onClick={save} disabled={saving} style={{ ...btnGhost, color: C.accent }}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button onClick={() => setEditing(false)} style={btnGhost}>
        Cancel
      </button>
    </div>
  );
}
