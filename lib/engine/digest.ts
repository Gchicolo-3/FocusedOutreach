// lib/engine/digest.ts
// Compiles the morning digest and emails George.
// Short and mobile friendly: a one line summary, the top 5 most overdue
// contacts with context, and a single dashboard link. No draft previews.

import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.GMAIL_USER!,
    pass: process.env.GMAIL_APP_PASSWORD!
  }
});

// George's voice rules ban em dashes; enforce that on every piece of dynamic
// content (notes can contain anything), and escape HTML while we're at it.
function clean(value: unknown): string {
  return String(value ?? '')
    .replace(/[—–]/g, '-')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Days since last touch. Handles the mixed date formats in the contact tables
// ("2026-06-16" and "6/23/2026"); returns null when missing or unparseable.
function daysSinceLastTouch(lastTouch?: string): number | null {
  if (!lastTouch) return null;
  const d = new Date(lastTouch);
  if (isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24)));
}

// One line of context from the contact's notes (imports merge activity
// comments into notes). First line only, truncated.
function contextLine(contact: { notes?: string }): string {
  const raw = (contact.notes || '').split('\n')[0].trim();
  if (!raw) return '';
  return raw.length > 110 ? `${raw.slice(0, 110).trimEnd()}...` : raw;
}

export function buildEmailHtml(data: { dueTouches: any[]; summary: any }) {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric'
  });

  const top5 = [...data.dueTouches]
    .sort((a, b) => (b.days_overdue || 0) - (a.days_overdue || 0))
    .slice(0, 5);

  const rows = top5.length
    ? top5.map((c) => {
        const days = daysSinceLastTouch(c.last_touch);
        const daysLabel = days === null ? 'No touch on record' : `${days} days since last touch`;
        const context = contextLine(c);
        return `
      <tr>
        <td style="padding:14px 0;border-bottom:1px solid #e8e8e8;">
          <div style="font-size:15px;font-weight:700;color:#111;">${clean(c.first_name)} ${clean(c.last_name)}</div>
          <div style="font-size:13px;color:#555;padding-top:2px;">${clean(c.company)} &middot; Tier ${clean(c.tier)}</div>
          <div style="font-size:13px;color:#b03a2e;padding-top:2px;">${daysLabel}</div>
          ${context ? `<div style="font-size:13px;color:#777;font-style:italic;padding-top:4px;">${clean(context)}</div>` : ''}
        </td>
      </tr>`;
      }).join('')
    : `
      <tr>
        <td style="padding:14px 0;font-size:14px;color:#777;">No contacts due today. Nice work.</td>
      </tr>`;

  const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://focused-outreach.vercel.app';
  const draftsReady = data.summary?.draftsCreated ?? 0;
  const totalDue = data.dueTouches.length;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f4f4f4;">
  <div style="max-width:480px;margin:0 auto;padding:20px 16px;font-family:Arial,Helvetica,sans-serif;">

    <div style="background:#001839;border-radius:10px;padding:18px 20px;">
      <div style="color:#ffffff;font-size:17px;font-weight:700;">Focus Studio Pipeline</div>
      <div style="color:#a3d0f0;font-size:13px;padding-top:2px;">${today}</div>
    </div>

    <div style="background:#ffffff;border-radius:10px;padding:18px 20px;margin-top:12px;">
      <div style="font-size:14px;color:#333;">
        ${draftsReady} new drafts ready for review. ${totalDue} contacts due for a touch.
      </div>
    </div>

    <div style="background:#ffffff;border-radius:10px;padding:18px 20px;margin-top:12px;">
      <div style="font-size:13px;font-weight:700;color:#001839;text-transform:uppercase;letter-spacing:0.5px;">
        Top 5 to reach today
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;">
        ${rows}
      </table>
    </div>

    <a href="${dashboardUrl}"
       style="display:block;background:#001839;color:#ffffff;text-decoration:none;text-align:center;font-size:15px;font-weight:700;padding:14px 0;border-radius:10px;margin-top:16px;">
      Open Dashboard
    </a>

    <div style="text-align:center;font-size:11px;color:#999;padding:16px 0 8px;">
      Nothing has been sent. All drafts require your approval.
    </div>

  </div>
</body>
</html>`;
}

export async function sendMorningDigest(data: {
  signals: any[];
  watchlist: any[];
  drafts: any[];
  dueTouches: any[];
  summary: any;
}) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const totalDue = data.dueTouches.length;

  try {
    await transporter.sendMail({
      from: `"Focus Studio Pipeline" <${process.env.GMAIL_USER}>`,
      to: process.env.DIGEST_EMAIL || 'george.chicolo@focus.us',
      subject: `Pipeline · ${today} · ${data.summary?.draftsCreated ?? 0} drafts · ${totalDue} due`,
      html: buildEmailHtml({ dueTouches: data.dueTouches, summary: data.summary })
    });

    console.log('[Digest] Morning digest sent');
  } catch (err: any) {
    console.error('[Digest] Email failed:', err.message);
  }
}
