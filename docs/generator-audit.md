# Reply Generator Audit

Audit of the Reply Generator (`/reply`) in the Focus Studio Prospecting OS. Read-only review; no code was changed. All line numbers refer to the current state of branch `claude/focus-studio-generator-audit-ov0yzv` (forked from `main` at the time of the audit).

---

## 1. Files involved in the reply generator

Core (the generator does not work without these):

| File | Role |
|---|---|
| `app/reply/page.tsx` | The entire UI: mode selector, channel selector, paste box, optional thread-context box, editable output with "Check my edits" review pass, and the history list. Client component. |
| `app/api/reply-generator/route.ts` | The API route. Validates input, fetches voice samples, builds the user prompt, calls the Claude API, sanitizes the output, writes history to Supabase. |
| `lib/replyPrompts.ts` | All four mode system prompts, the four channel format blocks, the shared rules block, the review-mode addendum, and the `ReplyMode`/`ReplyChannel` types plus their type guards. |
| `lib/toneProfile.ts` | Exports `GEORGE_VOICE_CORE`, the base voice/persona block that every mode prompt embeds. (The rest of the file — `GEORGE_TONE_PROFILE`, `generateMessage()` — belongs to the separate `/api/generate-message` compose flow, not this tool.) |
| `lib/supabase.ts` | Lazily-constructed browser Supabase client the page uses to read history. |

Supporting:

| File | Role |
|---|---|
| `lib/design.ts` | Design tokens (`C`, `F`, `card`, `btnPrimary`, etc.) the page styles itself with. |
| `components/TabNav.tsx` | Links to `/reply` from the main app (line 67). |
| `db/migrations/2026-07-27-add-reply-drafts.sql` | Creates the `reply_drafts` history table. |
| `db/migrations/2026-07-27-reply-drafts-modes-and-channel.sql` | Splits `prospecting` into broker/client modes and adds the `channel` column. |
| `db/migrations/2026-07-10-add-voice-samples-and-dismissed.sql` | Creates `voice_samples`, the few-shot corpus the route pulls from at generate time. |
| `docs/voice.md` | Declared canonical source of the voice rules; `lib/toneProfile.ts` and `lib/replyPrompts.ts` are manually synced copies of its sections. Not read at runtime. |

Environment variables consumed: `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server, with `NEXT_PUBLIC_SUPABASE_ANON_KEY` as fallback), `NEXT_PUBLIC_SUPABASE_ANON_KEY` (browser history reads).

---

## 2. Where the system prompt lives

The instruction text is **hardcoded as template-literal constants in a dedicated prompts module**, `lib/replyPrompts.ts` — not inline in the route, and not in a config object or external file. It is assembled from pieces at request time:

| Piece | File and lines | Form |
|---|---|---|
| `GEORGE_VOICE_CORE` (persona, universal rules, banned phrases, prospecting positioning, structure, format, furniture positioning) | `lib/toneProfile.ts:8-52` | Exported `const`, template literal |
| `REPLY_SHARED` (rules for all modes/channels: plain text only, no markdown, match length, etc.) | `lib/replyPrompts.ts:42-61` | Module-private `const` |
| Mode blocks: `MODE_CRE_REFERRAL`, `PROSPECTING_ANGLES`, `MODE_BROKER_PROSPECTING`, `MODE_CLIENT_PROSPECTING`, `MODE_INTERNAL` | `lib/replyPrompts.ts:65-153` | Module-private `const`s, each interpolating `GEORGE_VOICE_CORE` + `REPLY_SHARED` at the top |
| `MODE_PROMPTS` lookup map | `lib/replyPrompts.ts:155-160` | `Record<ReplyMode, string>` |
| Channel format blocks (email / text / linkedin_connect / linkedin_message) + sign-off helper | `lib/replyPrompts.ts:163-198` | `switch` inside `channelBlock()` returning string literals |
| `replySystemPrompt(mode, channel)` — final assembly | `lib/replyPrompts.ts:200-203` | Function concatenating mode block + channel block |
| `reviewSystemPrompt(mode, channel)` — "Check my edits" variant | `lib/replyPrompts.ts:207-223` | `replySystemPrompt` + a review-mode addendum literal |

The **user prompt** (voice samples block, pasted content, optional thread context, task instruction) is built inline in the route at `app/api/reply-generator/route.ts:105-148`.

A header comment in `lib/replyPrompts.ts:1-9` and `lib/toneProfile.ts:1-7` declares `docs/voice.md` the canonical source, with the code constants manually synced from it. So the prompt text effectively lives in three places that must be kept aligned by hand.

---

## 3. How audience and channel change the output

**Audience (mode)** = **separate full prompt templates**, selected by lookup. Each of the four modes is its own complete system-prompt string (`MODE_PROMPTS[mode]`), and each independently embeds the same `GEORGE_VOICE_CORE` and `REPLY_SHARED` prefixes. The file's header comment says this is deliberate: "Kept as separate readable blocks on purpose, do not merge them into one prompt with conditionals." The two prospecting modes additionally share a `PROSPECTING_ANGLES` fragment.

**Channel** = **conditional string building appended to the mode template**. `channelBlock(channel, mode)` is a `switch` that returns one of four format blocks (subject-line rules for email, 2-3 lines for text, 280-char cap for LinkedIn connect, 3-sentence cap for LinkedIn message). It also takes `mode` because the email sign-off differs: internal mode signs "Thanks, George", everything else "Best, George" (`signOff()`, lines 164-166).

Final system prompt = `MODE_PROMPTS[mode] + "\n" + channelBlock(channel, mode)`.

**Channel has a second, data-level effect**: it steers few-shot selection. `sampleChannelFor()` in `app/api/reply-generator/route.ts:30-34` maps the channel to a `voice_samples.channel` value (`text` → text, both LinkedIn channels → linkedin, else email); the route fetches the 40 most recent samples and prefers same-channel ones, taking 6 total (`fetchVoiceSamples`, lines 36-55). These land in the user prompt as a "REAL MESSAGES GEORGE HAS ACTUALLY WRITTEN" block.

There is no user-prompt injection of mode/channel — the user prompt is identical regardless of mode; only the system prompt and sample preference change. A third mechanism sits outside the prompt entirely: `sanitizeReply()` (route lines 59-73) deterministically strips markdown, converts em/en dashes to commas, and removes "Here's a draft:" preambles after generation.

---

## 4. How history is stored

**Database — Supabase (Postgres), table `public.reply_drafts`.** Not local storage, not a file, not in memory.

- Writes: server-side in the route (lines 171-204) using a service-role client. A fresh generate inserts a row; a "Check my edits" review pass updates `edited_reply` on the existing row via the `id` the client passes back. Write failures are logged but don't fail the request — the reply is returned anyway.
- Reads: the page reads the 25 most recent rows directly from the browser via the anon-key Supabase client (`loadHistory()`, `app/reply/page.tsx:123-134`).

Fields on each record (per the two migrations):

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` default |
| `mode` | `text` NOT NULL | Check-constrained to `cre_referral \| broker_prospecting \| client_prospecting \| internal` |
| `channel` | `text` NOT NULL, default `'email'` | Check-constrained to `email \| text \| linkedin_connect \| linkedin_message` |
| `incoming_email` | `text` NOT NULL | What was pasted in |
| `thread_context` | `text` nullable | Optional background box |
| `generated_reply` | `text` NOT NULL | Model output after sanitizing |
| `edited_reply` | `text` nullable | Set by the review pass; the UI shows it over `generated_reply` when present |
| `created_at` | `timestamptz` default `now()` | Indexed descending |

`localStorage` is used only for two UI preferences — the last-selected mode and channel (`reply-generator-mode`, `reply-generator-channel`, `app/reply/page.tsx:25-26`) — not for history.

---

## 5. Model and API

- **Model:** `claude-sonnet-4-6`, hardcoded at `app/api/reply-generator/route.ts:154`.
- **API:** Anthropic Messages API via the official `@anthropic-ai/sdk` — `new Anthropic()` then `client.messages.create({ model, max_tokens: 1024, system, messages: [{ role: 'user', content: prompt }] })` (route lines 150-158). Non-streaming, single user message, no tools. The route runs as a Next.js server route with `maxDuration = 30`.
- **Key:** `ANTHROPIC_API_KEY` environment variable. The route explicitly checks `process.env.ANTHROPIC_API_KEY` up front and 500s with a clear message if missing (lines 76-81); the SDK constructor is called with no arguments, so it picks the same env var up implicitly. The key never reaches the browser — the page only ever calls `/api/reply-generator`.
- **Error handling:** typed catches for `Anthropic.AuthenticationError` (bad key), `Anthropic.RateLimitError` (429 passthrough), and generic `Anthropic.APIError` (lines 207-231).

---

## 6. Portability: 3 / 5

The generator could be extracted in an afternoon, but not "with only config changes" — the persona is baked into the code, not held in config.

What pulls the score **up**:

- The server side is nearly self-contained. `app/api/reply-generator/route.ts` imports exactly one project module (`lib/replyPrompts.ts`), which imports exactly one more (`lib/toneProfile.ts` for a single string constant). No coupling to the CRM tables, cadence engine, Outlook integration, or the rest of the app.
- All external dependencies are already env-var driven (`ANTHROPIC_API_KEY`, Supabase URL/keys), and the two tables it needs (`reply_drafts`, `voice_samples`) have clean standalone migrations. History writes are best-effort, so persistence is effectively optional.
- The prompt layer has a clean seam: `replySystemPrompt(mode, channel)` / `reviewSystemPrompt(mode, channel)` are pure functions of two enums. Swapping the persona means swapping one file's constants, not untangling logic.

What pulls the score **down**:

- The "config" that would need to change is the entire prompt content. `GEORGE_VOICE_CORE`, all four mode blocks, and the channel blocks hardcode George, Focus Studio, its service lines, geography, named contacts (Darren Lizzack, Peter, etc.), and the "Best, George" / "Thanks, George" sign-offs. The mode taxonomy itself (CRE/Referral, Broker Prospecting, Client Prospecting, Internal) is George's business model, mirrored in a database check constraint. Another user means rewriting prompts, not editing config values.
- Brand assumptions leak outside the prompts: the route's user-prompt scaffolding says "WHAT GEORGE PASTED IN" (lines 120-145), `sanitizeReply()` encodes George's personal no-em-dash rule as code, and the three-way manual sync contract with `docs/voice.md` is a process dependency a lifted module would silently break.
- The UI is app-entangled: it imports the app's design tokens (`lib/design.ts`) and reads history through the shared Supabase browser client, so the front end doesn't lift without bringing app styling and the anon-key pattern along.

Net: well-layered for a single-tenant tool (a clean 3), but the "shared module today, config only" bar of a 5 fails because voice, audience taxonomy, and sanitization rules are source code, not configuration.

---

## 7. Files with hardcoded brand-specific strings

Every tracked file containing "Focus Studio", "George", "Chicolo", "LeaseLenZ", or "FocusedOutreach/focusedoutreach". Files marked ● ship brand text into prompts or user-visible output at runtime; ○ means comments, docs, or migration notes only.

**Reply generator (this audit's scope):**

- ● `lib/toneProfile.ts` — persona, company, geography, sign-offs throughout `GEORGE_VOICE_CORE` and `GEORGE_TONE_PROFILE`
- ● `lib/replyPrompts.ts` — George/Focus Studio throughout all mode blocks, channel blocks, sign-offs, review prompt
- ● `app/api/reply-generator/route.ts` — "GEORGE" in the runtime user-prompt scaffolding (lines 107, 120, 138, 145); rest comments
- ○ `app/reply/page.tsx` — comments only (lines 164, 306)
- ○ `docs/voice.md` — the canonical voice document itself
- ○ `db/migrations/2026-07-27-add-reply-drafts.sql`, `db/migrations/2026-07-27-reply-drafts-modes-and-channel.sql`, `db/migrations/2026-07-10-add-voice-samples-and-dismissed.sql` — migration comments ("focusedoutreach Supabase project", "George's real writing")

**Rest of the app:**

- ● `lib/messages.ts` — message templates with George/Focus Studio in runtime strings, including a full signature block (line 191)
- ● `lib/engine/copywriter.ts` — engine drafting prompts (George, Focus Studio)
- ● `lib/engine/classifier.ts` — classifier prompt persona (George Chicolo, Focus Studio)
- ● `lib/engine/digest.ts` — digest copy referencing George/Focus Studio
- ● `app/api/generate-message/route.ts` — compose-route prompt scaffolding ("George")
- ● `lib/prioritize.ts` — Focus Studio in a runtime string (line 139)
- ● `components/Header.tsx` — "Focus Studio" in the visible header (line 115)
- ● `components/MessageCard.tsx` — Focus Studio / George in UI copy
- ● `components/InlineCompose.tsx` — George in UI copy
- ● `components/DoThisNow.tsx` — George in UI copy
- ● `app/layout.tsx` — Focus Studio in site metadata (title/description, lines 5-6)
- ● `lib/storage.ts` — George in runtime strings (lines 315, 351)
- ○ `lib/engine/qualifier.ts`, `lib/engine/db.ts` — comments
- ○ `lib/ms/config.ts`, `lib/ms/replies.ts` — comments
- ○ `app/api/outlook/connect/route.ts`, `app/api/outlook/callback/route.ts`, `app/api/outlook/draft/route.ts` — comments
- ○ `app/api/engine/run/route.ts`, `app/api/engine/today/route.ts` — comments
- ○ `db/migrations/2026-07-10-add-ms-oauth-and-email-replies.sql`, `db/migrations/2026-07-10-add-qualification-columns.sql`, `db/migrations/2026-07-10-normalize-date-text.sql`, `db/migrations/2026-07-27-touch-log-outreach-webhook.sql` — migration comments
- ○ `docs/AUDIT-AND-REBUILD-PLAN.md`, `docs/OUTLOOK-INTEGRATION.md` — docs

35 files total: 13 with brand strings in runtime/prompt/UI output, 22 in comments and documentation only.
