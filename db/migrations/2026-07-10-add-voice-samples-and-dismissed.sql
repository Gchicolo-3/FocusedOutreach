-- Voice samples (few-shot corpus for the email generator) + manual "not a fit"
-- dismissal flag. APPLIED to the focusedoutreach Supabase project on 2026-07-10.

-- George's real writing, used as few-shot examples so generated messages match
-- his voice. Seeded by pasting real messages and by saving edited drafts.
CREATE TABLE IF NOT EXISTS voice_samples (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel    TEXT,               -- text | email | linkedin | call | null
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS voice_samples_created_at_idx ON voice_samples (created_at DESC);

-- Manual "not a fit" flag. Separate from the AI classifier's `qualified` so a
-- human decision is never overwritten by a re-run. Excludes the contact from
-- the cadence engine, Do This Now, and the default Contacts view.
ALTER TABLE brokers      ADD COLUMN IF NOT EXISTS dismissed BOOLEAN, ADD COLUMN IF NOT EXISTS dismissed_reason TEXT;
ALTER TABLE partners     ADD COLUMN IF NOT EXISTS dismissed BOOLEAN, ADD COLUMN IF NOT EXISTS dismissed_reason TEXT;
ALTER TABLE prospects    ADD COLUMN IF NOT EXISTS dismissed BOOLEAN, ADD COLUMN IF NOT EXISTS dismissed_reason TEXT;
ALTER TABLE cold_brokers ADD COLUMN IF NOT EXISTS dismissed BOOLEAN, ADD COLUMN IF NOT EXISTS dismissed_reason TEXT;
