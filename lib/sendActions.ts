// Deep links for the OS's default apps.
//
// IMPORTANT (iPhone bug fix): links must be BARE — protocol + recipient only,
// no ?body= / ?subject= parameters. On iOS, an sms: link with a "?body=" (the
// wrong delimiter — iOS expects "&body=") or a mailto: with an encoded body can
// make the OS misroute, e.g. opening Messages for an email. Stripping all
// parameters makes email always open the mail app and text always open
// Messages. The message body is handled separately via Copy → paste.

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
// no subject/body. Pair with copyToClipboard for the message.
export function openInOutlook(email: string): void {
  if (typeof window === 'undefined') return;
  const e = (email || '').trim();
  if (!e) return;
  window.location.href = `mailto:${e}`;
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
