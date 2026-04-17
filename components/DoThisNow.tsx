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
  initDefaultBrokers,
  initDefaultColdBrokers,
} from '@/lib/storage';
import { selectDaily5 } from '@/lib/prioritize';
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
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    initDefaultBrokers();
    initDefaultColdBrokers();
    loadTasks();
  }, []);

  function loadTasks() {
    const today = new Date().toISOString().split('T')[0];
    const done = getDone().filter((d) => d.date === today).map((d) => d.id);
    const snoozed = getSnoozed().filter((s) => s.until > today).map((s) => s.id);
    setDoneIds(new Set(done));
    setTasks(
      selectDaily5(getProspects(), getBrokers(), getPartners(), getColdBrokers(), new Set(done), new Set(snoozed))
    );
  }

  function handleDone(id: string) {
    const today = new Date().toISOString().split('T')[0];
    markDone(id, today);
    setDoneIds((prev) => new Set([...prev, id]));
  }

  function handleSnooze(id: string) {
    snoozeLead(id, 2);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  const doneCount = tasks.filter((t) => doneIds.has(t.id)).length;

  return (
    <div className="flex flex-col gap-4">
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
