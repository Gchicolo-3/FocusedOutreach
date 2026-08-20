-- Shared outreach caps (Amendment 1 to the Aug 2026 brief). Runtime settings,
-- editable from the UI without a deploy. Single source of truth for BOTH the
-- warm cadence cap and the cold pipeline cap, so a max cold day and a max
-- warm day can never combine past daily_total: warm yields when cold runs.
-- George's stated capacity: 20 touches/day total, 5-10 of them cold, warm
-- capped at 12.
-- APPLIED to the focusedoutreach Supabase project on 2026-08-20.

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value) values
  ('outreach_caps', '{"daily_total": 20, "warm_daily": 12, "cold_daily": 8}'::jsonb)
on conflict (key) do nothing;
