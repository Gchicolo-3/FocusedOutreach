'use client';

import { useState } from 'react';
import { generateMessage } from '@/lib/toneProfile';
import { composeInOutlook } from '@/lib/sendActions';
import { logActivity } from '@/lib/storage';
import { C, F, labelMono, btnPrimary, btnSecondary, inputBase } from '@/lib/design';

type InlineComposeProps = {
  contactId: string;
  contactName: string;
  company: string;
  email?: string;
  contactType: 'broker' | 'partner';
  /** Base intel/notes about the contact, fed to the generator. */
  intel?: string;
  lastTouch?: string;
  /** Called after an activity is logged so the parent can refresh. */
  onLogged?: () => void;
};

const INCLUDE_TAGS = ['Broker Deck', 'Section 179', 'Spec Suite'] as const;

export default function InlineCompose({
  contactId,
  contactName,
  company,
  email,
  contactType,
  intel,
  lastTouch,
  onLogged,
}: InlineComposeProps) {
  const [context, setContext] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [hasDraft, setHasDraft] = useState(false);
  const [error, setError] = useState('');
  const [logging, setLogging] = useState(false);
  const [logged, setLogged] = useState(false);

  function toggleTag(tag: string) {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  // What the email should be about: what George typed plus anything he chose
  // to include. The contact's notes go separately as background intel.
  function buildPurpose(): string {
    const tagLine = tags.length ? `Wants to mention: ${tags.join(', ')}.` : '';
    return [context.trim(), tagLine].filter(Boolean).join(' ');
  }

  async function handleGenerate() {
    setGenerating(true);
    setError('');
    setLogged(false);
    try {
      const generated = await generateMessage({
        contactName,
        company,
        channel: 'email',
        purpose: buildPurpose(),
        intel,
        lastTouch,
      });

      if (generated.startsWith('Subject:')) {
        const nl = generated.indexOf('\n');
        const subjLine = generated.slice(0, nl >= 0 ? nl : generated.length);
        const rest = nl >= 0 ? generated.slice(nl + 1) : '';
        setSubject(subjLine.replace(/^Subject:\s*/i, '').trim());
        setBody(rest.trim());
      } else {
        setSubject(`Quick note, ${contactName.split(' ')[0]}`);
        setBody(generated.trim());
      }
      setHasDraft(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }

  function handleOpenEmail() {
    if (!email) {
      setError('No email on file for this contact');
      return;
    }
    void composeInOutlook(email, subject || `Quick note, ${contactName.split(' ')[0]}`, body);
  }

  async function handleLogActivity() {
    setLogging(true);
    setError('');
    try {
      const comments = [context.trim(), tags.length ? `Included: ${tags.join(', ')}` : '']
        .filter(Boolean)
        .join(' | ');
      await logActivity({
        contactId,
        contactType,
        fullName: contactName,
        company,
        subject: subject || context.trim().slice(0, 80) || 'Outreach',
        comments: comments || 'Outreach logged',
        activityType: 'Email',
      });
      setLogged(true);
      onLogged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to log activity');
    } finally {
      setLogging(false);
    }
  }

  const fieldLabel = { ...labelMono, marginBottom: 6 } as React.CSSProperties;

  return (
    <div style={{ marginTop: 12 }}>
      {/* Pre-filled contact identity */}
      <div
        style={{
          background: C.surface2,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: '10px 14px',
          marginBottom: 14,
        }}
      >
        <div style={{ fontFamily: F.display, fontWeight: 600, fontSize: 14, color: C.text }}>
          {contactName}
        </div>
        <div className="flex gap-2 flex-wrap" style={{ marginTop: 2 }}>
          <span style={labelMono}>{company || 'No company'}</span>
          <span style={{ ...labelMono, color: C.muted2 }}>·</span>
          <span style={labelMono}>{email || 'No email on file'}</span>
        </div>
      </div>

      {/* Purpose */}
      <div style={fieldLabel}>What&apos;s this email about?</div>
      <textarea
        value={context}
        onChange={(e) => setContext(e.target.value)}
        rows={3}
        placeholder="e.g. saw their 40k SF lease at 101 Hudson, want to offer a test fit before they sign"
        style={{ ...inputBase, resize: 'vertical', lineHeight: 1.6, marginBottom: 14 }}
      />

      {/* Include tags */}
      <div style={fieldLabel}>Include?</div>
      <div className="flex gap-2 flex-wrap" style={{ marginBottom: 14 }}>
        {INCLUDE_TAGS.map((tag) => {
          const active = tags.includes(tag);
          return (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              style={{
                fontFamily: F.mono,
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                padding: '6px 12px',
                borderRadius: 999,
                cursor: 'pointer',
                background: active ? C.accentBg : 'transparent',
                color: active ? C.accent : C.muted,
                border: `1px solid ${active ? 'rgba(200,240,74,0.3)' : C.border}`,
                transition: 'all 0.15s',
              }}
            >
              {active ? '✓ ' : '+ '}
              {tag}
            </button>
          );
        })}
      </div>

      <button
        onClick={handleGenerate}
        disabled={generating}
        style={{
          ...btnPrimary,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          opacity: generating ? 0.7 : 1,
          cursor: generating ? 'wait' : 'pointer',
        }}
      >
        {generating && (
          <span
            className="spin"
            style={{
              display: 'inline-block',
              width: 12,
              height: 12,
              borderRadius: '50%',
              border: '2px solid rgba(14,14,14,0.35)',
              borderTopColor: '#0e0e0e',
            }}
          />
        )}
        {generating ? 'Writing in George’s voice…' : '✨ Generate draft'}
      </button>

      {/* Draft */}
      {hasDraft && (
        <div className="fade-up" style={{ marginTop: 16 }}>
          <div style={fieldLabel}>Subject</div>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject line…"
            style={{ ...inputBase, marginBottom: 12 }}
          />

          <div style={fieldLabel}>Draft — edit before sending</div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={7}
            style={{ ...inputBase, resize: 'vertical', lineHeight: 1.7, marginBottom: 12 }}
          />

          <div className="flex gap-2 flex-wrap items-center">
            <button onClick={handleOpenEmail} style={btnPrimary}>
              ✉️ Open in Email
            </button>
            <button
              onClick={handleLogActivity}
              disabled={logging}
              style={{ ...btnSecondary, opacity: logging ? 0.6 : 1 }}
            >
              {logging ? 'Logging…' : logged ? '✓ Logged' : 'Log activity'}
            </button>
            {logged && (
              <span style={{ ...labelMono, color: C.accent }}>
                Activity saved · cadence reset
              </span>
            )}
          </div>
        </div>
      )}

      {error && (
        <div
          style={{
            ...labelMono,
            color: C.red,
            marginTop: 10,
            textTransform: 'none',
            letterSpacing: '0.02em',
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
