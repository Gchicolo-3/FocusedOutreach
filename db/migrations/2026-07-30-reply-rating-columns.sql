-- 2026-07-30 — feedback loop rating columns on reply_drafts
--
-- Additive only, both nullable: rating is opt-in, most rows never get one.
-- rating: 'good' | 'bad' (CHECK passes NULL through). rating_note: optional
-- "what was off" text captured on thumbs down. Manual review aid — nothing
-- automated reads these.

alter table public.reply_drafts
  add column if not exists rating text,
  add column if not exists rating_note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reply_drafts_rating_check') then
    alter table public.reply_drafts add constraint reply_drafts_rating_check
      check (rating = any (array['good'::text, 'bad'::text]));
  end if;
end $$;
