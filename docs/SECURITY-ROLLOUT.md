# Security rollout: auth + RLS

Until this rollout, all 18 app tables had RLS disabled — anyone with the
public anon key (shipped to every browser) could read and write every row.
The fix has three parts, and the **order matters** because enabling RLS
before the app has auth would blank the deployed dashboard.

## What changed in the code

- `components/AuthGate.tsx` — both pages now render behind a Supabase Auth
  sign-in (email + password). Sessions persist per device.
- `lib/serverSupabase.ts` — single server-side client. In production it
  **requires** `SUPABASE_SERVICE_ROLE_KEY` (which bypasses RLS) instead of
  silently falling back to the anon key, which under RLS would read zero rows
  without erroring. All API routes, the engine, and `lib/ms/*` use it.
- `db/migrations/2026-07-29-enable-rls.sql` — enables RLS on the 18 tables
  with a single policy each: full access for the authenticated user whose
  email is George's; nothing for anyone else.

Unaffected by RLS (verified):

- The engine cron → API routes (they authenticate with `CRON_SECRET` and use
  the service-role key).
- The `touch_log` → n8n pipeline (a Database Webhook via pg_net runs inside
  Postgres, then posts to `/api/events/outreach`; n8n never talks to the
  database directly).

## Rollout order

1. **Verify env** — Vercel → Project Settings → Environment Variables must
   have `SUPABASE_SERVICE_ROLE_KEY` (Production). Without it the deploy's
   API routes fail loudly by design.
2. **Apply the bucket migration** if not already applied
   (`db/migrations/2026-07-29-add-bucket-and-enterprise.sql`).
3. **Merge + deploy** this branch.
4. **Create the login user** — Supabase Dashboard → Authentication → Users →
   Add user → email `george.chicolo3@gmail.com`, set a password, check
   "Auto Confirm User". (No in-app sign-up exists, on purpose.)
5. **Sign in** at the app and confirm data loads and edits save.
6. **Apply the RLS migration** (`db/migrations/2026-07-29-enable-rls.sql`).
7. **Verify the lockdown**:
   - The app still works while signed in; sign out → login screen.
   - An anon REST call returns an empty array:
     `curl "https://kcaokmimfcletglkwxjq.supabase.co/rest/v1/brokers?select=id&limit=1" -H "apikey: <anon key>"` → `[]`
   - Run the engine once (Run Engine Now) and check it still finds contacts.
   - Log a touch and confirm the n8n event still arrives.

## Rollback

Per table: `alter table public.<table> disable row level security;` —
policies can stay in place; they only take effect while RLS is enabled.
