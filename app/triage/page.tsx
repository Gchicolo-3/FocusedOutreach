'use client';

// Tier triage (Item 3b). 463 of 477 brokers sat at tier B, so tier carried no
// signal and the digest's A/B/C weighting was a no-op. deal_count can't
// derive tier either (469 brokers have zero deals), so tier is set by hand:
// qualified brokers one at a time, A/B/C on a keystroke, persisted straight
// to brokers.tier (TEXT 'A'|'B'|'C' — never the prospects-style integer).

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { C, F, labelMono, card, btnGhost, pillStyle } from '@/lib/design';

type TriageBroker = {
  id: string;
  first_name: string;
  last_name: string;
  firm: string | null;
  title: string | null;
  email: string | null;
  notes: string | null;
  tier: string | null;
};

const INDEX_KEY = 'tier-triage-index';

const TIER_HELP: Record<string, string> = {
  A: 'A — top relationship, 14 day cadence',
  B: 'B — solid, 28 day cadence',
  C: 'C — keep loosely warm, 45 day cadence',
};

export default function TriagePage() {
  const [brokers, setBrokers] = useState<TriageBroker[]>([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [setCount, setSetCount] = useState({ A: 0, B: 0, C: 0 });
  // Ref mirrors so the keydown listener always sees current state.
  const idxRef = useRef(0);
  const brokersRef = useRef<TriageBroker[]>([]);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('brokers')
        .select('id, first_name, last_name, firm, title, email, notes, tier, dismissed')
        .eq('qualified', true)
        .order('firm', { ascending: true });
      if (error) {
        console.error('triage load:', error);
        setLoading(false);
        return;
      }
      const rows = ((data as (TriageBroker & { dismissed: boolean | null })[]) || []).filter(
        (r) => r.dismissed !== true
      );
      setBrokers(rows);
      brokersRef.current = rows;
      const saved = Number(localStorage.getItem(INDEX_KEY));
      const start = Number.isFinite(saved) ? Math.min(Math.max(0, saved), Math.max(0, rows.length - 1)) : 0;
      setIdx(start);
      idxRef.current = start;
      setLoading(false);
    })();
  }, []);

  const move = useCallback((delta: number) => {
    const rows = brokersRef.current;
    const next = Math.min(Math.max(0, idxRef.current + delta), Math.max(0, rows.length - 1));
    idxRef.current = next;
    setIdx(next);
    localStorage.setItem(INDEX_KEY, String(next));
  }, []);

  const setTier = useCallback(
    async (tier: 'A' | 'B' | 'C') => {
      const b = brokersRef.current[idxRef.current];
      if (!b) return;
      setSaving(true);
      const { error } = await supabase.from('brokers').update({ tier }).eq('id', b.id);
      if (error) console.error('triage setTier:', error);
      else {
        b.tier = tier;
        setBrokers([...brokersRef.current]);
        setSetCount((c) => ({ ...c, [tier]: c[tier as keyof typeof c] + 1 }));
      }
      setSaving(false);
      move(1);
    },
    [move]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'a' || k === 'b' || k === 'c') {
        e.preventDefault();
        void setTier(k.toUpperCase() as 'A' | 'B' | 'C');
      } else if (k === 's' || k === 'arrowright') {
        e.preventDefault();
        move(1);
      } else if (k === 'arrowleft') {
        e.preventDefault();
        move(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move, setTier]);

  const b = brokers[idx];

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: '100vh' }}>
      <header style={{ borderBottom: `1px solid ${C.border}` }}>
        <div
          style={{ maxWidth: 720, margin: '0 auto', padding: '18px 20px' }}
          className="flex items-baseline justify-between flex-wrap gap-2"
        >
          <div className="flex items-baseline gap-3">
            <h1 style={{ fontFamily: F.display, fontSize: 20, fontWeight: 700 }}>Tier Triage</h1>
            <span style={labelMono}>A / B / C on the keyboard · S skips</span>
          </div>
          <Link href="/" style={{ ...labelMono, color: C.muted, textDecoration: 'none' }}>
            ← Back to app
          </Link>
        </div>
      </header>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '24px 20px 48px' }} className="flex flex-col gap-4">
        {loading ? (
          <div style={{ ...labelMono, textAlign: 'center', padding: 40 }}>Loading qualified brokers…</div>
        ) : brokers.length === 0 ? (
          <div style={{ ...card, padding: 24, textAlign: 'center', color: C.muted }}>
            No qualified brokers to triage.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span style={labelMono}>
                {idx + 1} / {brokers.length} qualified brokers
              </span>
              <span style={labelMono}>
                This session: {setCount.A} A · {setCount.B} B · {setCount.C} C
              </span>
            </div>

            {b && (
              <div style={{ ...card, padding: 24 }} className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span style={{ fontFamily: F.display, fontSize: 22, fontWeight: 700 }}>
                    {b.first_name} {b.last_name}
                  </span>
                  <span style={pillStyle(b.tier === 'A' ? 'teal' : b.tier === 'C' ? 'muted' : 'amber')}>
                    current: {b.tier || '—'}
                  </span>
                </div>
                <div style={{ color: C.muted, fontSize: 14, fontFamily: F.body }}>
                  {[b.title, b.firm].filter(Boolean).join(' · ') || 'No title / firm on file'}
                </div>
                {b.email && <div style={labelMono}>{b.email}</div>}
                <div
                  style={{
                    whiteSpace: 'pre-wrap',
                    fontSize: 13,
                    lineHeight: 1.6,
                    fontFamily: F.body,
                    color: b.notes ? C.text : C.muted2,
                    background: C.surface2,
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    padding: 14,
                    minHeight: 70,
                  }}
                >
                  {b.notes || 'No notes.'}
                </div>

                <div className="flex gap-2 flex-wrap" style={{ marginTop: 6 }}>
                  {(['A', 'B', 'C'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTier(t)}
                      disabled={saving}
                      title={TIER_HELP[t]}
                      style={{
                        ...btnGhost,
                        fontSize: 16,
                        fontWeight: 700,
                        padding: '10px 26px',
                        color: b.tier === t ? C.accent : C.text,
                        borderColor: b.tier === t ? C.accent : C.border,
                      }}
                    >
                      {t}
                    </button>
                  ))}
                  <button onClick={() => move(1)} style={{ ...btnGhost, marginLeft: 'auto' }}>
                    Skip →
                  </button>
                  <button onClick={() => move(-1)} style={btnGhost}>
                    ← Back
                  </button>
                </div>
                <span style={{ ...labelMono, color: C.muted2 }}>
                  A = 14 day cadence · B = 28 · C = 45. Tier drives the digest ranking and next_due.
                </span>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
