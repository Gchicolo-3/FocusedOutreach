-- 2026-07-29 — audit columns on reply_drafts (audit/enforcement pass spec)
--
-- Additive only. audit_passed: true = no issues or all auto-corrected,
-- false = an issue survived (e.g. banned phrase after retries), null =
-- audited before this feature / editor pass failed to run.
-- audit_findings: the plain-text summary shown in the UI, null when nothing
-- was flagged. Persistent record for a future voice.md refinement pass.

alter table public.reply_drafts
  add column if not exists audit_passed boolean,
  add column if not exists audit_findings text;
