-- Phase 5: voice example bank powering the conversational reply generator.
--
-- voice_samples becomes the few-shot ground truth for drafting: approved
-- real messages tagged by mode and channel, retrieved into the system prompt
-- ahead of the rules layer.
--
--   mode:    cre_referral (Mode 1 relationship) | broker_prospecting (2a) |
--            client_prospecting (2b / direct prospect) | internal
--   channel: email | text | linkedin  (existing column, unchanged)
--   source:  where the sample came from: reply_chat | manual | seed
--   contact_name: optional provenance, who the approved message was sent to

alter table public.voice_samples
  add column if not exists mode         text,
  add column if not exists source       text,
  add column if not exists contact_name text;

create index if not exists voice_samples_mode_channel_idx
  on public.voice_samples (mode, channel);
