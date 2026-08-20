-- Canonical contact identity (Phase 1 of the data-layer fix).
--
-- Every contact row gets a deterministic canonical_key derived from
-- normalized name + company (see lib/identity.ts — the single source of the
-- key algorithm; it is computed in app code, not in SQL, so the slug rules
-- live in one place).
--
-- activities rows get resolution columns linking each row to the contact it
-- belongs to:
--   contact_table / contact_id  -> the resolved contact record
--   match_status                -> matched | ambiguous | new | junk
--   match_method                -> email | name_company | name_unique |
--                                  last_name_company | logged | manual | ...
--   match_confidence            -> 0..1
--   match_candidates            -> jsonb [{table,id,name,company}] when ambiguous
--
-- Backfill: scripts/backfill-contact-identity.ts (idempotent, re-runnable).

alter table brokers      add column if not exists canonical_key text;
alter table partners     add column if not exists canonical_key text;
alter table prospects    add column if not exists canonical_key text;
alter table cold_brokers add column if not exists canonical_key text;

create index if not exists brokers_canonical_key_idx      on brokers (canonical_key);
create index if not exists partners_canonical_key_idx     on partners (canonical_key);
create index if not exists prospects_canonical_key_idx    on prospects (canonical_key);
create index if not exists cold_brokers_canonical_key_idx on cold_brokers (canonical_key);

alter table activities add column if not exists canonical_key    text;
alter table activities add column if not exists contact_table    text;
alter table activities add column if not exists contact_id       text;
alter table activities add column if not exists match_status     text;
alter table activities add column if not exists match_method     text;
alter table activities add column if not exists match_confidence numeric;
alter table activities add column if not exists match_candidates jsonb;

create index if not exists activities_canonical_key_idx on activities (canonical_key);
create index if not exists activities_contact_idx       on activities (contact_table, contact_id);
create index if not exists activities_match_status_idx  on activities (match_status);
