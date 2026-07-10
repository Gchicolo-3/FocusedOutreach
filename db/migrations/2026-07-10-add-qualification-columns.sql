-- Qualification gate (Phase 0, docs/AUDIT-AND-REBUILD-PLAN.md 1.1):
-- persona + qualified on both contact tables. All columns nullable so
-- unclassified contacts keep flowing through the cadence until reviewed.
--
-- APPLIED to the focusedoutreach Supabase project on 2026-07-10.

ALTER TABLE brokers
  ADD COLUMN IF NOT EXISTS persona TEXT
    CHECK (persona IN ('tenant_rep','landlord_rep','landlord','property_mgr','end_user','partner','other')),
  ADD COLUMN IF NOT EXISTS qualified BOOLEAN,
  ADD COLUMN IF NOT EXISTS qualification_confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS qualification_reason TEXT,
  ADD COLUMN IF NOT EXISTS classified_at TIMESTAMPTZ;

ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS persona TEXT
    CHECK (persona IN ('tenant_rep','landlord_rep','landlord','property_mgr','end_user','partner','other')),
  ADD COLUMN IF NOT EXISTS qualified BOOLEAN,
  ADD COLUMN IF NOT EXISTS qualification_confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS qualification_reason TEXT,
  ADD COLUMN IF NOT EXISTS classified_at TIMESTAMPTZ;
