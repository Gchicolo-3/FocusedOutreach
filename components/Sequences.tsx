'use client';

import { useState } from 'react';
import { Sequence } from '@/types';

const sequences: Sequence[] = [
  {
    name: 'Broker Nurture',
    totalDays: 30,
    steps: [
      { day: 1, channel: 'text', auto: false, message: 'Quick thank-you text referencing their last deal or intro. Keep it casual and short.' },
      { day: 3, channel: 'linkedin', auto: false, message: 'Engage with their recent LinkedIn post — like or comment something genuine.' },
      { day: 7, channel: 'email', auto: false, message: 'Send a value-add email: market insight, a relevant article, or a completed project they would find interesting.' },
      { day: 14, channel: 'text', auto: false, message: 'Casual check-in text. Ask what they are hearing in the market or reference a specific deal type.' },
      { day: 21, channel: 'email', auto: false, message: 'Share a specific project example or case study relevant to their deal types.' },
      { day: 28, channel: 'call', auto: false, message: 'Call to catch up. Suggest coffee/lunch. Keep it relationship-focused, not salesy.' },
      { day: 30, channel: 'text', auto: false, message: 'Close the loop — coffee/lunch confirm or reschedule. Reset the 30-day cycle.' },
    ],
  },
  {
    name: 'Referral Partner Nurture',
    totalDays: 45,
    steps: [
      { day: 1, channel: 'text', auto: false, message: 'Friendly hello text. Just checking in, no ask. Build relationship equity.' },
      { day: 7, channel: 'linkedin', auto: false, message: 'Engage with their LinkedIn content — comment or share something they posted.' },
      { day: 15, channel: 'email', auto: false, message: 'Value-add email. Share something useful relevant to their profession (market report, case study, article).' },
      { day: 25, channel: 'text', auto: false, message: 'Casual check-in. "Hope business is good — any clients working through a move lately?"' },
      { day: 35, channel: 'email', auto: false, message: 'Offer to help on any specific client situation. Keep it no-pressure.' },
      { day: 45, channel: 'call', auto: false, message: 'Coffee or lunch ask. Reset the 45-day cycle.' },
    ],
  },
  {
    name: 'New Broker Cold Outreach',
    totalDays: 21,
    steps: [
      { day: 1, channel: 'linkedin', auto: false, message: 'Send LinkedIn connection request with a short custom note referencing their firm and market.' },
      { day: 2, channel: 'email', auto: false, message: 'Cold intro email — who you are, what you do, specific value prop for their deals. Short and clear.' },
      { day: 5, channel: 'text', auto: false, message: 'Follow-up text: Hey [Name] — sent you a note earlier this week. Would love to be a resource for your deals.' },
      { day: 8, channel: 'email', auto: false, message: 'Value-add email #2 — share a specific before/after rendering example or case study.' },
      { day: 12, channel: 'call', auto: false, message: 'Phone call attempt. Leave a voicemail if no answer — reference the email and offer a quick 5-min chat.' },
      { day: 16, channel: 'linkedin', auto: false, message: 'Engage with their content on LinkedIn. Comment something specific and valuable.' },
      { day: 21, channel: 'email', auto: false, message: 'Final touch: Last note from me — just wanted to make sure you know I am here if your tenants ever need space visualization.' },
    ],
  },
  {
    name: 'Hot Prospect — Broker Intel Lead',
    totalDays: 18,
    steps: [
      { day: 1, channel: 'call', auto: false, message: 'Call immediately after broker intro. Reference the broker by name and the specific opportunity.' },
      { day: 1, channel: 'text', auto: false, message: 'If no answer on call, send a text referencing the broker and opportunity.' },
      { day: 3, channel: 'email', auto: false, message: 'Follow-up email with portfolio examples relevant to their space type. Keep it specific to their search.' },
      { day: 5, channel: 'text', auto: false, message: 'Quick text check-in. Offer to put together a visual of the top options.' },
      { day: 8, channel: 'call', auto: false, message: 'Second call attempt. Reference your email and offer something concrete — a free rendering of their top space.' },
      { day: 12, channel: 'email', auto: false, message: 'Send a relevant case study or before/after example. Show the transformation.' },
      { day: 15, channel: 'text', auto: false, message: 'Casual follow-up: Still happy to help if the timing works out.' },
      { day: 18, channel: 'email', auto: false, message: 'Graceful close: Happy to help whenever the timing is right.' },
    ],
  },
];

const channelPill: Record<string, string> = {
  call: 'pill-accent',
  text: 'pill-blue',
  email: 'pill-amber',
  linkedin: 'pill-purple',
};

export default function SequencesTab() {
  const [expandedSeq, setExpandedSeq] = useState<number>(0);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  return (
    <div className="space-y-4 fade-up">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-xl font-bold">Sequence Playbooks</h2>
        <span className="label-mono">{sequences.length} sequences</span>
      </div>

      {sequences.map((seq, sIdx) => (
        <div key={sIdx} className={`card card-hover fade-up-${Math.min(sIdx + 1, 5)}`}>
          <button
            onClick={() => setExpandedSeq(expandedSeq === sIdx ? -1 : sIdx)}
            className="w-full p-5 text-left flex items-center justify-between"
          >
            <div>
              <h3 className="font-display font-semibold text-base">{seq.name}</h3>
              <div className="flex gap-3 mt-1">
                <span className="label-mono">{seq.steps.length} steps</span>
                <span className="label-mono" style={{ color: 'var(--muted2)' }}>·</span>
                <span className="label-mono">{seq.totalDays} days</span>
              </div>
            </div>
          </button>

          {expandedSeq === sIdx && (
            <div className="px-5 pb-5 border-t border-[var(--border)] pt-4">
              <div className="relative">
                <div className="absolute left-3 top-0 bottom-0 w-px" style={{ background: 'var(--border)' }} />
                <div className="space-y-3">
                  {seq.steps.map((step, stepIdx) => {
                    const stepKey = `${sIdx}-${stepIdx}`;
                    const isExpanded = expandedStep === stepKey;

                    return (
                      <div key={stepIdx} className="relative pl-8">
                        <div
                          className="absolute left-1.5 top-3.5 w-3 h-3 rounded-full"
                          style={{ background: 'var(--accent)', border: '2px solid var(--bg)' }}
                        />
                        <button
                          onClick={() => setExpandedStep(isExpanded ? null : stepKey)}
                          className="w-full text-left rounded-lg p-3 transition-colors"
                          style={{ background: 'var(--surface2)' }}
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="label-mono font-bold" style={{ color: 'var(--accent)' }}>
                              Day {step.day}
                            </span>
                            <span className={`pill ${channelPill[step.channel]}`}>{step.channel}</span>
                            <span className="pill pill-muted">Manual</span>
                          </div>
                          {isExpanded && (
                            <p className="mt-2 text-sm whitespace-pre-wrap" style={{ color: 'var(--text)' }}>
                              {step.message}
                            </p>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
