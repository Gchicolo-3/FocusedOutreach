-- Reply Generator (/reply page). Ad hoc paste-any-email-and-reply drafts,
-- deliberately not linked to brokers/partners/prospects: the tool works on any
-- pasted email whether or not the sender is in the CRM. Separate from `drafts`,
-- which is structured around the signals -> drafts pipeline.
-- APPLIED to the focusedoutreach Supabase project on 2026-07-27.

create table public.reply_drafts (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode = ANY (ARRAY['cre_referral'::text, 'prospecting'::text, 'internal'::text])),
  incoming_email text not null,
  thread_context text,
  generated_reply text not null,
  edited_reply text,
  created_at timestamp with time zone default now()
);

create index if not exists reply_drafts_created_at_idx on public.reply_drafts (created_at desc);
