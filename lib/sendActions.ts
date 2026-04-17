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
