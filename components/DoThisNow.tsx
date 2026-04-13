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

const channelPill: Record<string, string> = {
  call: 'pill-accent',
  text: 'pill-blue',
  email: 'pill-amber',
  linkedin: 'pill-purple',
};

const sourcePill: Record<string, string> = {
  broker: 'pill-purple',
  partner: 'pill-teal',
  prospect: 'pill-accent',
  cold_broker: 'pill-blue',
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
  const [copied, setCopied] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    initDefaultBrokers();
    initDefaultColdBrokers();
    loadTasks();
  }, []);

  function loadTasks() {
    const prospects = getProspects();
    const brokers = getBrokers();
    const partners = getPartners();
    const coldBrokers = getColdBrokers();
    const today = new Date().toISOString().split('T')[0];
    const done = getDone().filter((d) => d.date === today).map((d) => d.id);
    const snoozed = getSnoozed().filter((s) => s.until > today).map((s) => s.id);

    setDoneIds(new Set(done));
    setTasks(selectDaily5(prospects, brokers, partners, coldBrokers, new Set(done), new Set(snoozed)));
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

  function copyMessage(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  if (!mounted) return null;

  const doneCount = tasks.filter((t) => doneIds.has(t.id)).length;

  return (
    <div className="space-y-4">
      <div className="card p-5 fade-up">
        <div className="flex justify-between items-baseline mb-3">
          <div>
            <div className="label-mono">Today&apos;s Queue</div>
            <div className="font-display text-2xl font-bold mt-1">
              {doneCount}<span style={{ color: 'var(--muted)' }}> / {tasks.length}</span>
            </div>
          </div>
          <span className="label-mono">{motivational(doneCount, tasks.length)}</span>
        </div>
        <div className="w-full rounded-full h-1" style={{ background: 'var(--surface2)' }}>
          <div
            className="h-1 rounded-full transition-all"
            style={{
              width: `${tasks.length ? (doneCount / tasks.length) * 100 : 0}%`,
              background: 'var(--accent)',
            }}
          />
        </div>
      </div>

      {tasks.length === 0 && (
        <div className="card p-8 text-center fade-up-1" style={{ color: 'var(--muted)' }}>
          No tasks yet. Import a CSV to get started.
        </div>
      )}

      {tasks.map((task, idx) => {
        const isDone = doneIds.has(task.id);
        const isExpanded = expanded === task.id;
        const fadeClass = `fade-up-${Math.min(idx + 1, 5)}`;

        return (
          <div
            key={task.id}
            className={`card card-hover overflow-hidden transition-opacity ${fadeClass} ${isDone ? 'opacity-50' : ''}`}
          >
            <button onClick={() => setExpanded(isExpanded ? null : task.id)} className="w-full p-5 text-left">
              <div className="flex items-start gap-4">
                <div
                  className="flex-shrink-0 font-display font-bold text-2xl leading-none pt-1"
                  style={{ color: 'var(--accent)' }}
                >
                  {String(idx + 1).padStart(2, '0')}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-display font-semibold text-base truncate">{task.name}</span>
                    <span className="label-mono" style={{ color: 'var(--muted2)' }}>·</span>
                    <span className="label-mono truncate">{task.company}</span>
                  </div>
                  <div className="flex gap-1.5 mt-2 flex-wrap">
                    <span className={`pill ${sourcePill[task.source]}`}>{sourceDisplayLabel[task.source]}</span>
                    <span className={`pill ${channelPill[task.channel]}`}>{task.channel}</span>
                    <span className="pill pill-muted">{task.label}</span>
                    {isDone && <span className="pill pill-accent">Done</span>}
                  </div>
                </div>
              </div>
            </button>

            {isExpanded && (
              <div className="px-5 pb-5 border-t border-[var(--border)] pt-4 space-y-4">
                {task.context && (
                  <div>
                    <div className="label-mono mb-2">Context</div>
                    <div className="intel-box">{task.context}</div>
                  </div>
                )}
                <div>
                  <div className="label-mono mb-2">Message</div>
                  <div className="msg-bubble">{task.message}</div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => copyMessage(task.message, task.id)} className="btn-primary">
                    {copied === task.id ? 'Copied' : 'Copy message'}
                  </button>
                  <button onClick={() => handleDone(task.id)} disabled={isDone} className="btn-secondary">
                    Mark done
                  </button>
                  <button onClick={() => handleSnooze(task.id)} className="btn-ghost">
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
