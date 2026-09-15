# Phase 13 — Bot API: Analytics Endpoints

## What was already there (built ahead of schedule, partially working)
`GET /bots/:id/analytics` and `GET /bots/:id/activity` already existed in
`worker/src/routes/bots.ts`, both gated by the same `getBot(db, botId,
userId)` ownership check as every other route in this file. `/activity`
was real and complete — a plain, correctly-scoped `bot_messages` query
through `botMessageShape` — and needed no changes. `/analytics` and the
bot-detail endpoint's embedded `analytics` field were not: both read a
`bot_analytics` daily-aggregate table that was itself being written
incorrectly, and both included a field with no backing data at all. This
phase's spec bullets (total/inbound/outbound messages, active users, daily
activity, message statistics, bot activity) are exactly what those two
existing readouts were supposed to provide but didn't.

## Gaps found and fixed this phase

### 1. Hardcoded fake `uptimePct: 99.2` (real bug, not a style gap)
Both `GET /bots/:id` and the old `GET /bots/:id/analytics` returned
`uptimePct: 99.2` — a fixed literal, not a computed value. Nothing in this
schema tracks bot process uptime or heartbeats (no `status` transition
log, no ping/heartbeat table), so there is no real number to report here.
Removed entirely rather than left in as a placeholder — per this phase's
explicit instruction, no mock/fake data. The `app/bot/[id]/analytics.jsx`
`ThroughputMeter` "Uptime" bar that displayed it is gone too, replaced
with real inbound/outbound stat cards (see #4).

### 2. `bot_analytics.active_users` was a duplicate of `message_count`, not a real distinct-user count
`worker/src/routes/other.ts`'s inbound webhook handler did:
```sql
INSERT INTO bot_analytics (bot_id, date, message_count, active_users) VALUES (?, ?, 1, 1)
ON CONFLICT(bot_id, date) DO UPDATE SET
  message_count = message_count + 1,
  active_users = active_users + excluded.active_users
```
— i.e. `active_users` was incremented by 1 on every single inbound
message, identically to `message_count`. A bot user who sent five
messages in one day inflated "active users" by five, not one. Fixed with
a new `refreshBotAnalyticsForToday(db, botId)` helper
(`worker/src/lib/botAnalytics.ts`) that recomputes both columns from the
real `bot_messages` rows for the day (`COUNT(*)` and
`COUNT(DISTINCT CASE WHEN direction='in' THEN bot_user_id END)`) and
writes the true value, rather than incrementing a running counter that
can drift from reality. Covered by
`botAnalytics.e2e.test.ts`'s "counts once, not once per message" test,
which asserts the stored `bot_analytics` row directly, not just the live
endpoint.

### 3. Outbound messages never touched `bot_analytics` at all
`POST /bots/:id/users/:userId/messages` (outbound send) inserted into
`bot_messages` but never wrote to `bot_analytics` — so the cross-bot `GET
/stats/summary` "messages today" dashboard silently excluded every
admin-sent reply, undercounting real activity. Now calls the same
`refreshBotAnalyticsForToday` the inbound handler uses (via
`c.executionCtx.waitUntil`, matching the fire-and-forget pattern already
used for webhook delivery in the same route).

### 4. `GET /bots/:id/analytics` returned a 7-day array off the (already
inaccurate) counter table, no aggregate totals, and the phase asks for two
separate endpoints, not one
Per the phase plan: "Prefer computing analytics from the real
bot_messages/bot_users tables via aggregate SQL... rather than a
separately maintained counter table, to guarantee it reflects real data."
Rebuilt on that basis in a new shared module, `worker/src/lib/
botAnalytics.ts`:
- `getBotAnalyticsSummary(db, botId)` — live aggregate query for
  `GET /bots/:id/analytics`: `totalMessages`, `inboundMessages`,
  `outboundMessages` (from `bot_messages`, `COUNT`/`SUM(CASE...)`),
  `totalUsers` (`COUNT(*)` on `bot_users`), `activeUsers` (`bot_users`
  with `last_active_at` in the last 7 days — a real recency signal
  already bumped by the inbound webhook handler, not a fabricated ratio
  of `totalUsers`), plus `messagesToday`/`activeUsersToday`.
- `getBotAnalyticsDaily(db, botId, days)` — new
  `GET /bots/:id/analytics/daily?days=N` endpoint (default 7, capped at
  90 so it can never become an unbounded scan/response): per-day
  `{date, messages, inbound, outbound, activeUsers}`, `GROUP BY
  date(created_at/1000,'unixepoch')`, zero-filled for days with no
  messages (a real, correct zero — not a gap, not an interpolated value)
  and always oldest-first.
- `GET /bots/:id` still embeds an `analytics` field (only consumer:
  `app/bot/[id]/analytics.jsx`), now just `getBotAnalyticsSummary`'s
  output — same real numbers, not a second, divergent implementation.

Caught and fixed one bug while building this: the day-bucket helper
originally computed "start of today" via `new Date().setHours(0,0,0,0)`,
which resolves in the JS engine's local timezone. SQLite's
`date(created_at/1000,'unixepoch')` (used for the `GROUP BY`) is always
UTC. On a runtime where local time isn't UTC, those two boundaries
disagree, so a message near a day edge could be bucketed under a
different day by the grouping query than the zero-fill loop assumed —
wrong data, not just cosmetically off. Fixed by computing the day
boundary as `Math.floor(Date.now() / DAY_MS) * DAY_MS`, i.e. flooring to
the nearest Unix-epoch day — the epoch itself is a UTC midnight, so this
always lands exactly on a UTC day boundary regardless of any local
timezone configuration, matching SQLite's function exactly. (Cloudflare's
Workers runtime is documented as UTC-only, so this may never have
manifested in production, but nothing here should depend on that being
true in every environment this code runs in, including the Miniflare
test pool — and it's a one-line fix to remove the assumption entirely.)

### 5. `app/bot/[id]/activity.jsx` was entirely fabricated data
This screen never called the real (already-working) `GET /bots/:id/
activity` endpoint. It rendered a fixed, hardcoded array of five made-up
log lines — invented `update_id`s, an invented `429 rate limited` error,
invented latencies — behind a fake `setTimeout(..., 450)` standing in for
a network call, regardless of which bot's activity screen was open.
Rewired to call `fetchBotActivity(id)` (already existed in `botsApi.js`,
just never used) and render the real `bot_messages` rows it returns: real
direction, real text/attachment, real timestamp. Also removed the fake
feed's invented third "error" event type — this schema has no per-message
delivery-status/error log (no column records a webhook response code per
message), so showing only the two directions the data actually has
(`in`/`out`) rather than a fabricated third state.

## Deliberate non-changes
- Did **not** add a delivery-status/error-per-message tracking system to
  make the old fake "error" activity events real — that's a genuinely new
  feature (webhook response code + latency per message) with its own
  schema and instrumentation, out of this phase's scope ("Analytics:
  total/inbound/outbound messages, active users, daily activity, message
  statistics, bot activity" — nothing about per-message delivery status).
  Flagging it as a real gap rather than quietly inventing data for it.
- Did **not** rename or restructure the existing `bot_analytics` table —
  it remains, now correctly written, purely as a write-time cache for the
  unrelated cross-bot `GET /stats/summary` dashboard (out of this phase's
  scope). The per-bot analytics endpoints this phase adds compute
  directly from `bot_messages`/`bot_users` and never read this table.
- Did **not** touch `stats.get('/summary')` or `stats.get('/bots/:id/
  rate')` beyond what the `bot_analytics` write-path fix above already
  improves for free (its `message_count` figure is now inbound+outbound
  instead of inbound-only, a strict accuracy improvement with no
  signature change).

## Tests added
`worker/src/routes/__tests__/botAnalytics.e2e.test.ts` — real HTTP
(`SELF.fetch`), real D1, same harness as every other `*.e2e.test.ts` file
in this project. Covers: a brand-new bot returning real zeros (no
`uptimePct` field at all); aggregate totals against a real mix of seeded
inbound/outbound messages and a stale vs. recently-active user; the
active-user-per-message bug fix, verified both through the live endpoint
and by asserting the stored `bot_analytics` cache row directly; outbound
sends now reflected in both the live aggregate and the cache; cross-bot
isolation and 404s on both endpoints; real day-bucketing from seeded
`created_at` timestamps including a zero-filled gap day and oldest-first
ordering; the `days` query param's default (7) and cap (90); and that
`GET /bots/:id`'s embedded `analytics` field is the same real summary,
not the removed fake shape.

## Not run in this environment
Same situation every prior phase's notes have flagged: this sandbox's
network egress is disabled (`npm install` fails with `403` against the
registry, no vendored `node_modules`), so `npm run test`, `npm run
typecheck`, and `db:migrate` could not actually be executed here. As a
partial substitute, every edited/added TypeScript file was run through a
standalone `tsc --noEmit` in syntax-only mode (no `hono`/`@cloudflare/
workers-types` available, so only real syntax errors would surface, not
type errors — the only errors that came back were the expected "cannot
find module/name" ones every existing file in this project already
produces under the same syntax-only check, e.g. `D1Database`), and both
edited/added plain-JS/JSX client files (`api.js`, `botsApi.js`, `app/bot/
[id]/analytics.jsx`, `app/bot/[id]/activity.jsx`) passed a `tsc --noEmit
--allowJs --jsx react` parse / `node --check`. That confirms the code
parses; it does not confirm it behaves — please run `npm test`, `npm run
typecheck`, and apply `schema.sql` to a disposable D1 before treating
this phase as verified, per the "do not report something as complete if
it is only partially implemented/verified" rule.
