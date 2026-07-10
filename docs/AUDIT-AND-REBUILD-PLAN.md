# FocusedOutreach — Audit & Rebuild Plan

This plan was verified against the codebase as of `7c2b342` (branch
`claude/focusedoutreach-audit-rebuild-empjp4`). Part 0 records what the code
actually does today — including places where earlier drafts of this audit were
wrong — and the concrete bugs found while reading it. Parts 1–4 are the
corrected audit, tool comparison, target architecture, and roadmap.

---

## PART 0: GROUND TRUTH FROM THE CODE AUDIT

### What already exists (don't rebuild these)

| Capability | Where | Status |
|---|---|---|
| Daily cron | `vercel.json` — `0 11 * * 1-5` hits `/api/engine/run` (6/7 AM ET weekdays) | **Done.** Earlier audit claim "manual trigger only" is wrong. |
| Authorized manual trigger | `app/api/engine/trigger/route.ts` injects `CRON_SECRET` server-side | Done. |
| D-tier exclusion | `lib/engine/db.ts:43,63` — `.neq('tier', 'D')` on both brokers and partners | Done. Earlier "D-tier contacts pollute the queue" claim is wrong. |
| Digest redesign | `lib/engine/digest.ts` — top 5 overdue, notes context line, no draft previews | Done (commit `d27546b`). |
| Opener variety (v1) | `lib/engine/copywriter.ts:86-100` — 6 opener angles rotated deterministically by contact-id hash; "been a while"-style openers banned in the system prompt | Partial. Rotation exists; **draft-history awareness does not** — the model never sees openers it actually produced. |
| Draft review statuses | `app/api/engine/drafts/route.ts` — approved / edited / killed / sent, `edited_body` stored, `sent_at` stamped | Partial. The events are **captured**, not discarded — they're just never learned from. No edit distance, no skip reason. |
| Pending-draft dedupe | `lib/engine/db.ts:227-245` + `run/route.ts:68-98` — dedupe by contact id AND normalized name, per-run cap of 40 | Done (commit `0527347`). |
| Multichannel deep links | `lib/sendActions.ts` — `sms:` deep link, `mailto:`, LinkedIn open, clipboard copy | Client plumbing exists. The **engine** doesn't use it: channel selection is just "A-tier → text, else email" (`copywriter.ts:117,151`). |
| Run telemetry | `agent_runs` table via `logAgentRun` | Done. |

### Bugs and defects found in the current code

**B1 — Qualifier mis-attributes signals to brokers (`lib/engine/qualifier.ts:73-79` → `lib/engine/db.ts:85-94`).**
`findBrokerByFirmOrName('', signal.company_name)` does `firm ILIKE '%<company>%' LIMIT 1`.
An end-user growth signal ("Acme Series B") gets attached to an *arbitrary
broker* whose brokerage name fuzzily contains the company string, and the
copywriter then drafts a congratulatory/follow-up message to the wrong human.
Substring ILIKE also false-matches short names ("CBRE" ⊂ "CBRE Investment
Management"). This is the single worst correctness bug: it can produce a
confidently wrong outbound draft.

**B2 — Drafts API is unauthenticated (`app/api/engine/drafts/route.ts`).**
GET and PATCH use the anon key with no auth check. If Supabase RLS isn't
locked down, anyone who finds the URL can read every pending draft (names,
phones, notes) and approve/kill/mark-sent arbitrarily. The engine run route is
secret-protected; this one isn't.

**B3 — N+1 query pattern in the cadence manager (`lib/engine/cadence-manager.ts:44,51`).**
`getRecentActivity` and `hasOpenTask` are awaited per contact inside the loop
— ~2 round-trips × hundreds of contacts per run. This is a large share of why
the run blew past Vercel's 300 s limit and needed the 40-draft cap. Two batch
queries (all touch_log rows in the last 30 days; all pending activities)
resolve it.

**B4 — Dates stored as TEXT with mixed formats.**
`db.ts` header notes `next_due`/`last_touch` are TEXT; `digest.ts:29-35`
already defends against `"2026-06-16"` vs `"6/23/2026"`. The due-check
`b.next_due <= today` (`db.ts:50,70`) is a *string* comparison — correct only
for ISO-formatted values; any `M/D/YYYY` row compares garbage and can be
permanently "due" or permanently invisible. Needs a one-time normalization
migration + real DATE columns.

**B5 — Digest top-5 ignores tier (`lib/engine/digest.ts:50-52`).**
The cadence manager sorts tier-then-overdue, but the digest re-sorts by
`days_overdue` alone, so a 200-days-overdue C-tier contact outranks a
5-days-overdue A-tier broker. (This narrows the earlier "naive ranking"
claim: tier ordering exists in the queue, it's the digest that drops it.)

**B6 — Signal scout is dead weight in every run.**
`signal-scout.ts` fires 6 Perplexity queries per run and (per observed
behavior) returns ~zero usable signals, yet it runs first and eats run time.
Consistent with the architectural critique below (1.2).

**B7 — Dead/duplicated code paths.**
`engine/package.json` is an empty file. More importantly, there are two
parallel prioritization systems: the client-side CSV-era stack
(`lib/prioritize.ts`, `lib/cadence.ts`, `lib/messages.ts`) and the Supabase
engine (`lib/engine/*`). `lib/prioritize.ts:5-19` hardcodes broker surnames
("mcbride", "shikar", …) as Tier-1 keywords — data living in code. One system
should win; the other should be deleted.

**B8 — Tier model mismatch.**
`types/index.ts` declares `RelationshipTier = 'A' | 'B' | 'C'` while the DB
filters `.neq('tier', 'D')` — D exists in data but not in the type system, so
the dashboard can't render or manage the tier the engine silently excludes.

### Claims from earlier audit drafts, corrected

- ~~"No cron; engine only runs when George remembers"~~ → cron exists; keep it.
- ~~"Approve/skip/edit events are discarded"~~ → stored in `drafts.status` +
  `edited_body`; the gap is *learning from* them, not capturing them.
- ~~"Everything defaults to email"~~ → A-tier already drafts as text, and the
  dashboard already has sms:/mailto:/LinkedIn launchers; the gap is that the
  engine's channel rule is two-branch and ignores history/preference.
- ~~"Fix digest ranking — one query change"~~ → fix is in `digest.ts`'s re-sort,
  not the query; cadence manager already tiers.

---

## PART 1: AUDIT

### Critical failures (system produces wrong or wasted output)

**1.1 — Contaminated targeting pool.** ~813 contacts with no
persona/qualification layer (beyond the D-tier exclusion) means the cadence
engine treats a residential agent from a networking event the same as a JLL
tenant rep managing 40 active requirements. Every draft written for a
non-target is wasted Claude spend and wasted George attention; a digest whose
"top 5" is 3/5 irrelevant trains George to ignore the digest. **This is the
#1 problem — it degrades trust in every downstream feature.**

**1.2 — Signal intelligence is dead weight.** Perplexity returns ~zero
signals, so the copywriter has no "reason to reach out" and falls back to
generic relationship-maintenance angles. This is the root cause of opener
sameness — without a signal there are only so many ways to say "checking in."
Perplexity is architecturally wrong here: it's a search summarizer, not a
monitoring system. CRE signals live in structured sources (CoStar news, TRD,
Bisnow, ROI-NJ, LinkedIn activity, lease comps), not open web search. And per
B1, the little it does return can get attached to the wrong person.

**1.3 — No feedback *loop*.** Approve/edit/kill events are stored (Part 0)
but nothing reads them back. If George edits every opener, the system should
know. If he kills every draft to a category of contact, that category should
get deprioritized or disqualified. The highest-value training data the system
generates currently accrues in a table nobody queries.

### Structural gaps (missing capabilities)

**1.4 — Channel selection is two-branch.** NJ/NYC CRE relationships run on
text and phone; LinkedIn is the right channel for cold prospects. The engine's
rule is "A-tier → text, else email" with no awareness of how a contact
actually communicates (inbound texter, LinkedIn-only connection, never-replied
email). The deep-link plumbing already exists client-side — the intelligence
doesn't.

**1.5 — No enrichment.** The system knows nothing it wasn't fed at import: no
title changes, no firm moves, no LinkedIn URL validation, no mobile numbers.
Broker turnover in NYC/NJ CRE is high — a meaningful share of the ~460 broker
records is likely stale (wrong firm, wrong email) right now.

**1.6 — No Salesforce sync.** George's official record lives in Salesforce;
his working record lives in Supabase. Two sources of truth means neither is
true. Meetings booked, notes logged, and stage changes in SF never update the
cadence engine, so the tool will nag him about contacts he met last week —
the 30-day `touch_log` check only helps if touches get logged in *this* tool.

**1.7 — No meeting instrumentation.** The entire goal is "get meetings," and
the tool has zero instrumentation for its own success metric: no booking link
in drafts, no meeting-booked event, no draft → reply → meeting conversion
tracking.

**1.8 — No reply/engagement tracking.** Cadence timing keys purely off
last-touch date, never last-response. A broker who replied warmly 10 days ago
and one who has ignored six straight emails get identical treatment.

### Quality issues

**1.9 — Opener repetition (residual).** The deterministic angle rotation
helps, but the model still can't see its own recent output — neither the last
few drafts to this contact nor the rest of today's batch — so same-angle
contacts converge on near-identical first lines.

**1.10 — Digest ranking drops tier (B5).** Sort key should be
overdue-ness × tier × warmth × signal presence; today the digest uses raw
overdue-days alone.

**1.11 — Run-time fragility.** The 40-draft cap and copywriter concurrency
were added to live inside Vercel's 300 s window, but B3's N+1 queries burn
much of the budget before drafting starts, and a growing contact base will
re-hit the wall.

---

## PART 2: TOOL LANDSCAPE — HONEST COMPARISON

| Tool | What it does well | Why it fails (or fits) for George |
|---|---|---|
| **Clay** | Best-in-class enrichment waterfall (50+ providers), AI research agents (Claygent) for signal discovery, flexible tables, webhook I/O. | It's a data workbench, not a sending/cadence system. Pricing ($149–800/mo) aims at teams. **Verdict: use it — as the enrichment/signal layer via API, not the UI.** |
| **Apollo** | Cheap all-in-one: 275M contact DB, enrichment, sequences, dialer. Good for finding new brokers by title/geo. | Enrichment quality mediocre for CRE (brokers often use firm-branded emails Apollo misses). Sequencer is volume-cold-outreach oriented, wrong for warm relationship cadences. Personalization far below the existing Claude drafts. **Verdict: API for net-new prospect discovery + email verification only.** |
| **Instantly / Smartlead** | Deliverability infra: inbox rotation, warmup, spintax, high-volume cold email. | Built for spray-and-pray. George sends low-volume, high-personalization mail from his real identity to people he knows. Rotating burner inboxes would damage his reputation. **Verdict: skip both entirely.** |
| **HubSpot Sequences** | Decent 1:1 sequences, meeting links, CRM-native. | George's CRM is Salesforce. Adding HubSpot creates a third system of record. **Verdict: skip.** |
| **Outreach.io / Salesloft** | Enterprise-grade multichannel cadences, analytics, SF sync, call/SMS steps. | $100–140/user/mo, team-oriented, rigid cadence templates, and their AI personalization is worse than the custom Claude pipeline already built. Buying either means abandoning the custom voice engine — the one thing that demonstrably works. **Verdict: skip; replicate the 20% needed (multichannel steps, SF sync) in the existing stack.** |
| **Smarte / LeadMagic / Prospeo / Findymail** | Cheap email-finding + mobile enrichment APIs. | Point solutions — exactly right as waterfall steps inside Clay or called directly. **Verdict: use 2–3 in a waterfall.** |
| **Unipile (or PhantomBuster) for LinkedIn** | Unipile: clean API for LinkedIn messaging/connection requests from George's own account. PhantomBuster: scraping/automation, higher ban risk. | LinkedIn automation always carries ToS risk. Unipile is the safest managed option; keep volume human-scale (<50 actions/day). **Verdict: Unipile for LinkedIn send + inbox sync.** |
| **Twilio (SMS)** | Programmable SMS, full API control. | A2P 10DLC registration required, and texts from a Twilio number ≠ texts from George's phone. The repo already has the better answer: `sms:` deep-link / clipboard (`lib/sendActions.ts`) so George sends from his own number — authentic, zero compliance overhead. **Verdict: keep deep-link; no Twilio.** |
| **Cal.com / Calendly** | Booking links + webhooks on meeting-booked. | Cal.com is API-first and self-hostable — better fit for webhook-driven meeting tracking into Supabase. **Verdict: Cal.com.** |
| **Signal sources: CoStar, Traded.co, TRD/Bisnow RSS, LinkedIn posts, NJ/NYC lease news** | Where real CRE signals live: lease signings, broker moves, tenant-in-market news. | CoStar API is expensive/restricted. Practical stack: RSS ingestion (TRD, Bisnow, ROI-NJ, GlobeSt) + Traded.co + LinkedIn post monitoring (Unipile/Clay) + Google News queries per firm. **Verdict: build a lightweight signal ingester; this replaces Perplexity.** |
| **Salesforce API** | Direct REST/Bulk API, mature. | No downside — mandatory. Use `jsforce` in the Next.js backend. |

**Bottom line:** no off-the-shelf platform fits a low-volume, high-warmth,
relationship-cadence workflow with a custom voice model. The existing custom
stack is the right chassis. **Buy** enrichment (Clay/Apollo APIs), LinkedIn
transport (Unipile), booking (Cal.com), and SF sync (jsforce) — **build**
everything else.

---

## PART 3: TARGET ARCHITECTURE

### 3.1 System overview

```
                    ┌─────────────────────────────┐
  Signal Ingester ──►                             ├──► Daily Digest (ranked)
  (RSS/News/LI)     │   ORCHESTRATOR (existing    │
  Enrichment ───────►   Vercel cron + engine)     ├──► Dashboard (Next.js)
  (Clay/Apollo)     │                             │
  SF Sync ◄─────────►   Scoring → Cadence →       ├──► Channels:
  (jsforce, 2-way)  │   Channel Select → Draft    │     Gmail API (email)
  Cal.com webhooks ─►   (Claude) → Approve Queue  │     Unipile (LinkedIn)
  Reply tracking ───►                             │     sms: deep-link (text)
                    └──────────┬──────────────────┘
                               ▼
                     Feedback Store (edits, kills,
                     replies, meetings) → weekly
                     prompt/scoring recalibration
```

### 3.2 Data model (Supabase — additions to existing schema)

```sql
-- brokers / partners (existing; migrate mixed-format TEXT dates to DATE — B4)
ALTER: persona ENUM('tenant_rep','landlord_rep','landlord','property_mgr',
                    'end_user','partner','other'),
       qualified BOOLEAN,          -- gate for cadence engine
       warmth_score NUMERIC,       -- 0-100, computed
       preferred_channel ENUM('email','sms','linkedin','call'),
       mobile_phone, linkedin_url, firm_domain,
       sf_contact_id TEXT,         -- Salesforce join key
       enriched_at TIMESTAMPTZ

-- signals (existing table; extend)
ALTER: firm_domain TEXT, confidence NUMERIC, used_in_draft BOOLEAN
       -- entity matching keys off firm_domain + fuzzy full name, replacing
       -- the ILIKE-firm-substring match that causes B1

-- touches (new; supersedes touch_log for engine purposes)
id, contact_id, contact_table, channel,
direction ENUM('outbound','inbound'), draft_id, sent_at, replied_at,
sentiment ENUM('positive','neutral','negative')

-- drafts (existing; extend)
ALTER: body_final TEXT,            -- rename/alias of edited_body
       edit_distance NUMERIC, opener_fingerprint TEXT, skip_reason TEXT
       -- keep existing status enum (pending/approved/edited/killed/sent)

-- meetings (new)
id, contact_id, source ENUM('calcom','manual','sf'), booked_at, held_at, outcome

-- feedback_rules (new; learned adjustments)
id, scope ENUM('contact','persona','tier','global'), key, adjustment JSONB
```

### 3.3 Daily pipeline (existing 6/7 AM ET cron, upgraded)

1. **Sync in:** Pull SF activity/notes/stage changes (updates last-touch —
   kills the "nagging about someone I just met" failure mode). Pull Unipile
   LinkedIn inbox + Gmail replies → write inbound `touches`, Claude sentiment
   tag.
2. **Signal scan:** Ingest RSS/News feeds; match entities against
   `firm_domain` and full names (fuzzy, threshold — fixes B1). Write
   `signals`. LinkedIn post check for A/B-tier contacts only (rate-limited).
3. **Score:** `priority = overdue_factor × tier_weight × warmth_score ×
   (1 + signal_boost)`, where warmth = f(reply rate, recency of inbound,
   meeting history). `qualified = false` never enters the queue. Batch the
   activity/task lookups (fixes B3).
4. **Channel select:** Rules first, ML never (at this volume): inbound texter
   → SMS; connected-on-LI + never-emailed cold prospect → LinkedIn; A-tier
   warm with signal → email (long-form value) or SMS if last 2 touches were
   text; default → email. Store the rationale on the draft.
5. **Draft (Claude):** Context includes contact record, last 3 touches (both
   directions), matched signal, **last 5 openers used across the batch + last
   3 sent to this contact** (real anti-repetition, upgrading the current
   angle-rotation), persona-specific playbook (tenant rep ≠ property manager
   talk track), and top `feedback_rules`. SMS ≤ 300 chars; LinkedIn ≤ 500.
6. **Queue & digest:** Top 5 = highest priority score (not raw overdue-days —
   fixes B5), with channel icons and a one-line signal justification
   ("Cushman announced 40K SF lease at 101 Hudson — his deal"). Digest links
   deep into the approve queue.
7. **Send:** Email via Gmail API from George's real inbox (thread continuity;
   replaces the SMTP-app-password digest path over time). LinkedIn via
   Unipile. SMS via the existing one-tap `sms:` deep link / desktop copy.
   Every send writes a `touch` and syncs an SF Task via jsforce.
8. **Feedback capture:** On approve/edit/kill: compute edit distance, store
   final body, one-tap kill reason ("wrong person / wrong timing / wrong
   angle / wrong channel"). A weekly job aggregates into `feedback_rules`
   (e.g., "CTA on landlord-rep drafts rewritten 80% of the time → new CTA
   instruction") and flags contacts with 3+ "wrong person" kills for
   disqualification.

### 3.4 Enrichment flow

Nightly for stale records (`enriched_at` > 90 d, or bounce/failed touch):
Clay webhook table (or direct waterfall: Prospeo → LeadMagic → Apollo) →
verify email, fetch LinkedIn URL, current firm/title, mobile. A title/firm
delta auto-generates a `job_change` signal — the single best
conversation-starter in CRE.

### 3.5 Meeting loop

Cal.com link embedded contextually in drafts (only above a warmth threshold —
don't lead cold outreach with a booking link). Cal.com webhook → `meetings`
row → SF Event → cadence pause until 14 days post-meeting, follow-up draft
auto-queued the day after.

---

## PART 4: PRIORITIZED ROADMAP

### Phase 0 — Stop the bleeding (Week 1) — no new infra

> **STATUS 2026-07-10: Phase 0 complete.** All items below shipped on this
> branch: B1 (`6d11e47`), B2 (`be56945`), B5 (`79377a6`), B3 (`257d433`),
> B4 (`47f08b6`, migration applied to the live DB), Perplexity removal
> (`e8500bd`), opener anti-repetition v2 (`30fe97e`), dead code (`85bf029`),
> qualification gate + classify endpoint (`5e70bd6`, schema applied live).
> One manual step remains: after deploy, run the classification backfill —
> `curl -X POST $APP_URL/api/engine/classify -H "authorization: Bearer $CRON_SECRET"`
> (repeat until `results.*.classified` returns 0), then review contacts
> where `qualified IS NULL AND persona IS NOT NULL` (the low-confidence
> calls). Next up: Phase 1.

- **Fix B1 (signal mis-attribution):** require an exact-domain or
  high-confidence name match before attaching a signal to a broker; otherwise
  leave `contact_id` null and treat as cold. Small change in
  `qualifier.ts`/`db.ts`; kills the wrong-human-draft failure mode.
- **Fix B2 (unauthenticated drafts API):** require auth (shared secret or
  Supabase session) on `/api/engine/drafts`, and verify RLS on `drafts`.
- **Qualification sprint:** add `persona`/`qualified` columns; one-time Claude
  batch classification of all ~813 contacts from name/firm/notes/email
  domain; George reviews the ~100 low-confidence calls in a 30-minute triage
  UI. Cadence engine filters `qualified = true` from day one.
- **Fix B5 (digest ranking):** sort the digest top-5 by
  `overdue × tier_weight`, not raw overdue-days. One function change,
  immediate trust recovery.
- **Fix B3 (N+1):** two batch queries in the cadence manager; likely lets the
  per-run draft cap rise.
- **Fix B4 (dates):** one-time normalization of `next_due`/`last_touch` to
  ISO + DATE columns.
- **Kill the Perplexity path** (`signal-scout.ts`) — it returns nothing and
  burns run time. Leave the `signals` schema; the Phase-2 ingester refills it.
- **Opener anti-repetition v2:** inject the batch's used openers + this
  contact's last openers into the prompt ("do not open like any of these"),
  layered on the existing angle rotation. Prompt-only, ships in a day.
- **Delete dead code (B7):** empty `engine/package.json`; decide the fate of
  the CSV-era `lib/prioritize.ts` stack (fold the useful tier heuristics into
  the DB, then remove).

*(Already done — not roadmap items: cron, D-tier exclusion, pending-draft
dedupe, per-run cap, digest redesign.)*

### Phase 1 — Truth & feedback (Weeks 2–4)

- **Salesforce 2-way sync (jsforce):** inbound activity sync first (fixes
  stale last-touch), then outbound task logging. Highest-leverage integration
  — do it before enrichment.
- **Feedback capture:** edit distance + kill reasons on the existing draft
  statuses. Even before the learning job exists, the data starts accruing.
- **Reply tracking:** Gmail API watch on George's inbox, thread-match to
  `touches`, sentiment tag. Warmth score v1.

### Phase 2 — Signals & enrichment (Weeks 5–8)

- **Signal ingester:** RSS (TRD, Bisnow, ROI-NJ, GlobeSt, CoStar News public
  feeds) + Google News queries per top-50 firms. Entity matching to contacts
  via firm_domain + fuzzy name. This resuscitates the copywriter's "reason to
  reach out."
- **Enrichment pipeline:** Clay webhook table or direct API waterfall — the
  ~460 brokers first (highest churn), then partners/prospects. Job-change
  signals go live here.
- **Weekly feedback recalibration job:** aggregate Phase-1 data into
  `feedback_rules`, inject into prompts.

### Phase 3 — Multichannel & meetings (Weeks 9–12)

- **Channel-select rules** in the pipeline (the deep-link send surface
  already exists); channel shown in digest.
- **Unipile LinkedIn:** inbox sync first (read replies), sending second,
  capped ~30 actions/day.
- **Cal.com integration** + meeting webhook + conversion dashboard (drafts →
  replies → meetings per tier/persona/channel — the system's true
  scoreboard).

### Deferred (revisit at 6 months)

- Apollo-powered net-new prospect discovery (fix the existing ~813 first).
- ML channel/timing selection (rules are sufficient at this volume).
- Voice fine-tuning beyond prompt engineering.
- Twilio/native SMS sending (only if deep-link friction proves real).
- Any migration to Outreach/Salesloft — the custom stack, once Phases 0–3
  ship, beats them for this workflow at ~$300/mo in API costs vs. $1,700+/yr
  per seat plus lost voice quality.

### Success metrics to instrument from Phase 1

- % of digest contacts George actually acts on (target > 80%).
- Draft edit rate (target: trending down weekly).
- Reply rate by persona / tier / channel.
- **Meetings booked per week** — the only number that ultimately matters.
