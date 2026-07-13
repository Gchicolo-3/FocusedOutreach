'use client';

import { useState } from 'react';
import { generateMessage, GenerateChannel } from '@/lib/toneProfile';
import { openInMessages, composeInOutlook, startCall } from '@/lib/sendActions';
import { C, F, labelMono, inputBase } from '@/lib/design';

type MessageCardProps = {
  contactName: string;
  company: string;
  email?: string;
  phone?: string;
  channel: GenerateChannel;
  initialMessage: string;
  subject?: string;
  intel?: string;
  broker?: string;
  opportunity?: string;
  lastTouch?: string;
};

export default function MessageCard({
  contactName,
  company,
  email,
  phone,
  channel: initialChannel,
  initialMessage,
  subject,
  intel,
  broker,
  opportunity,
  lastTouch,
}: MessageCardProps) {
  const [activeChannel, setActiveChannel] = useState<GenerateChannel>(initialChannel);
  const [message, setMessage] = useState(initialMessage);
  const [msgSubject, setMsgSubject] = useState(subject || '');
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [phoneInput, setPhoneInput] = useState(phone || '');
  const [showPhoneInput, setShowPhoneInput] = useState(false);
  const [error, setError] = useState('');

  const firstName = contactName.split(' ')[0];

  const channels: GenerateChannel[] = ['text', 'email', 'linkedin', 'call'];
  const channelLabels: Record<GenerateChannel, string> = {
    text: '💬 Text',
    email: '✉️ Email',
    linkedin: '🔗 LinkedIn',
    call: '📞 Call',
  };

  async function handleGenerate() {
    setGenerating(true);
    setError('');
    try {
      const generated = await generateMessage({
        contactName,
        company,
        channel: activeChannel,
        intel,
        broker,
        opportunity,
        lastTouch,
      });

      if (activeChannel === 'email' && generated.startsWith('Subject:')) {
        const firstLineEnd = generated.indexOf('\n');
        const subjLine = generated.slice(0, firstLineEnd >= 0 ? firstLineEnd : generated.length);
        const rest = firstLineEnd >= 0 ? generated.slice(firstLineEnd + 1) : '';
        setMsgSubject(subjLine.replace(/^Subject:\s*/i, '').trim());
        setMessage(rest.trim());
      } else {
        setMessage(generated);
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(m || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopy() {
    const fullText =
      activeChannel === 'email' && msgSubject ? `Subject: ${msgSubject}\n\n${message}` : message;
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      setError('Clipboard copy failed');
    }
  }

  function handleSendText() {
    const p = phoneInput || phone || '';
    if (!p) {
      setShowPhoneInput(true);
      return;
    }
    openInMessages(p, message);
  }

  function handleSendEmail() {
    if (!email) {
      setError('No email on file');
      return;
    }
    void composeInOutlook(email, msgSubject || `Focus Studio — ${firstName}`, message);
  }

  function handleCall() {
    const p = phoneInput || phone || '';
    if (!p) {
      setShowPhoneInput(true);
      return;
    }
    startCall(p);
  }

  const actionBtn = (opts: {
    onClick: () => void | Promise<void>;
    label: string;
    active?: boolean;
    disabled?: boolean;
    bg: string;
    color: string;
    border: string;
  }): React.ReactElement => (
    <button
      onClick={opts.onClick}
      disabled={opts.disabled}
      style={{
        fontFamily: F.mono,
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '0.06em',
        padding: '8px 14px',
        borderRadius: 8,
        cursor: opts.disabled ? 'wait' : 'pointer',
        background: opts.bg,
        color: opts.color,
        border: `1px solid ${opts.border}`,
        opacity: opts.disabled ? 0.7 : 1,
        textTransform: 'uppercase',
        transition: 'all 0.15s',
      }}
    >
      {opts.label}
    </button>
  );

  return (
    <div style={{ marginTop: 12 }}>
      {/* Channel switcher */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {channels.map((ch) => (
          <button
            key={ch}
            onClick={() => setActiveChannel(ch)}
            style={{
              fontFamily: F.mono,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.04em',
              padding: '6px 10px',
              borderRadius: 6,
              cursor: 'pointer',
              background: activeChannel === ch ? C.accentBg : 'transparent',
              color: activeChannel === ch ? C.accent : C.muted,
              border: `1px solid ${activeChannel === ch ? 'rgba(200,240,74,0.3)' : C.border}`,
              transition: 'all 0.15s',
            }}
          >
            {channelLabels[ch]}
          </button>
        ))}
      </div>

      {activeChannel === 'email' && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ ...labelMono, marginBottom: 6 }}>Subject</div>
          <input
            value={msgSubject}
            onChange={(e) => setMsgSubject(e.target.value)}
            placeholder="Subject line..."
            style={inputBase}
          />
        </div>
      )}

      <div style={{ ...labelMono, marginBottom: 6 }}>Message — edit before sending</div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={activeChannel === 'email' ? 6 : 3}
        style={{ ...inputBase, resize: 'vertical', lineHeight: 1.7, marginBottom: 12 }}
      />

      {showPhoneInput && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
          <input
            placeholder="Enter phone number..."
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            style={{ ...inputBase, flex: 1 }}
          />
          {actionBtn({
            onClick: () => {
              setShowPhoneInput(false);
              if (activeChannel === 'call') startCall(phoneInput);
              else openInMessages(phoneInput, message);
            },
            label: activeChannel === 'call' ? 'Call' : 'Open Messages',
            bg: C.amberBg,
            color: C.amber,
            border: 'rgba(255,201,74,0.25)',
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {actionBtn({
          onClick: handleGenerate,
          disabled: generating,
          label: generating ? '✨ Generating...' : '✨ Write in my voice',
          bg: 'rgba(180,157,255,0.1)',
          color: C.purple,
          border: 'rgba(180,157,255,0.25)',
        })}

        {actionBtn({
          onClick: handleCopy,
          label: copied ? '✓ Copied' : '⎘ Copy',
          bg: copied ? C.accentBg : C.surface2,
          color: copied ? C.accent : C.muted,
          border: copied ? 'rgba(200,240,74,0.3)' : C.border,
        })}

        {activeChannel === 'text' &&
          actionBtn({
            onClick: handleSendText,
            label: '📱 Open in Messages',
            bg: 'rgba(255,201,74,0.08)',
            color: C.amber,
            border: 'rgba(255,201,74,0.25)',
          })}

        {activeChannel === 'call' &&
          actionBtn({
            onClick: handleCall,
            label: '📞 Call',
            bg: 'rgba(200,240,74,0.1)',
            color: C.accent,
            border: 'rgba(200,240,74,0.3)',
          })}

        {activeChannel === 'email' &&
          email &&
          actionBtn({
            onClick: handleSendEmail,
            label: '✉️ Open in Outlook',
            bg: 'rgba(74,176,255,0.08)',
            color: C.blue,
            border: 'rgba(74,176,255,0.2)',
          })}
      </div>

      {error && (
        <div
          style={{
            ...labelMono,
            color: C.red,
            marginTop: 8,
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
