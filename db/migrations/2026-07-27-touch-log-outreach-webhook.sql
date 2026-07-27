-- Relay completed outreach (touch_log inserts) to the app's n8n forwarder at
-- /api/events/outreach (see docs/N8N-OUTREACH-EVENTS.md). Implemented as a
-- pg_net trigger instead of a dashboard-created Database Webhook so it lives
-- in migrations. The route still requires N8N_OUTREACH_WEBHOOK_URL in Vercel
-- to forward anywhere.
-- APPLIED to the focusedoutreach Supabase project on 2026-07-27.

create extension if not exists pg_net;

create or replace function public.notify_outreach_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform net.http_post(
    url := 'https://focusedoutreach.vercel.app/api/events/outreach',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'touch_log',
      'schema', 'public',
      'record', to_jsonb(new),
      'old_record', null
    )
  );
  return new;
end;
$$;

create trigger outreach_completed
after insert on public.touch_log
for each row execute function public.notify_outreach_completed();
