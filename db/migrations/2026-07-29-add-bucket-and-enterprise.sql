-- 2026-07-29 — bucket field + enterprise flag rollout
--
-- Additive only: no drops, no renames, no data rewrites, no ON CONFLICT /
-- upsert logic anywhere. Existing rows are backfilled to bucket='active'
-- purely via the column DEFAULT (Postgres fills the default for existing
-- rows on ADD COLUMN without rewriting or touching row data), so nothing
-- can be duplicated or overwritten.
--
-- bucket drives every tab in the single-screen UI:
--   active             -> Brokers / Potential Projects / Referral Partners tabs
--   cold               -> Cold Brokers tab (alongside the cold_brokers table)
--   not_worth_pursuing -> Not Worth Pursuing tab (combined across tables)
--   blast_only         -> Blast Only tab (Salesforce D-tier logic; no cadence)
--
-- Safe to re-run: every statement is guarded with IF NOT EXISTS.

alter table public.brokers   add column if not exists bucket text not null default 'active';
alter table public.partners  add column if not exists bucket text not null default 'active';
alter table public.prospects add column if not exists bucket text not null default 'active';

-- Separates standard prospects from $200k+ end-user targets without a
-- separate table.
alter table public.prospects add column if not exists is_enterprise boolean not null default false;

-- Guard rails on allowed bucket values. All existing rows are 'active' via
-- the default, so these validate instantly on tables this size.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'brokers_bucket_check') then
    alter table public.brokers add constraint brokers_bucket_check
      check (bucket in ('active', 'cold', 'not_worth_pursuing', 'blast_only'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'partners_bucket_check') then
    alter table public.partners add constraint partners_bucket_check
      check (bucket in ('active', 'cold', 'not_worth_pursuing', 'blast_only'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'prospects_bucket_check') then
    alter table public.prospects add constraint prospects_bucket_check
      check (bucket in ('active', 'cold', 'not_worth_pursuing', 'blast_only'));
  end if;
end $$;
