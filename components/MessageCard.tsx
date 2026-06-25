'use client';

import { useState } from 'react';
import { generateMessage, GenerateChannel } from '@/lib/toneProfile';
import { openInMessages, openInOutlook, copyToClipboard } from '@/lib/sendActions';
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
  const [hasGenerated, setHasGenerated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [phoneInput, setPhoneInput] = useState(phone || '');
  const [showPhoneInput, setShowPhoneInput] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const firstName = contactName.split(' ')[0] || contactName;

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
      setHasGenerated(true);
      setInfo('Draft ready — edit it below before sending');
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
    } catch {
      setError('Clipboard copy failed');
    }
  }

  // Texts: the sms: link is intentionally bare (number only) so iOS always opens
  // Messages. We copy the composed message to the clipboard so George can paste it.
  async function handleSendText() {
    const p = phoneInput || phone || '';
    if (!p) {
      setShowPhoneInput(true);
      return;
    }
    setError('');
    try {
      await copyToClipboard(message);
      setInfo('Copied to clipboard — paste it in Messages');
    } catch {
      setInfo('Opening Messages — copy the message manually');
    }
    openInMessages(p);
  }

  // Email: prefill subject + body directly in the mailto link so Outlook opens
  // with the draft ready. Also copy to clipboard as a backstop.
  async function handleSendEmail() {
    if (!email) {
      setError('No email on file');
      return;
    }
    setError('');
    const subjectLine = msgSubject || `Focus Studio — ${firstName}`;
    try {
      await copyToClipboard(`Subject: ${subjectLine}\n\n${message}`);
    } catch { /* clipboard unavailable — body is still prefilled in the link */ }
    setInfo('Opening Outlook — subject and message prefilled');
    openInOutlook(email, subjectLine, message);
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
            onClick: async () => {
              setShowPhoneInput(false);
              try {
                await copyToClipboard(message);
                setInfo('Copied to clipboard — paste it in Messages');
              } catch { /* clipboard unavailable */ }
              openInMessages(phoneInput);
            },
            label: 'Open Messages',
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

        {hasGenerated &&
          actionBtn({
            onClick: handleGenerate,
            disabled: generating,
            label: generating ? '✨ Regenerating...' : '↻ Regenerate',
            bg: 'rgba(180,157,255,0.06)',
            color: C.purple,
            border: 'rgba(180,157,255,0.2)',
          })}

        {actionBtn({
          onClick: handleCopy,
          label: copied ? '✓ Copied' : '⎘ Copy',
          bg: copied ? C.accentBg : C.surface2,
          color: copied ? C.accent : C.muted,
          border: copied ? 'rgba(200,240,74,0.3)' : C.border,
        })}

        {(activeChannel === 'text' || activeChannel === 'call') &&
          actionBtn({
            onClick: handleSendText,
            label: '📱 Open in Messages',
            bg: 'rgba(255,201,74,0.08)',
            color: C.amber,
            border: 'rgba(255,201,74,0.25)',
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

      {info && (
        <div
          style={{
            ...labelMono,
            color: C.accent,
            marginTop: 8,
            textTransform: 'none',
            letterSpacing: '0.02em',
          }}
        >
          {info}
        </div>
      )}
    </div>
  );
}
