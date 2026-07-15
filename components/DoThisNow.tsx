'use client';

import { useState, useEffect } from 'react';
import { DailyTask } from '@/types';
import {
  getProspects,
  getBrokers,
  getPartners,
  getColdBrokers,
  getDone,
  getSnoozed,
  markDone,
  snoozeLead,
  getPinnedToday,
  unpinToday,
  initDefaultBrokers,
  initDefaultColdBrokers,
  getLastLoadError,
  clearLoadError,
} from '@/lib/storage';
import { selectDaily5, buildTasksFromPins } from '@/lib/prioritize';
import { C, F, labelMono, btnSecondary, btnGhost, pillStyle } from '@/lib/design';
import MessageCard from '@/components/MessageCard';

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

function motivational(done: number, total: number): string {
  if (total === 0) return 'Nothing queued';
  if (done === 0) return "Let's go";
  if (done === total) return 'All done — nice work';
  if (done >= total - 1) return 'Almost there';
  if (done >= Math.ceil(total / 2)) return 'Halfway there';
  return 'Keep going';
}

export default function DoThisNow() {
  const [tasks, setTasks] = useState<DailyTask[]>([]);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      await initDefaultBrokers();
      await initDefaultColdBrokers();
      await loadTasks();
    })();
  }, []);

  async function loadTasks() {
    const today = new Date().toISOString().split('T')[0];
    clearLoadError();
    try {
      const [doneAll, snoozedAll, prospects, brokers, partners, coldBrokers, pinned] =
        await Promise.all([
          getDone(),
          getSnoozed(),
          getProspects(),
          getBrokers(),
          getPartners(),
          getColdBrokers(),
          getPinnedToday(),
        ]);
      const done = doneAll.filter((d) => d.date === today).map((d) => d.id);
      const snoozed = snoozedAll.filter((s) => s.until > today).map((s) => s.id);
      setDoneIds(new Set(done));

      // Drop anyone marked "not a fit" before selection.
      const activeBrokers = brokers.filter((b) => !b.dismissed);
      const activePartners = partners.filter((p) => !p.dismissed);
      const activeProspects = prospects.filter((p) => !p.dismissed);
      const activeCold = coldBrokers.filter((c) => !c.dismissed);

      // Contacts the user hand-picked into today go first; the algorithmic
      // daily 5 fills in behind them, minus anyone already pinned.
      const pinnedTasks = buildTasksFromPins(pinned, activeProspects, activeBrokers, activePartners, activeCold);
      const pinnedIdSet = new Set(pinnedTasks.map((t) => t.id));
      setPinnedIds(pinnedIdSet);
      const daily = selectDaily5(
        activeProspects,
        activeBrokers,
        activePartners,
        activeCold,
        new Set(done),
        new Set(snoozed)
      ).filter((t) => !pinnedIdSet.has(t.id));
      setTasks([...pinnedTasks, ...daily]);
      // Surface a silently-swallowed Supabase read failure (e.g. the queue is
      // empty because contacts failed to load, not because there's no work).
      setLoadError(getLastLoadError());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load contacts');
    }
  }

  async function handleDone(id: string) {
    const today = new Date().toISOString().split('T')[0];
    await markDone(id, today);
    setDoneIds((prev) => new Set([...prev, id]));
  }

  async function handleSnooze(id: string) {
    await snoozeLead(id, 2);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  async function handleUnpin(id: string) {
    await unpinToday(id);
    setPinnedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    await loadTasks();
  }

  const doneCount = tasks.filter((t) => doneIds.has(t.id)).length;

  return (
    <div className="flex flex-col gap-4">
      {loadError && (
        <div
          className="fade-up"
          style={{
            background: C.redBg,
            border: `1px solid ${C.red}`,
            borderRadius: 12,
            padding: '12px 16px',
            color: C.red,
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          Couldn&apos;t load contacts: {loadError}. Check your connection and refresh — the
          queue can&apos;t populate until contacts load.
        </div>
      )}
      <div
        style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: 20,
        }}
        className="fade-up"
      >
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <div style={labelMono}>Today&apos;s Queue</div>
            <div style={{ fontFamily: F.display, fontSize: 28, fontWeight: 800, marginTop: 4 }}>
              {doneCount}
              <span style={{ color: C.muted }}> / {tasks.length}</span>
            </div>
          </div>
          <span style={labelMono}>{motivational(doneCount, tasks.length)}</span>
        </div>
        <div style={{ background: C.surface2, height: 4, borderRadius: 999 }}>
          <div
            style={{
              background: C.accent,
              height: 4,
              borderRadius: 999,
              width: `${tasks.length ? (doneCount / tasks.length) * 100 : 0}%`,
              transition: 'width 0.3s',
            }}
          />
        </div>
      </div>

      {tasks.length === 0 && (
        <div
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            padding: 32,
            textAlign: 'center',
            color: C.muted,
          }}
          className="fade-up"
        >
          No tasks yet. Import contacts and activities to get started.
        </div>
      )}

      {tasks.map((task, idx) => {
        const isDone = doneIds.has(task.id);
        const isExpanded = expanded === task.id;

        return (
          <div
            key={task.id}
            style={{
              background: C.surface,
              border: `1px solid ${isExpanded ? C.border2 : C.border}`,
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
                  {String(idx + 1).padStart(2, '0')}
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
                    {pinnedIds.has(task.id) && <span style={pillStyle('accent')}>📌 Pinned</span>}
                    <span style={pillStyle(sourcePill[task.source])}>{sourceDisplayLabel[task.source]}</span>
                    <span style={pillStyle(channelPill[task.channel])}>{task.channel}</span>
                    <span style={pillStyle('muted')}>{task.label}</span>
                    {isDone && <span style={pillStyle('accent')}>Done</span>}
                  </div>
                </div>
              </div>
            </button>

            {isExpanded && (
              <div style={{ padding: '0 20px 20px', borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
                {task.context && (
                  <div style={{ marginBottom: 16 }}>
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
                <div className="flex gap-2 flex-wrap" style={{ marginTop: 16 }}>
                  <button
                    onClick={() => handleDone(task.id)}
                    disabled={isDone}
                    style={{ ...btnSecondary, opacity: isDone ? 0.4 : 1 }}
                  >
                    Mark done
                  </button>
                  {pinnedIds.has(task.id) ? (
                    <button onClick={() => handleUnpin(task.id)} style={btnGhost}>
                      Unpin
                    </button>
                  ) : (
                    <button onClick={() => handleSnooze(task.id)} style={btnGhost}>
                      Snooze 2 days
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
