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

const channelColors: Record<string, string> = {
  call: 'bg-green-100 text-green-800',
  text: 'bg-blue-100 text-blue-800',
  email: 'bg-yellow-100 text-yellow-800',
  linkedin: 'bg-indigo-100 text-indigo-800',
};

const sourceColors: Record<string, string> = {
  broker: 'bg-purple-100 text-[#5b21b6]',
  partner: 'bg-teal-100 text-teal-800',
  prospect: 'bg-green-100 text-[#059669]',
  cold_broker: 'bg-blue-100 text-[#1e40af]',
};

const sourceDisplayLabel: Record<string, string> = {
  broker: 'Broker',
  partner: 'Referral Partner',
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
    const selected = selectDaily5(
      prospects,
      brokers,
      partners,
      coldBrokers,
      new Set(done),
      new Set(snoozed)
    );
    setTasks(selected);
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
      <div className="bg-white rounded-lg p-4 border border-[#e8e8e0]">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium">Today&apos;s Progress</span>
          <span className="text-sm text-gray-500">
            {doneCount} of {tasks.length} done — {motivational(doneCount, tasks.length)}
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-[#7c3aed] h-2 rounded-full transition-all"
            style={{ width: `${tasks.length ? (doneCount / tasks.length) * 100 : 0}%` }}
          />
        </div>
      </div>

      {tasks.length === 0 && (
        <div className="bg-white rounded-lg p-8 border border-[#e8e8e0] text-center text-gray-500">
          No tasks yet. Import leads via CSV to get started.
        </div>
      )}

      {tasks.map((task, idx) => {
        const isDone = doneIds.has(task.id);
        const isExpanded = expanded === task.id;

        return (
          <div
            key={task.id}
            className={`bg-white rounded-lg border border-[#e8e8e0] overflow-hidden transition-opacity ${
              isDone ? 'opacity-50' : ''
            }`}
          >
            <button
              onClick={() => setExpanded(isExpanded ? null : task.id)}
              className="w-full p-4 text-left"
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#7c3aed] text-white flex items-center justify-center text-sm font-bold">
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-[#1a1a1a] truncate">{task.name}</span>
                    <span className="text-gray-500 text-sm truncate">{task.company}</span>
                  </div>
                  <div className="flex gap-2 mt-1.5 flex-wrap">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${sourceColors[task.source]}`}>
                      {sourceDisplayLabel[task.source]}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${channelColors[task.channel]}`}>
                      {task.channel.charAt(0).toUpperCase() + task.channel.slice(1)}
                    </span>
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                      {task.label}
                    </span>
                    {isDone && (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                        Done
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </button>

            {isExpanded && (
              <div className="px-4 pb-4 border-t border-[#e8e8e0] pt-3 space-y-3">
                {task.context && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">Context</p>
                    <p className="text-sm text-gray-700">{task.context}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">Message</p>
                  <div className="bg-gray-50 rounded-lg p-3 text-sm whitespace-pre-wrap">{task.message}</div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => copyMessage(task.message, task.id)}
                    className="px-3 py-1.5 text-xs font-medium bg-[#1a1a1a] text-white rounded-md hover:bg-[#333]"
                  >
                    {copied === task.id ? 'Copied!' : 'Copy message'}
                  </button>
                  <button
                    onClick={() => handleDone(task.id)}
                    disabled={isDone}
                    className="px-3 py-1.5 text-xs font-medium bg-[#059669] text-white rounded-md hover:bg-[#047857] disabled:opacity-50"
                  >
                    Mark done
                  </button>
                  <button
                    onClick={() => handleSnooze(task.id)}
                    className="px-3 py-1.5 text-xs font-medium bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
                  >
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
