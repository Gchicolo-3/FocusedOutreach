'use client';

import { telHref, smsHref, mailtoHref } from '@/lib/sendActions';
import { C, F } from '@/lib/design';

// Tappable contact details for any card: email opens the mail app (bare
// mailto:), phone opens the dialer (tel:), and a Text button opens Messages
// prefilled with the number only (bare sms:). No parameters — so iOS routes
// each to the correct app.
export default function ContactLinks({
  email,
  phone,
  title,
}: {
  email?: string;
  phone?: string;
  title?: string;
}) {
  const linkStyle: React.CSSProperties = {
    fontFamily: F.mono,
    fontSize: 12,
    color: C.blue,
    textDecoration: 'none',
    wordBreak: 'break-all',
  };
  const textBtn: React.CSSProperties = {
    fontFamily: F.mono,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: C.amber,
    background: 'rgba(255,201,74,0.08)',
    border: '1px solid rgba(255,201,74,0.25)',
    borderRadius: 6,
    padding: '2px 8px',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
  };

  if (!email && !phone && !title) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
      {title && <span style={{ fontFamily: F.mono, fontSize: 11, color: C.muted }}>{title}</span>}
      {email && (
        <a href={mailtoHref(email)} style={linkStyle}>
          ✉ {email}
        </a>
      )}
      {phone && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <a href={telHref(phone)} style={linkStyle}>
            ☎ {phone}
          </a>
          <a href={smsHref(phone)} style={textBtn}>
            Text
          </a>
        </div>
      )}
    </div>
  );
}
