// Deep links for the OS's default apps.
//
// iPhone routing rules learned the hard way:
//   - sms: must be BARE — protocol + number only. An sms: link with "?body="
//     uses the wrong delimiter for iOS (it expects "&body=") and can make the OS
//     misroute, e.g. opening Mail for a text. So we keep sms: bare and hand the
//     message off via clipboard (copy → paste in Messages).
//   - mailto: is the standard, well-supported scheme. subject/body encoded with
//     encodeURIComponent open correctly in the default mail app (Outlook
//     included) on both iOS and desktop, so we DO prefill those.

// Digits only. iOS/Android dialers and Messages accept a bare digit string;
// a leading "+" is preserved for international numbers.
function cleanPhone(phone: string): string {
  const raw = (phone || '').trim();
  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');
  return hasPlus ? `+${digits}` : digits;
}

export function telHref(phone: string): string {
  return `tel:${cleanPhone(phone)}`;
}

export function smsHref(phone: string): string {
  return `sms:${cleanPhone(phone)}`;
}

export function mailtoHref(email: string): string {
  return `mailto:${(email || '').trim()}`;
}

// Opens Messages with the recipient prefilled, no body. Pair with copyToClipboard
// so George can paste the message he composed.
export function openInMessages(phone: string): void {
  if (typeof window === 'undefined') return;
  const p = cleanPhone(phone);
  if (!p) return;
  window.location.href = `sms:${p}`;
}

// Opens the default mail app (Outlook if that's the default) to the recipient,
// with subject and body prefilled. Format: mailto:[email]?subject=...&body=...
// with each value run through encodeURIComponent. Works on iOS + desktop.
export function openInOutlook(email: string, subject?: string, body?: string): void {
  if (typeof window === 'undefined') return;
  const e = (email || '').trim();
  if (!e) return;
  const params: string[] = [];
  if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
  if (body) params.push(`body=${encodeURIComponent(body)}`);
  const qs = params.length ? `?${params.join('&')}` : '';
  window.location.href = `mailto:${e}${qs}`;
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
