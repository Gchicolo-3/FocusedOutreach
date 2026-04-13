'use client';

import { useState } from 'react';
import { Sequence } from '@/types';
import { C, F, labelMono, pillStyle } from '@/lib/design';

const sequences: Sequence[] = [
  {
    name: 'Broker Nurture',
    totalDays: 30,
    steps: [
      { day: 1, channel: 'text', auto: false, message: 'Quick thank-you text referencing their last deal or intro. Keep it casual and short.' },
      { day: 3, channel: 'linkedin', auto: false, message: 'Engage with their recent LinkedIn post — like or comment something genuine.' },
      { day: 7, channel: 'email', auto: false, message: 'Send a value-add email: market insight, relevant article, or completed project.' },
      { day: 14, channel: 'text', auto: false, message: 'Casual check-in text. Ask what they are hearing in the market.' },
      { day: 21, channel: 'email', auto: false, message: 'Share a specific project example or case study.' },
      { day: 28, channel: 'call', auto: false, message: 'Call to catch up. Suggest coffee/lunch. Relationship-focused.' },
      { day: 30, channel: 'text', auto: false, message: 'Close the loop — coffee/lunch confirm. Reset the cycle.' },
    ],
  },
  {
    name: 'Referral Partner Nurture',
    totalDays: 45,
    steps: [
      { day: 1, channel: 'text', auto: false, message: 'Friendly hello text. Just checking in, no ask.' },
      { day: 7, channel: 'linkedin', auto: false, message: 'Engage with their LinkedIn content — comment or share.' },
      { day: 15, channel: 'email', auto: false, message: 'Value-add email relevant to their profession.' },
      { day: 25, channel: 'text', auto: false, message: 'Casual check-in about clients working through moves.' },
      { day: 35, channel: 'email', auto: false, message: 'Offer to help on any specific client situation.' },
      { day: 45, channel: 'call', auto: false, message: 'Coffee or lunch ask. Reset the 45-day cycle.' },
    ],
  },
  {
    name: 'New Broker Cold Outreach',
    totalDays: 21,
    steps: [
      { day: 1, channel: 'linkedin', auto: false, message: 'Send LinkedIn connection request with custom note.' },
      { day: 2, channel: 'email', auto: false, message: 'Cold intro email — who you are, value prop. Short.' },
      { day: 5, channel: 'text', auto: false, message: 'Follow-up text referencing the email.' },
      { day: 8, channel: 'email', auto: false, message: 'Value-add email #2 — before/after rendering example.' },
      { day: 12, channel: 'call', auto: false, message: 'Phone call attempt. Leave voicemail if no answer.' },
      { day: 16, channel: 'linkedin', auto: false, message: 'Engage with their content on LinkedIn.' },
      { day: 21, channel: 'email', auto: false, message: 'Final touch — graceful close.' },
    ],
  },
  {
    name: 'Hot Prospect — Broker Intel Lead',
    totalDays: 18,
    steps: [
      { day: 1, channel: 'call', auto: false, message: 'Call immediately after broker intro. Reference broker and opportunity.' },
      { day: 1, channel: 'text', auto: false, message: 'If no answer, send a text referencing the broker.' },
      { day: 3, channel: 'email', auto: false, message: 'Follow-up email with portfolio examples.' },
      { day: 5, channel: 'text', auto: false, message: 'Quick text check-in. Offer a visual of top options.' },
      { day: 8, channel: 'call', auto: false, message: 'Second call attempt. Offer something concrete.' },
      { day: 12, channel: 'email', auto: false, message: 'Send a relevant case study or before/after.' },
      { day: 15, channel: 'text', auto: false, message: 'Casual follow-up: Still happy to help if timing works.' },
      { day: 18, channel: 'email', auto: false, message: 'Graceful close: Happy to help whenever.' },
    ],
  },
];

const channelPill: Record<string, 'accent' | 'blue' | 'amber' | 'purple'> = {
  call: 'accent',
  text: 'blue',
  email: 'amber',
  linkedin: 'purple',
};

export default function SequencesTab() {
  const [expandedSeq, setExpandedSeq] = useState<number>(0);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4 fade-up">
      <div className="flex items-baseline justify-between">
        <h2 style={{ fontFamily: F.display, fontSize: 18, fontWeight: 700, color: C.text }}>Sequence Playbooks</h2>
        <span style={labelMono}>{sequences.length} sequences</span>
      </div>

      {sequences.map((seq, sIdx) => (
        <div
          key={sIdx}
          style={{
            background: C.surface,
            border: `1px solid ${expandedSeq === sIdx ? C.border2 : C.border}`,
            borderRadius: 12,
          }}
        >
          <button
            onClick={() => setExpandedSeq(expandedSeq === sIdx ? -1 : sIdx)}
            style={{ width: '100%', padding: 20, textAlign: 'left' }}
          >
            <h3 style={{ fontFamily: F.display, fontWeight: 600, fontSize: 15, color: C.text }}>{seq.name}</h3>
            <div className="flex gap-3 mt-1">
              <span style={labelMono}>{seq.steps.length} steps</span>
              <span style={{ ...labelMono, color: C.muted2 }}>·</span>
              <span style={labelMono}>{seq.totalDays} days</span>
            </div>
          </button>

          {expandedSeq === sIdx && (
            <div style={{ padding: '16px 20px 20px', borderTop: `1px solid ${C.border}` }}>
              <div style={{ position: 'relative' }}>
                <div
                  style={{
                    position: 'absolute',
                    left: 12,
                    top: 0,
                    bottom: 0,
                    width: 1,
                    background: C.border,
                  }}
                />
                <div className="flex flex-col gap-3">
                  {seq.steps.map((step, stepIdx) => {
                    const stepKey = `${sIdx}-${stepIdx}`;
                    const isExpanded = expandedStep === stepKey;
                    return (
                      <div key={stepIdx} style={{ position: 'relative', paddingLeft: 32 }}>
                        <div
                          style={{
                            position: 'absolute',
                            left: 6,
                            top: 14,
                            width: 12,
                            height: 12,
                            borderRadius: '50%',
                            background: C.accent,
                            border: `2px solid ${C.bg}`,
                          }}
                        />
                        <button
                          onClick={() => setExpandedStep(isExpanded ? null : stepKey)}
                          style={{
                            width: '100%',
                            textAlign: 'left',
                            background: C.surface2,
                            borderRadius: 8,
                            padding: 12,
                          }}
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <span style={{ ...labelMono, color: C.accent, fontWeight: 700 }}>Day {step.day}</span>
                            <span style={pillStyle(channelPill[step.channel])}>{step.channel}</span>
                            <span style={pillStyle('muted')}>Manual</span>
                          </div>
                          {isExpanded && (
                            <p style={{ marginTop: 8, fontSize: 13, color: C.text, whiteSpace: 'pre-wrap' }}>
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
