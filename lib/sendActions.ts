// Deep links for sending messages via the OS's default apps.
// sms: opens Messages.app on macOS (PhoneLink-mirrored on Windows) or the
// iMessage app on iOS. mailto: opens the default mail client (Outlook if
// that's your default). No auth or API calls needed.

export function openInMessages(phone: string, message: string): void {
  if (typeof window === 'undefined') return;
  const cleanPhone = (phone || '').replace(/\D/g, '');
  const encoded = encodeURIComponent(message);
  // macOS/iOS accept sms:+1234567890&body=... ; Android uses ?body= ; we use ?
  // which works on both current macOS/iOS and modern Android.
  window.location.href = `sms:${cleanPhone}?body=${encoded}`;
}

export function openInOutlook(email: string, subject: string, body: string): void {
  if (typeof window === 'undefined') return;
  const mailto = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`;
  window.location.href = mailto;
}

// Preferred email flow: create a real Outlook draft via Microsoft Graph and
// open it in Outlook on the web, pre-filled and ready to review/send. Falls
// back to the mailto handler when no Microsoft account is connected or the
// request fails, so the button always does something.
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
