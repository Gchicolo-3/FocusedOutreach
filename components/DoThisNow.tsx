'use client';

import { useState, useEffect, useCallback } from 'react';
import { DailyTask, TaskSource, SortKey, Channel, ContactSearchResult } from '@/types';
import {
  getProspects,
  getBrokers,
  getPartners,
  getColdBrokers,
  getDone,
  getSnoozed,
  getTouchLog,
  getPinsToday,
  addPin,
  removePin,
  markDone,
  snoozeLead,
  quickLog,
  searchContacts,
  initDefaultBrokers,
  initDefaultColdBrokers,
  supabaseConfigured,
} from '@/lib/storage';
import { selectDaily5, taskForId, reasonFor, Pools } from '@/lib/prioritize';
import { touchColor } from '@/lib/cadence';
import { C, F, labelMono, btnPrimary, btnSecondary, btnGhost, pillStyle, inputBase } from '@/lib/design';
import MessageCard from '@/components/MessageCard';
import ContactLinks from '@/components/ContactLinks';
import SortBar, { compareBy } from '@/components/SortBar';

export type DoThisNowFilter = 'all' | 'broker' | 'prospect' | 'partner';

type MsgChannel = 'text' | 'email' | 'linkedin' | 'call';

const channelPill: Record<string, 'accent' | 'blue' | 'amber' | 'purple'> = {
  call: 'accent',
  text: 'blue',
  email: 'amber',
  linkedin: 'purple',
};

const sourcePill: Record<string, 'purple' | 'teal' | 'accent' | 'blue'> = {
  broker: 'purple',
  partner: 'teal',
  prospect: 'accent',
  cold_broker: 'blue',
};

const sourceDisplayLabel: Record<string, string> = {
  broker: 'Broker',
  partner: 'Partner',
  prospect: 'Prospect',
  cold_broker: 'New Broker',
};

const FILTERS: { key: DoThisNowFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'broker', label: 'Broker' },
  { key: 'prospect', label: 'Prospect' },
  { key: 'partner', label: 'Partner' },
];

function matchesFilter(task: DailyTask, filter: DoThisNowFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'broker') return task.source === 'broker' || task.source === 'cold_broker';
  if (filter === 'prospect') return task.source === 'prospect';
  if (filter === 'partner') return task.source === 'partner';
  return true;
}

function motivational(done: number, total: number): string {
  if (total === 0) return 'Nothing queued';
  if (done === 0) return "Let's go";
  if (done === total) return 'All done — nice work';
  if (done >= total - 1) return 'Almost there';
  if (done >= Math.ceil(total / 2)) return 'Halfway there';
  return 'Keep going';
}

// Color-coded "days since last touch" chip.
function DaysSincePill({ days }: { days: number | undefined }) {
  if (days === undefined || days >= 9999) {
    return <span style={pillStyle('muted')}>No touch logged</span>;
  }
  const band = touchColor(days);
  const variant = band === 'green' ? 'accent' : band === 'yellow' ? 'amber' : 'red';
  return <span style={pillStyle(variant)}>{days}d since touch</span>;
}

export default function DoThisNow({
  filter,
  onFilterChange,
}: {
  filter: DoThisNowFilter;
  onFilterChange: (f: DoThisNowFilter) => void;
}) {
  const [tasks, setTasks] = useState<DailyTask[]>([]);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortKey>('priority');

  // Quick Log inline form state (one open at a time)
  const [qlFor, setQlFor] = useState<string | null>(null);
  const [qlChannel, setQlChannel] = useState<Channel>('text');
  const [qlSpoke, setQlSpoke] = useState(true);
  const [qlNotes, setQlNotes] = useState('');
  const [qlSaving, setQlSaving] = useState(false);

  // Manual add
  const [addQuery, setAddQuery] = useState('');
  const [addResults, setAddResults] = useState<ContactSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const loadTasks = useCallback(async () => {
    const today = new Date().toISOString().split('T')[0];
    const [doneAll, snoozedAll, prospects, brokers, partners, coldBrokers, pinsToday, touchLog] =
      await Promise.all([
        getDone(),
        getSnoozed(),
        getProspects(),
        getBrokers(),
        getPartners(),
        getColdBrokers(),
        getPinsToday(),
        getTouchLog(),
      ]);

    const done = doneAll.filter((d) => d.date === today).map((d) => d.id);
    const snoozed = snoozedAll.filter((s) => s.until > today).map((s) => s.id);
    setDoneIds(new Set(done));
    setPinnedIds(new Set(pinsToday.map((p) => p.id)));

    const pools: Pools = { prospects, brokers, partners, coldBrokers };

    // Consecutive-NA count per contact, from the touch log.
    const naByContact = new Map<string, number>();
    const byContact = new Map<string, { date: string; spoke?: boolean }[]>();
    for (const t of touchLog) {
      if (!byContact.has(t.id)) byContact.set(t.id, []);
      byContact.get(t.id)!.push({ date: t.date, spoke: t.spoke });
    }
    for (const [id, entries] of byContact) {
      entries.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      let count = 0;
      for (const e of entries) {
        if (e.spoke === false) count++;
        else if (e.spoke === true) break;
      }
      naByContact.set(id, count);
    }

    // Pinned contacts always lead the list.
    const pinnedTasks: DailyTask[] = [];
    const seen = new Set<string>();
    for (const p of pinsToday) {
      const t = taskForId(p.id, p.source, pools);
      if (t && !seen.has(t.id)) {
        seen.add(t.id);
        pinnedTasks.push({ ...t, pinned: true });
      }
    }

    // Auto-selected daily set, minus anything already pinned.
    const daily = selectDaily5(prospects, brokers, partners, coldBrokers, new Set(done), new Set(snoozed))
      .filter((t) => !seen.has(t.id));

    const combined = [...pinnedTasks, ...daily].map((t) => {
      const naCount = naByContact.get(t.id) || 0;
      const enriched = { ...t, naCount };
      return { ...enriched, reason: reasonFor(enriched) };
    });

    setTasks(combined);
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await initDefaultBrokers();
      await initDefaultColdBrokers();
      await loadTasks();
    })();
  }, [loadTasks]);

  async function handleDone(id: string) {
    const today = new Date().toISOString().split('T')[0];
    await markDone(id, today);
    setDoneIds((prev) => new Set([...prev, id]));
  }

  async function handleSnooze(id: string) {
    await snoozeLead(id, 2);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  async function togglePin(task: DailyTask) {
    if (pinnedIds.has(task.id)) {
      await removePin(task.id);
    } else {
      await addPin(task.id, task.source as TaskSource);
    }
    await loadTasks();
  }

  function openQuickLog(task: DailyTask) {
    setQlFor(task.id);
    setQlChannel(task.channel);
    setQlSpoke(true);
    setQlNotes('');
  }

  async function saveQuickLog(task: DailyTask) {
    setQlSaving(true);
    await quickLog({
      id: task.id,
      source: task.source as TaskSource,
      channel: qlChannel,
      spoke: qlSpoke,
      notes: qlNotes,
      grade: task.grade,
      leadTier: task.leadTier,
    });
    setQlSaving(false);
    setQlFor(null);
    await loadTasks();
  }

  async function runSearch(q: string) {
    setAddQuery(q);
    if (q.trim().length < 2) {
      setAddResults([]);
      return;
    }
    setSearching(true);
    const results = await searchContacts(q);
    setAddResults(results);
    setSearching(false);
  }

  async function addToToday(r: ContactSearchResult) {
    await addPin(r.id, r.source);
    setAddQuery('');
    setAddResults([]);
    await loadTasks();
  }

  const visible = tasks
    .filter((t) => matchesFilter(t, filter))
    .sort((a, b) => {
      // Pinned always first; otherwise the chosen sort.
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return compareBy<DailyTask>(sort)(a, b);
    });

  const doneCount = visible.filter((t) => doneIds.has(t.id)).length;

  return (
    <div className="flex flex-col gap-4">
      {/* Queue progress */}
      <div
        style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}
        className="fade-up"
      >
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <div style={labelMono}>Today&apos;s Queue</div>
            <div style={{ fontFamily: F.display, fontSize: 28, fontWeight: 800, marginTop: 4 }}>
              {doneCount}
              <span style={{ color: C.muted }}> / {visible.length}</span>
            </div>
          </div>
          <span style={labelMono}>{motivational(doneCount, visible.length)}</span>
        </div>
        <div style={{ background: C.surface2, height: 4, borderRadius: 999 }}>
          <div
            style={{
              background: C.accent,
              height: 4,
              borderRadius: 999,
              width: `${visible.length ? (doneCount / visible.length) * 100 : 0}%`,
              transition: 'width 0.3s',
            }}
          />
        </div>
      </div>

      {/* Manual add */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 }} className="fade-up">
        <div style={{ ...labelMono, marginBottom: 8 }}>Add someone to today</div>
        <input
          value={addQuery}
          onChange={(e) => runSearch(e.target.value)}
          placeholder="Search by name or company…"
          style={inputBase}
        />
        {searching && <div style={{ ...labelMono, marginTop: 8 }}>Searching…</div>}
        {addResults.length > 0 && (
          <div className="flex flex-col gap-2" style={{ marginTop: 10 }}>
            {addResults.map((r) => (
              <div
                key={`${r.source}-${r.id}`}
                className="flex items-center justify-between gap-3"
                style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px' }}
              >
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontFamily: F.display, fontWeight: 600, fontSize: 14 }}>{r.name}</span>
                  <span style={{ ...labelMono, marginLeft: 8 }}>{r.company}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span style={pillStyle(sourcePill[r.source])}>{sourceDisplayLabel[r.source]}</span>
                  <button onClick={() => addToToday(r)} style={btnSecondary}>
                    Add
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filter + sort controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => onFilterChange(f.key)}
              style={filter === f.key ? btnPrimary : btnGhost}
            >
              {f.label}
            </button>
          ))}
        </div>
        <SortBar value={sort} onChange={setSort} />
      </div>

      {/* Loading / connection / empty states */}
      {loading && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 32, textAlign: 'center', color: C.muted }} className="fade-up">
          Loading today&apos;s queue from Supabase…
        </div>
      )}

      {!loading && !supabaseConfigured && (
        <div style={{ background: C.redBg, border: `1px solid ${C.red}`, borderRadius: 14, padding: 20, color: C.red }} className="fade-up">
          Not connected to Supabase. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your deployment to load contacts.
        </div>
      )}

      {!loading && supabaseConfigured && visible.length === 0 && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 32, textAlign: 'center', color: C.muted }} className="fade-up">
          Nothing queued for this filter. Pin contacts from the other tabs or add someone above.
        </div>
      )}

      {!loading &&
        visible.map((task, idx) => {
          const isDone = doneIds.has(task.id);
          const isExpanded = expanded === task.id;
          const isPinned = pinnedIds.has(task.id);
          const showQl = qlFor === task.id;

          return (
            <div
              key={task.id}
              style={{
                background: C.surface,
                border: `1px solid ${isPinned ? C.accent : isExpanded ? C.border2 : C.border}`,
                borderRadius: 14,
                overflow: 'hidden',
                opacity: isDone ? 0.5 : 1,
                transition: 'border-color 0.15s, opacity 0.15s',
              }}
              className="fade-up"
            >
              <button
                onClick={() => setExpanded(isExpanded ? null : task.id)}
                style={{ width: '100%', padding: 20, textAlign: 'left' }}
              >
                <div className="flex items-start gap-4">
                  <div
                    style={{
                      fontFamily: F.display,
                      fontSize: 24,
                      fontWeight: 800,
                      color: C.accent,
                      lineHeight: 1,
                      paddingTop: 2,
                      minWidth: 32,
                    }}
                  >
                    {isPinned ? '📌' : String(idx + 1).padStart(2, '0')}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span style={{ fontFamily: F.display, fontWeight: 600, fontSize: 16, color: C.text }}>
                        {task.name}
                      </span>
                      <span style={{ ...labelMono, color: C.muted2 }}>·</span>
                      <span style={labelMono}>{task.company}</span>
                    </div>
                    <div className="flex gap-1.5 mt-2 flex-wrap">
                      <span style={pillStyle(sourcePill[task.source])}>{sourceDisplayLabel[task.source]}</span>
                      <span style={pillStyle(channelPill[task.channel])}>{task.channel}</span>
                      <DaysSincePill days={task.daysSinceTouch} />
                      {isDone && <span style={pillStyle('accent')}>Done</span>}
                    </div>
                    {/* Reason why this is on the list today */}
                    {task.reason && (
                      <div
                        style={{
                          ...labelMono,
                          marginTop: 8,
                          textTransform: 'none',
                          letterSpacing: '0.02em',
                          color: (task.naCount || 0) >= 3 ? C.red : C.muted,
                        }}
                      >
                        {task.reason}
                      </div>
                    )}
                  </div>
                </div>
              </button>

              {isExpanded && (
                <div style={{ padding: '0 20px 20px', borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
                  <ContactLinks email={task.email} phone={task.phone} title={task.title} />

                  {task.context && (
                    <div style={{ margin: '16px 0' }}>
                      <div style={{ ...labelMono, marginBottom: 8 }}>Context</div>
                      <div
                        style={{
                          background: 'rgba(255,201,74,0.06)',
                          borderLeft: `2px solid ${C.amber}`,
                          borderRadius: '0 8px 8px 0',
                          padding: '10px 14px',
                          fontSize: 12,
                          color: '#c8a84a',
                          lineHeight: 1.6,
                        }}
                      >
                        {task.context}
                      </div>
                    </div>
                  )}

                  <MessageCard
                    contactName={task.name}
                    company={task.company}
                    email={task.email}
                    phone={task.phone}
                    channel={task.channel as MsgChannel}
                    initialMessage={task.message}
                    subject={task.subject}
                    intel={task.intel || task.context}
                    broker={task.broker}
                    lastTouch={task.lastTouch}
                  />

                  {/* Quick Log */}
                  {showQl ? (
                    <div style={{ marginTop: 16, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
                      <div style={{ ...labelMono, marginBottom: 8 }}>Quick Log</div>
                      <div className="flex gap-2 flex-wrap" style={{ marginBottom: 12 }}>
                        {(['call', 'text', 'email', 'linkedin'] as Channel[]).map((ch) => (
                          <button
                            key={ch}
                            onClick={() => setQlChannel(ch)}
                            style={qlChannel === ch ? btnPrimary : btnGhost}
                          >
                            {ch}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-2 flex-wrap" style={{ marginBottom: 12 }}>
                        <button onClick={() => setQlSpoke(true)} style={qlSpoke ? btnPrimary : btnGhost}>
                          Spoke to them
                        </button>
                        <button onClick={() => setQlSpoke(false)} style={!qlSpoke ? btnPrimary : btnGhost}>
                          No answer
                        </button>
                      </div>
                      <textarea
                        placeholder="Notes (optional)…"
                        value={qlNotes}
                        onChange={(e) => setQlNotes(e.target.value)}
                        style={{ ...inputBase, height: 60, resize: 'none', marginBottom: 12 }}
                      />
                      <div className="flex gap-2 flex-wrap">
                        <button onClick={() => saveQuickLog(task)} disabled={qlSaving} style={{ ...btnPrimary, opacity: qlSaving ? 0.6 : 1 }}>
                          {qlSaving ? 'Saving…' : 'Save log'}
                        </button>
                        <button onClick={() => setQlFor(null)} style={btnGhost}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div className="flex gap-2 flex-wrap" style={{ marginTop: 16 }}>
                    {!showQl && (
                      <button onClick={() => openQuickLog(task)} style={btnPrimary}>
                        Quick Log
                      </button>
                    )}
                    <button onClick={() => togglePin(task)} style={btnSecondary}>
                      {isPinned ? 'Unpin' : 'Pin to today'}
                    </button>
                    <button onClick={() => handleDone(task.id)} disabled={isDone} style={{ ...btnSecondary, opacity: isDone ? 0.4 : 1 }}>
                      Mark done
                    </button>
                    <button onClick={() => handleSnooze(task.id)} style={btnGhost}>
                      Snooze 2 days
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
