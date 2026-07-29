-- 2026-07-29 — enable Row Level Security on all app tables
--
-- ⚠️ ORDER MATTERS — do NOT apply until the auth-gated app is deployed and
-- George can sign in (see docs/SECURITY-ROLLOUT.md). Applying this against
-- the pre-auth app blanks every read in the browser.
--
-- What this does:
--   * Enables RLS on the 18 tables that were fully exposed to the anon key.
--   * Adds one policy per table: the authenticated user whose JWT email is
--     George's gets full access. Everyone else — including the public anon
--     key — sees and touches nothing.
--   * Server-side code (engine, API routes, ms/*) uses the service-role key,
--     which bypasses RLS entirely, so it is unaffected.
--   * The touch_log → pg_net Database Webhook fires inside Postgres and is
--     unaffected by RLS.
--
-- Idempotent: policies are dropped and recreated on re-run.
-- Rollback: alter table public.<t> disable row level security; (per table).

do $$
declare
  t text;
begin
  foreach t in array array[
    'prospects', 'brokers', 'partners', 'cold_brokers',
    'activities', 'done_entries', 'snoozed_entries', 'notes',
    'touch_log', 'pinned_entries', 'signals', 'drafts',
    'watchlist', 'agent_runs', 'ms_oauth_tokens', 'email_replies',
    'voice_samples', 'reply_drafts'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists owner_full_access on public.%I', t);
    execute format(
      $p$create policy owner_full_access on public.%I
           for all to authenticated
           using ((auth.jwt() ->> 'email') = 'george.chicolo3@gmail.com')
           with check ((auth.jwt() ->> 'email') = 'george.chicolo3@gmail.com')$p$,
      t
    );
  end loop;
end $$;
