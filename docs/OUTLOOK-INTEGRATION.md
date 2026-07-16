# Outlook / Microsoft Graph Integration

Replaces the old `mailto:` "Open in Email" flow with real Outlook drafts, and
adds automatic capture of inbound replies into the `activities` table. Both
run on George's own Focus Studio mailbox via the Microsoft Graph API.

## What it does

- **Open in Email** → `POST /api/outlook/draft` creates a draft in George's
  mailbox (`POST /me/messages`) and opens it in Outlook on the web, pre-filled
  with recipient, subject, and body. The draft also appears in his Drafts
  folder. If no Microsoft account is connected, the button falls back to the
  old `mailto:` behavior automatically.
- **Reply capture** → an hourly weekday cron (`/api/outlook/poll-replies`)
  reads the inbox, matches each sender against brokers/partners by email, and
  logs matched replies to `activities` (type `Email Reply`), deduped by
  message id so nothing is logged twice.

## One-time Azure app registration

1. Azure Portal → **Microsoft Entra ID** → **App registrations** → **New
   registration**.
   - Name: e.g. `Focus Studio Outreach`.
   - Supported account types: single tenant is fine if the mailbox is on the
     Focus Studio tenant; otherwise "Accounts in any organizational directory".
   - Redirect URI (Web): `https://<your-app-domain>/api/outlook/callback`
     (must byte-match `MS_REDIRECT_URI` / the deployed domain).
2. **Certificates & secrets** → **New client secret** → copy the value (shown
   once) → this is `MS_CLIENT_SECRET`.
3. **Overview** → copy **Application (client) ID** → `MS_CLIENT_ID`, and the
   **Directory (tenant) ID** → `MS_TENANT_ID` (or leave `common`).
4. **API permissions** → **Add a permission** → **Microsoft Graph** →
   **Delegated permissions** → add: `offline_access`, `openid`, `email`,
   `User.Read`, `Mail.ReadWrite`, `Mail.Read`. Grant admin consent if your
   tenant requires it.

## Environment variables (Vercel)

| Var | Required | Notes |
|-----|----------|-------|
| `MS_CLIENT_ID` | yes | Azure Application (client) ID |
| `MS_CLIENT_SECRET` | yes | Azure client secret value |
| `MS_TENANT_ID` | no | Tenant ID; defaults to `common` |
| `MS_REDIRECT_URI` | no | Defaults to `https://<request-host>/api/outlook/callback`; set explicitly if the auto-derived host differs from what's registered in Azure |
| `MS_OAUTH_STATE_SECRET` | no | Secret for signing the OAuth CSRF `state`; falls back to `CRON_SECRET` |
| `SUPABASE_SERVICE_ROLE_KEY` | recommended | Used server-side to store tokens and log replies; falls back to the anon key |

`CRON_SECRET` (already used by the engine) also gates `/api/outlook/poll-replies`.

## Connect the mailbox (one time)

After deploying with the env vars set, George visits:

```
https://<your-app-domain>/api/outlook/connect
```

He signs in and consents; the callback stores the tokens (with a refresh
token, so it stays connected). Confirm with:

```
GET /api/outlook/status   →   {"connected": true, "account": "george.chicolo@focus.us"}
```

From then on, "Open in Email" creates Outlook drafts and the reply poll runs
on schedule. Tokens auto-refresh; no further action needed unless consent is
revoked.

## Data model

- `ms_oauth_tokens` — single connected account (id `default`). Server-only.
- `email_replies` — one row per processed inbound message (dedupe + audit).

Both created by `db/migrations/2026-07-10-add-ms-oauth-and-email-replies.sql`
(already applied to the live project).

## Notes

- Reply matching is by exact sender email against brokers/partners that have
  an email on file. A contact replying from a different address won't match;
  add that address to the contact to capture it.
- The poll reads the 50 most recent inbox messages per run; at hourly cadence
  that comfortably covers George's inbound volume. Increase `$top` in
  `lib/ms/replies.ts` if needed.
