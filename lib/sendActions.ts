// Deep links for sending messages via the OS's default apps.
// sms: opens Messages.app on macOS (PhoneLink-mirrored on Windows) or the
// iMessage app on iOS. mailto: opens the default mail client (Outlook if
// that's your default). No auth or API calls needed.

// URL for the sms: deep link, shared by openInMessages and anchor-style
// buttons (e.g. Open in Text on /reply).
// macOS/iOS accept sms:+1234567890&body=... ; Android uses ?body= ; we use ?
// which works on both current macOS/iOS and modern Android.
export function buildSmsLink(phone: string, message: string): string {
  const cleanPhone = (phone || '').replace(/\D/g, '');
  return `sms:${cleanPhone}?body=${encodeURIComponent(message)}`;
}

export function openInMessages(phone: string, message: string): void {
  if (typeof window === 'undefined') return;
  window.location.href = buildSmsLink(phone, message);
}

// THE email send path (Amendment 1, Aug 2026): email is sent manually, never
// automatically. This opens the default mail client prefilled via mailto:.
// Known constraint: some clients truncate mailto bodies around 2,000
// characters. George's outreach runs well under that, so it's acceptable
// here — do NOT extend this pattern to long-form email later.
export function openInOutlook(email: string, subject: string, body: string): void {
  if (typeof window === 'undefined') return;
  const mailto = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`;
  window.location.href = mailto;
}

// DORMANT (Amendment 1, Aug 2026): Microsoft Graph was never authenticated —
// ms_oauth_tokens has zero rows — so this "preferred flow" always burned a
// round-trip and fell back to mailto. No UI calls it anymore; email goes
// through openInOutlook above. Kept in place per the amendment: do not
// delete, do not build on it.
//
// A blank tab is opened synchronously inside the click so the browser doesn't
// treat the post-await open as a blocked popup; its location is set once the
// draft's webLink comes back.
export async function composeInOutlook(
  email: string,
  subject: string,
  body: string
): Promise<void> {
  if (typeof window === 'undefined') return;

  const pending = window.open('', '_blank');

  try {
    const res = await fetch('/api/outlook/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: email, subject, body }),
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.ok && data.webLink) {
      if (pending) pending.location.href = data.webLink;
      else window.open(data.webLink, '_blank', 'noopener,noreferrer');
      return;
    }
    // Not connected or Graph failed - fall back to mailto.
    if (pending) pending.close();
    openInOutlook(email, subject, body);
  } catch {
    if (pending) pending.close();
    openInOutlook(email, subject, body);
  }
}

// Opens the OS dialer (tel:). On a phone this places the call; on desktop it
// hands off to the paired-phone / FaceTime / Skype handler.
export function startCall(phone: string): void {
  if (typeof window === 'undefined') return;
  const cleanPhone = (phone || '').replace(/[^\d+]/g, '');
  if (!cleanPhone) return;
  window.location.href = `tel:${cleanPhone}`;
}

export function openLinkedIn(linkedinUrl: string): void {
  if (typeof window === 'undefined') return;
  if (!linkedinUrl) return;
  window.open(linkedinUrl, '_blank', 'noopener,noreferrer');
}

export function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    return Promise.reject(new Error('Clipboard API unavailable'));
  }
  return navigator.clipboard.writeText(text);
}
