-- Item 2b (Aug 2026 brief): RLS on every previously-open public table, with
-- policies applied in the same transaction so the dashboard never goes dark.
-- APPLIED to the focusedoutreach Supabase project on 2026-08-20.
--
-- Access model: the browser talks to Supabase with the anon key (no Supabase
-- Auth user exists — George chose Vercel deployment protection as the HTTP
-- layer gate, Item 2a). Two classes of table:
--
--   1. App tables the browser reads/writes: explicit allow policy for anon.
--      Functionally the access they had with RLS off, but now an explicit,
--      revocable grant. If Supabase Auth ever lands, flip "to anon,
--      authenticated" to "to authenticated" per table and the bundled key
--      goes dead without any other change.
--
--   2. Server-only tables (browser never touches them): RLS enabled with NO
--      anon policy. The service role bypasses RLS so the engine and API
--      routes keep working, while the browser-bundled anon key can no longer
--      read OAuth tokens (ms_oauth_tokens), ingested mail (email_replies),
--      run logs (agent_runs), the watchlist, or reply history (reply_drafts).
--      This is the real hardening available today.
--
-- The personal-OS tables (brain_dumps, calendar_events, daily_briefs,
-- family_plans, habit_log, habits, open_loops, os_profile) already had RLS
-- enabled and are untouched here.

-- ---- 1. App tables: RLS on + explicit anon allow ---------------------------

alter table public.brokers          enable row level security;
alter table public.partners         enable row level security;
alter table public.prospects        enable row level security;
alter table public.cold_brokers     enable row level security;
alter table public.activities       enable row level security;
alter table public.touch_log        enable row level security;
alter table public.drafts           enable row level security;
alter table public.signals          enable row level security;
alter table public.notes            enable row level security;
alter table public.done_entries     enable row level security;
alter table public.snoozed_entries  enable row level security;
alter table public.pinned_entries   enable row level security;
alter table public.voice_samples    enable row level security;
alter table public.app_settings     enable row level security;

create policy app_rw on public.brokers          for all to anon, authenticated using (true) with check (true);
create policy app_rw on public.partners         for all to anon, authenticated using (true) with check (true);
create policy app_rw on public.prospects        for all to anon, authenticated using (true) with check (true);
create policy app_rw on public.cold_brokers     for all to anon, authenticated using (true) with check (true);
create policy app_rw on public.activities       for all to anon, authenticated using (true) with check (true);
create policy app_rw on public.touch_log        for all to anon, authenticated using (true) with check (true);
create policy app_rw on public.drafts           for all to anon, authenticated using (true) with check (true);
create policy app_rw on public.signals          for all to anon, authenticated using (true) with check (true);
create policy app_rw on public.notes            for all to anon, authenticated using (true) with check (true);
create policy app_rw on public.done_entries     for all to anon, authenticated using (true) with check (true);
create policy app_rw on public.snoozed_entries  for all to anon, authenticated using (true) with check (true);
create policy app_rw on public.pinned_entries   for all to anon, authenticated using (true) with check (true);
create policy app_rw on public.voice_samples    for all to anon, authenticated using (true) with check (true);
create policy app_rw on public.app_settings     for all to anon, authenticated using (true) with check (true);

-- ---- 2. Server-only tables: RLS on, no anon policy (service role only) -----

alter table public.ms_oauth_tokens  enable row level security;
alter table public.email_replies    enable row level security;
alter table public.agent_runs       enable row level security;
alter table public.watchlist        enable row level security;
alter table public.reply_drafts     enable row level security;
