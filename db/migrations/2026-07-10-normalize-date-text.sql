-- Normalize mixed-format TEXT dates on brokers/partners to ISO (YYYY-MM-DD).
-- Fixes B4 from docs/AUDIT-AND-REBUILD-PLAN.md: next_due/last_touch hold both
-- "2026-06-16" and "6/23/2026"; string comparisons on M/D/YYYY values are
-- meaningless, so those contacts were invisible to (or permanently stuck in)
-- the cadence. The engine now parses both formats defensively, but the data
-- should still be normalized. Dates are US-style M/D/YYYY.
--
-- Columns intentionally stay TEXT for now: the CSV import path still writes
-- text; converting the column type to DATE is a follow-up once all writers
-- produce ISO.
--
-- Idempotent: the WHERE regex only matches slash-format values.
--
-- APPLIED to the focusedoutreach Supabase project on 2026-07-10: next_due was
-- already all-ISO on both tables; last_touch converted on 457 broker rows and
-- 176 partner rows (all 633 slash values validated as M/D/YYYY first).

UPDATE brokers
SET next_due = to_char(to_date(next_due, 'FMMM/FMDD/YYYY'), 'YYYY-MM-DD')
WHERE next_due ~ '^\d{1,2}/\d{1,2}/\d{4}$';

UPDATE brokers
SET last_touch = to_char(to_date(last_touch, 'FMMM/FMDD/YYYY'), 'YYYY-MM-DD')
WHERE last_touch ~ '^\d{1,2}/\d{1,2}/\d{4}$';

UPDATE partners
SET next_due = to_char(to_date(next_due, 'FMMM/FMDD/YYYY'), 'YYYY-MM-DD')
WHERE next_due ~ '^\d{1,2}/\d{1,2}/\d{4}$';

UPDATE partners
SET last_touch = to_char(to_date(last_touch, 'FMMM/FMDD/YYYY'), 'YYYY-MM-DD')
WHERE last_touch ~ '^\d{1,2}/\d{1,2}/\d{4}$';
