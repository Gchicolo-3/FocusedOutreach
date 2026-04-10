'use client';

import { useState } from 'react';
import { Sequence } from '@/types';

const sequences: Sequence[] = [
  {
    name: 'Broker Nurture (30-day rolling)',
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
    name: 'Referral Partner Nurture (45-day rolling)',
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
    name: 'New Broker Cold Outreach (21-day)',
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
    name: 'Hot Prospect — Broker Intel Lead (18-day)',
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

const channelIcons: Record<string, { bg: string; label: string }> = {
  call: { bg: 'bg-green-100 text-green-800', label: 'Call' },
  text: { bg: 'bg-blue-100 text-blue-800', label: 'Text' },
  email: { bg: 'bg-yellow-100 text-yellow-800', label: 'Email' },
  linkedin: { bg: 'bg-indigo-100 text-indigo-800', label: 'LinkedIn' },
};

export default function SequencesTab() {
  const [expandedSeq, setExpandedSeq] = useState<number>(0);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {sequences.map((seq, sIdx) => (
        <div key={sIdx} className="bg-white rounded-lg border border-[#e8e8e0]">
          <button
            onClick={() => setExpandedSeq(expandedSeq === sIdx ? -1 : sIdx)}
            className="w-full p-4 text-left flex items-center justify-between"
          >
            <div>
              <h3 className="font-semibold">{seq.name}</h3>
              <p className="text-sm text-gray-500">
                {seq.steps.length} steps over {seq.totalDays} days
              </p>
            </div>
          </button>

          {expandedSeq === sIdx && (
            <div className="px-4 pb-4 border-t border-[#e8e8e0] pt-3">
              <div className="relative">
                <div className="absolute left-4 top-0 bottom-0 w-px bg-[#e8e8e0]" />
                <div className="space-y-3">
                  {seq.steps.map((step, stepIdx) => {
                    const stepKey = `${sIdx}-${stepIdx}`;
                    const isExpanded = expandedStep === stepKey;
                    const ch = channelIcons[step.channel];

                    return (
                      <div key={stepIdx} className="relative pl-10">
                        <div className="absolute left-2.5 top-3 w-3 h-3 rounded-full bg-[#7c3aed] border-2 border-white" />
                        <button
                          onClick={() => setExpandedStep(isExpanded ? null : stepKey)}
                          className="w-full text-left bg-gray-50 rounded-lg p-3 hover:bg-gray-100 transition-colors"
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold text-[#7c3aed]">Day {step.day}</span>
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${ch.bg}`}>
                              {ch.label}
                            </span>
                            <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-200 text-gray-600">
                              Manual
                            </span>
                          </div>
                          {isExpanded && (
                            <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">{step.message}</p>
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
