-- Phase 4 of the data-layer fix: audit coverage for engine drafts.
--
-- The reply generator's audit pass (reply_drafts.audit_*) never covered the
-- engine's drafts table, so 611 of 697 pending check_in drafts shipped to
-- review with no audit at all. Same column semantics as reply_drafts:
--   audit_passed  true  = clean or every issue auto-corrected
--                 false = an issue survived (e.g. banned phrase after fixes)
--                 null  = not audited yet / editor pass failed
--   audit_findings plain-text summary shown in the Drafts review UI
--   audited_at     when the audit ran (null = never; the backfill's cursor)
--   pre_audit_body original body when the audit auto-corrected it

alter table public.drafts
  add column if not exists audit_passed   boolean,
  add column if not exists audit_findings text,
  add column if not exists audited_at     timestamptz,
  add column if not exists pre_audit_body text;

create index if not exists drafts_unaudited_idx
  on public.drafts (status, audited_at)
  where audited_at is null;
