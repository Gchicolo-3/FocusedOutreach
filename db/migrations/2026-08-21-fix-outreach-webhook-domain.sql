-- The touch_log -> /api/events/outreach relay trigger pointed at
-- focusedoutreach.vercel.app (no hyphen), which is not this app. Production
-- is focused-outreach.vercel.app, so the relay never reached the route.
-- APPLIED to the focusedoutreach Supabase project on 2026-08-21.

create or replace function public.notify_outreach_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform net.http_post(
    url := 'https://focused-outreach.vercel.app/api/events/outreach',
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
