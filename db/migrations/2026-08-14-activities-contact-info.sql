-- Phase 2 of the data-layer fix: Salesforce CSV import that enriches.
--
-- The activity exports carry contact info (Email / Mobile) that the old
-- import dropped on the floor because activities had nowhere to put it.
-- Store it on the activity row itself so nothing is lost even when the row
-- can't be confidently resolved to a contact — the import-review UI uses
-- these columns to enrich whichever contact the row is later linked to.

alter table activities add column if not exists email  text;
alter table activities add column if not exists mobile text;
