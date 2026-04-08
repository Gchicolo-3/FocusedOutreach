'use client';

import { useState, useEffect } from 'react';
import { Lead } from '@/types';
import { getLeads, getDone, getSnoozed, markDone, snoozeLead } from '@/lib/storage';
import { selectDaily5 } from '@/lib/prioritize';
import { getLeadMessage } from '@/lib/messages';

const channelColors: Record<string, string> = {
  call: 'bg-green-100 text-green-800',
  text: 'bg-blue-100 text-blue-800',
  email: 'bg-yellow-100 text-yellow-800',
  linkedin: 'bg-indigo-100 text-indigo-800',
};

const sourceLabel = (lead: Lead) => {
  if (lead.broker) return 'Broker Intel';
  if (lead.tier === 1) return 'Warm';
  if (lead.tier === 2) return 'Warm';
  return 'Cold';
};

const sourceColors: Record<string, string> = {
  'Broker Intel': 'bg-purple-100 text-[#5b21b6]',
  Warm: 'bg-green-100 text-[#059669]',
  Cold: 'bg-gray-100 text-gray-600',
  'New Broker': 'bg-blue-100 text-[#1e40af]',
};

export default function DoThisNow() {
  const [tasks, setTasks] = useState<Lead[]>([]);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    loadTasks();
  }, []);

  function loadTasks() {
    const leads = getLeads();
    const today = new Date().toISOString().split('T')[0];
    const done = getDone()
      .filter((d) => d.date === today)
      .map((d) => d.id);
    const snoozed = getSnoozed()
      .filter((s) => s.until > today)
      .map((s) => s.id);

    setDoneIds(new Set(done));
    const selected = selectDaily5(leads, new Set(done), new Set(snoozed), []);
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

  const doneCount = tasks.filter((t) => doneIds.has(t.id)).length;

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div className="bg-white rounded-lg p-4 border border-[#e8e8e0]">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium">Today&apos;s Progress</span>
          <span className="text-sm text-gray-500">{doneCount} of {tasks.length} done</span>
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
        const message = getLeadMessage(task);
        const source = sourceLabel(task);

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
                    <span className="font-semibold text-[#1a1a1a] truncate">
                      {task.company}
                    </span>
                    <span className="text-gray-500 text-sm truncate">
                      {task.contact}
                    </span>
                  </div>
                  <div className="flex gap-2 mt-1.5">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${channelColors[task.channel]}`}>
                      {task.channel.charAt(0).toUpperCase() + task.channel.slice(1)}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${sourceColors[source]}`}>
                      {source}
                    </span>
                    {isDone && (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                        Done
                      </span>
                    )}
                  </div>
                </div>
                <svg
                  className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {isExpanded && (
              <div className="px-4 pb-4 border-t border-[#e8e8e0] pt-3 space-y-3">
                {task.comments && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">Intel</p>
                    <p className="text-sm text-gray-700">{task.comments}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">Message</p>
                  <div className="bg-gray-50 rounded-lg p-3 text-sm whitespace-pre-wrap">
                    {message}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => copyMessage(message, task.id)}
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
