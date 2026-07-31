# Logging completed outreach to n8n

Every completed outreach action now writes a row to the `touch_log` table:

- **Do This Now → "Mark done"** (`components/DoThisNow.tsx`)
- **Drafts tab → "Mark done"** (sent) (`components/Drafts.tsx`) — "Dismiss" (killed) writes nothing
- **Broker Engine / Referral Partners → "Log touch"** and **InlineCompose → "Log activity"** (already did)

Because all four paths land in one table, a single Supabase Database Webhook on
`touch_log` captures every completed action and relays it to n8n through
`/api/events/outreach`, which normalizes the payload and hides the n8n URL
server-side.

```
touch_log INSERT ──▶ Supabase DB Webhook ──▶ POST /api/events/outreach ──▶ n8n
```

## 1. Set the environment variables (Vercel)

| Var | Required | Notes |
|-----|----------|-------|
| `N8N_OUTREACH_WEBHOOK_URL` | yes | The n8n **Production** webhook URL (not the Test URL). |
| `OUTREACH_WEBHOOK_SECRET` | optional | If set, `/api/events/outreach` requires it in the `x-outreach-secret` header. Add the same header on the Supabase webhook below. |

## 2. Create the Supabase Database Webhook

Supabase Dashboard → **Database → Webhooks → Create a new hook** (this uses the
`pg_net` extension — enable it if prompted):

- **Name:** `outreach_completed`
- **Table:** `touch_log`
- **Events:** `INSERT` only
- **Type:** HTTP Request
- **Method:** `POST`
- **URL:** `https://<your-app-domain>/api/events/outreach`
- **HTTP Headers:**
  - `Content-Type: application/json` (usually preset)
  - `x-outreach-secret: <value>` — only if you set `OUTREACH_WEBHOOK_SECRET`

That is the only webhook needed. `touch_log` is insert-only for outreach, so
there is nothing to filter on `old_record`.

## 3. What Supabase sends the route

Supabase posts its standard webhook envelope:

```json
{
  "type": "INSERT",
  "table": "touch_log",
  "schema": "public",
  "record": { "id": 42, "contact_id": "broker-1", "date": "2026-07-16", "channel": "text" },
  "old_record": null
}
```

## 4. What the route forwards to n8n

`/api/events/outreach` normalizes that into a stable, flat event and POSTs it to
`N8N_OUTREACH_WEBHOOK_URL`:

```json
{
  "event": "outreach_completed",
  "source": "touch_log",
  "operation": "INSERT",
  "contact_id": "broker-1",
  "channel": "text",
  "date": "2026-07-16",
  "at": "2026-07-16T19:41:34.724Z",
  "record": { "id": 42, "contact_id": "broker-1", "date": "2026-07-16", "channel": "text" }
}
```

- `event` is always `"outreach_completed"`.
- `contact_id` / `channel` / `date` are lifted from the row for convenience;
  the full row is kept under `record`.
- `at` is when the route processed the event (server time, ISO 8601).

## 5. n8n side

Start the workflow with a **Webhook** node (method `POST`), activate it, and use
the **Production** URL for `N8N_OUTREACH_WEBHOOK_URL`. If you set a secret, add a
Header-Auth credential (or an IF node) that checks `x-outreach-secret`. From
there, append to Google Sheets / Airtable / Slack / a database — the body is
already flat and ready to map.
