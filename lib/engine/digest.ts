// lib/engine/digest.ts
// Compiles morning digest and emails George
// Sends to george.chicolo@focus.us via Gmail SMTP

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

const SIGNAL_LABEL: Record<string, string> = {
  funding_round: '💰 Funding Round',
  executive_hire: '👤 Executive Hire',
  expansion_announcement: '📈 Expansion',
  broker_deal_announced: '🤝 Deal Announced',
  broker_promotion: '⬆️ Broker Promoted',
  broker_firm_move: '🔄 Broker Moved Firms',
  broker_award: '🏆 Broker Award',
  acquisition: '🏢 Acquisition',
  other: '📰 Signal'
};

const TIER_BADGE: Record<string, string> = {
  '1': '🔴 Act Now',
  '2': '🟡 Watch',
  '3': '🟢 Broker Touch'
};

function buildEmailHtml(data: {
  signals: any[];
  watchlist: any[];
  drafts: any[];
  dueTouches: any[];
  summary: any;
}) {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });

  const signalsHtml = data.signals.length
    ? data.signals.map(s => `
      <div style="border-left:3px solid #00489C;padding:8px 12px;margin-bottom:10px;background:#f8f9ff;">
        <strong>${TIER_BADGE[s.tier_recommendation] || ''} — ${SIGNAL_LABEL[s.signal_type] || 'Signal'}</strong><br>
        <span style="font-size:14px;font-weight:600;">${s.company_name || 'Unknown'}</span><br>
        <span style="font-size:13px;color:#444;">${s.summary}</span>
        ${s.source_url ? `<br><a href="${s.source_url}" style="font-size:12px;color:#00489C;">Source →</a>` : ''}
      </div>`).join('')
    : '<p style="color:#888;font-size:13px;">No new signals today.</p>';

  const draftsHtml = data.drafts.length
    ? data.drafts.map((d, i) => `
      <div style="border:1px solid #ddd;border-radius:6px;padding:14px;margin-bottom:14px;">
        <div style="font-size:12px;color:#888;margin-bottom:4px;">${d.channel?.toUpperCase()} · ${d.draft_type?.replace('_', ' ')} · ${d.contact_name || d.contact_company || 'Unknown'}</div>
        ${d.subject ? `<div style="font-weight:600;margin-bottom:8px;">Subject: ${d.subject}</div>` : ''}
        <div style="background:#f5f5f5;padding:10px;border-radius:4px;font-size:13px;white-space:pre-wrap;font-family:Georgia,serif;">${d.body}</div>
        ${d.signal_summary ? `<div style="font-size:11px;color:#999;margin-top:6px;">Triggered by: ${d.signal_summary}</div>` : ''}
      </div>`).join('')
    : '<p style="color:#888;font-size:13px;">No drafts today.</p>';

  const touchesHtml = data.dueTouches.length
    ? data.dueTouches.map(c => `
      <div style="padding:6px 0;border-bottom:1px solid #eee;font-size:13px;">
        <strong>${c.first_name} ${c.last_name}</strong> · ${c.company} · Tier ${c.tier}
        <span style="color:#888;"> · Last touch: ${c.last_touch || 'Never'} · ${c.days_overdue}d overdue</span>
      </div>`).join('')
    : '<p style="color:#888;font-size:13px;">No contacts due today.</p>';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:660px;margin:0 auto;padding:24px;">

  <div style="background:#001839;padding:16px 20px;border-radius:6px;margin-bottom:20px;">
    <div style="color:white;font-size:18px;font-weight:700;">Focus Studio Pipeline</div>
    <div style="color:#A3D0F0;font-size:13px;">${today}</div>
  </div>

  <div style="background:#f0f4ff;padding:12px 16px;border-radius:6px;margin-bottom:24px;">
    <span style="background:#001839;color:white;padding:3px 10px;border-radius:12px;font-size:12px;margin-right:8px;">${data.summary.signalsFound} signals</span>
    <span style="background:#00489C;color:white;padding:3px 10px;border-radius:12px;font-size:12px;margin-right:8px;">${data.drafts.length} drafts ready</span>
    <span style="background:#555;color:white;padding:3px 10px;border-radius:12px;font-size:12px;">${data.dueTouches.length} contacts due</span>
  </div>

  <h2 style="color:#001839;font-size:15px;border-bottom:2px solid #001839;padding-bottom:6px;">New Signals</h2>
  ${signalsHtml}

  <h2 style="color:#001839;font-size:15px;border-bottom:2px solid #001839;padding-bottom:6px;margin-top:24px;">Drafts Ready for Review</h2>
  <p style="font-size:12px;color:#888;margin-top:-8px;">Nothing sends until you approve it in the dashboard.</p>
  ${draftsHtml}

  <h2 style="color:#001839;font-size:15px;border-bottom:2px solid #001839;padding-bottom:6px;margin-top:24px;">Contacts Due for a Touch</h2>
  ${touchesHtml}

  <div style="margin-top:32px;padding-top:12px;border-top:1px solid #ddd;font-size:12px;color:#888;">
    Focus Studio Pipeline Engine · george.chicolo@focus.us<br>
    Nothing has been sent. All drafts require your approval.<br>
    <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://focused-outreach.vercel.app'}" style="color:#00489C;">Open Dashboard →</a>
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
  const totalDrafts = data.drafts.length;
  const totalDue = data.dueTouches.length;

  try {
    await transporter.sendMail({
      from: `"Focus Studio Pipeline" <${process.env.GMAIL_USER}>`,
      to: process.env.DIGEST_EMAIL || 'george.chicolo@focus.us',
      subject: `Pipeline · ${today} · ${totalDrafts} drafts · ${totalDue} due`,
      html: buildEmailHtml(data)
    });

    console.log('[Digest] Morning digest sent');
  } catch (err: any) {
    console.error('[Digest] Email failed:', err.message);
  }
}
