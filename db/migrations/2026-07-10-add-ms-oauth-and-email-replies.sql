-- Microsoft Graph integration tables (Outlook draft + reply polling).
-- APPLIED to the focusedoutreach Supabase project on 2026-07-10.

-- Microsoft Graph OAuth token store (single connected account: George's
-- Focus Studio mailbox). One row, id = 'default'. Tokens are write-only
-- secrets; access is server-side via the service-role key only.
CREATE TABLE IF NOT EXISTS ms_oauth_tokens (
  id            TEXT PRIMARY KEY DEFAULT 'default',
  access_token  TEXT NOT NULL,
  refresh_token TEXT,
  expires_at    TIMESTAMPTZ NOT NULL,
  account_email TEXT,
  scope         TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dedupe + cursor for the inbox reply poll. One row per processed inbound
-- message so a reply is logged to activities at most once.
CREATE TABLE IF NOT EXISTS email_replies (
  message_id    TEXT PRIMARY KEY,       -- Graph internetMessageId
  contact_key   TEXT,                   -- normalized contact name, when matched
  contact_id    TEXT,
  contact_table TEXT,
  from_email    TEXT,
  subject       TEXT,
  received_at   TIMESTAMPTZ,
  logged        BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_replies_received_at_idx ON email_replies (received_at DESC);
