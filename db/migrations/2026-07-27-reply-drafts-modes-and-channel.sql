-- Reply Generator v2: split "prospecting" into broker vs prospective client
-- modes, and add a channel (email / text / linkedin connect / linkedin
-- message) now that the tool drafts more than email replies.
-- APPLIED to the focusedoutreach Supabase project on 2026-07-27.

alter table public.reply_drafts drop constraint reply_drafts_mode_check;

update public.reply_drafts set mode = 'broker_prospecting' where mode = 'prospecting';

alter table public.reply_drafts add constraint reply_drafts_mode_check
  check (mode = ANY (ARRAY['cre_referral'::text, 'broker_prospecting'::text, 'client_prospecting'::text, 'internal'::text]));

alter table public.reply_drafts add column channel text not null default 'email'
  check (channel = ANY (ARRAY['email'::text, 'text'::text, 'linkedin_connect'::text, 'linkedin_message'::text]));
