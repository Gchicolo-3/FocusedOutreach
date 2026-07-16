// lib/ms/replies.ts
// Polls George's Outlook inbox via Microsoft Graph, matches inbound mail to
// known CRM contacts (brokers/partners) by sender email, and logs each new
// reply to the `activities` table. A reply is logged at most once, tracked in
// `email_replies` by the message's globally-unique internetMessageId.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { graphFetch, NotConnectedError } from './graph';

// Same key derivation as parseCSV.normalizeContactKey / storage.logActivity, so
// a reply merges into the contact's existing `activities` row.
export function contactKey(name: string): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export type ContactRef = {
  contactId: string;
  table: 'brokers' | 'partners';
  fullName: string;
  company: string;
};

// email (lowercased) -> contact. Brokers win ties over partners (arbitrary but
// deterministic); the same person rarely sits in both tables.
export function buildContactIndex(
  brokers: Array<{ id: string; first_name?: string; last_name?: string; firm?: string; email?: string | null }>,
  partners: Array<{ id: string; first_name?: string; last_name?: string; company?: string; email?: string | null }>
): Map<string, ContactRef> {
  const index = new Map<string, ContactRef>();
  for (const p of partners) {
    const email = (p.email || '').trim().toLowerCase();
    if (!email) continue;
    index.set(email, {
      contactId: p.id,
      table: 'partners',
      fullName: `${p.first_name || ''} ${p.last_name || ''}`.trim(),
      company: p.company || '',
    });
  }
  for (const b of brokers) {
    const email = (b.email || '').trim().toLowerCase();
    if (!email) continue;
    index.set(email, {
      contactId: b.id,
      table: 'brokers',
      fullName: `${b.first_name || ''} ${b.last_name || ''}`.trim(),
      company: b.firm || '',
    });
  }
  return index;
}

export type GraphMessage = {
  id: string;
  internetMessageId?: string;
  subject?: string;
  receivedDateTime?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
};

export function senderEmail(msg: GraphMessage): string {
  return (msg.from?.emailAddress?.address || '').trim().toLowerCase();
}

function db(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export type PollResult = {
  connected: boolean;
  scanned: number;
  matched: number;
  logged: number;
  errors: string[];
};

const INBOX_PATH =
  '/me/mailFolders/inbox/messages?$top=50&$select=id,internetMessageId,subject,from,receivedDateTime&$orderby=receivedDateTime desc';

export async function pollReplies(): Promise<PollResult> {
  const result: PollResult = { connected: true, scanned: 0, matched: 0, logged: 0, errors: [] };

  let messages: GraphMessage[];
  try {
    const res = await graphFetch(INBOX_PATH);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      result.errors.push(`graph inbox ${res.status}: ${data?.error?.message || ''}`);
      return result;
    }
    const data = await res.json();
    messages = data.value || [];
  } catch (err) {
    if (err instanceof NotConnectedError) {
      return { ...result, connected: false };
    }
    result.errors.push(err instanceof Error ? err.message : 'inbox fetch failed');
    return result;
  }

  result.scanned = messages.length;
  if (!messages.length) return result;

  const supabase = db();

  // Contact index (brokers + partners with an email on file).
  const [{ data: brokers }, { data: partners }] = await Promise.all([
    supabase.from('brokers').select('id, first_name, last_name, firm, email').not('email', 'is', null),
    supabase.from('partners').select('id, first_name, last_name, company, email').not('email', 'is', null),
  ]);
  const index = buildContactIndex(brokers || [], partners || []);

  // Already-processed messages, so we log each reply once.
  const ids = messages.map((m) => m.internetMessageId || m.id).filter(Boolean);
  const { data: seenRows } = await supabase
    .from('email_replies')
    .select('message_id')
    .in('message_id', ids);
  const seen = new Set((seenRows || []).map((r) => r.message_id));

  for (const msg of messages) {
    const messageId = msg.internetMessageId || msg.id;
    if (!messageId || seen.has(messageId)) continue;

    const from = senderEmail(msg);
    const contact = index.get(from);
    if (!contact) continue; // inbound mail from a non-CRM sender: ignore
    result.matched++;

    const receivedIso = msg.receivedDateTime || new Date().toISOString();
    const dateOnly = receivedIso.slice(0, 10);
    const key = contactKey(contact.fullName);

    try {
      // Merge into the contact's activities row (same shape as logActivity).
      if (key) {
        const { data: existing } = await supabase
          .from('activities')
          .select('comments, priority')
          .eq('contact_key', key)
          .maybeSingle();
        const note = `Replied: ${(msg.subject || '(no subject)').slice(0, 120)}`;
        const mergedComments = [existing?.comments, note].filter(Boolean).join(' | ');

        const { error: actErr } = await supabase.from('activities').upsert({
          contact_key: key,
          full_name: contact.fullName,
          company: contact.company,
          subject: msg.subject || 'Reply',
          activity_type: 'Email Reply',
          date: dateOnly,
          status: 'reply',
          priority: existing?.priority || '',
          comments: mergedComments,
        });
        if (actErr) throw new Error(actErr.message);
      }

      // Record the message so it's never logged twice.
      const { error: dedupeErr } = await supabase.from('email_replies').insert({
        message_id: messageId,
        contact_key: key || null,
        contact_id: contact.contactId,
        contact_table: contact.table,
        from_email: from,
        subject: msg.subject || null,
        received_at: receivedIso,
        logged: true,
      });
      if (dedupeErr) throw new Error(dedupeErr.message);

      seen.add(messageId);
      result.logged++;
    } catch (err) {
      result.errors.push(`${messageId}: ${err instanceof Error ? err.message : 'log failed'}`);
    }
  }

  return result;
}
