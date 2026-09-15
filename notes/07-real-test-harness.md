# Phase 7 — Real Miniflare/Workers Test-Pool Harness (no mocks, no fakes)

## What this closes

The second issue flagged since Phase 5 and repeated in Phase 6's notes:

> No Miniflare/Workers test-pool harness exists in this project — today's
> tests run against real modules with lightweight D1/KV fakes, not full
> HTTP integration tests.

Per explicit instruction this phase: **nothing in this test suite mocks or
fakes anything.** `src/lib/__tests__/fakes.ts` is deleted. Every test now
runs inside the actual Workers runtime against a real D1 database (with
the project's real `schema.sql` applied) and a real KV namespace, via
`@cloudflare/vitest-pool-workers` (which wraps Miniflare — the same engine
`wrangler dev` uses locally). One test file goes further and drives the
real exported Worker over real HTTP (`SELF.fetch`), through a real login,
with a real JWT.

## What changed

- **Dependencies**: added `@cloudflare/vitest-pool-workers` (`^0.22.0`).
  Its peer dependency requires `vitest ^4.1.0`, which is not yet compatible
  with `vitest ^5.0.0` (the version this project started on) — `vitest` is
  pinned down to `^4.1.11` to make the real harness possible. This is a
  deliberate trade (a slightly older vitest, in exchange for zero fakes)
  rather than staying on vitest 5 with hand-rolled doubles.
- **`worker/vitest.config.mts`** (new, `.mts` so it loads as ESM regardless
  of the package's own module type): configures the pool via
  `cloudflareTest({ wrangler: { configPath: './wrangler.toml' }, ... })` —
  reusing the project's actual `wrangler.toml` bindings (`DB`, `KV`,
  `BUCKET`), so there's no separate/parallel test-only binding config to
  drift out of sync with what's deployed. `JWT_SECRET` (a real deploy-time
  secret, never committed) is supplied only as a local miniflare override
  for tests.
- **`worker/src/test/applySchema.ts`** (new, `setupFiles`): runs once per
  test file, inside the real Workers runtime, and applies the actual
  `db/schema.sql` to the real local D1 instance — the same file
  `npm run db:migrate` runs against a real database. Real D1's `.exec()`
  turned out to have several constraints the hand-formatted schema.sql
  doesn't naturally satisfy (worth recording since they're easy to hit
  again): it runs exactly one statement per call (no `;`-batching, even
  one-per-line), and a statement can't itself span multiple physical
  lines. None of this touches the DDL — comments and `PRAGMA` lines are
  stripped, each statement's internal whitespace is collapsed to single
  spaces, and every statement is executed individually, in schema order.
- **`worker/src/test/env.d.ts` / `sql-raw.d.ts`** (new, type-only): augment
  `cloudflare:test`'s ambient `Cloudflare.Env` with this project's real
  `Env` interface (so `env.DB` / `env.KV` in tests are correctly typed,
  not `any`), and declare Vite's `?raw` import suffix used to pull
  `schema.sql` in as a string.
- **`worker/tsconfig.json`**: added `@cloudflare/vitest-pool-workers/types`
  so `tsc --noEmit` understands `cloudflare:test`.
- **Deleted `worker/src/lib/__tests__/fakes.ts`** and rewrote every test
  that used it:
  - `relayAccess.test.ts` — real `users` / `servers` / `server_members` /
    `channels` / `channel_members` rows inserted via real `INSERT`
    statements (respecting real foreign keys), read back through the exact
    SQL `assertRelayAccess` runs in production.
  - `channelMembers.test.ts` — same, plus a test that deletes a channel
    and confirms its `channel_members` rows disappear via the real
    `ON DELETE CASCADE` foreign key (not via the helper's own `DELETE`
    path) — exercising the constraint itself, not just the code that
    happens to also delete rows.
  - `relayRateLimit.test.ts` — real `env.KV`. Each test now uses its own
    userId rather than sharing `'user_1'`, because (see below) this pool
    does not reset storage between individual `it()` blocks the way the
    old fakes' per-test fresh instances implicitly did.
  - `relayCursor.test.ts` — unchanged; it was already exercising real
    `crypto.subtle` HMAC signing with no fake involved.
- **New `worker/src/routes/__tests__/privateChannels.e2e.test.ts`**: a
  genuine HTTP integration test. It calls `SELF.fetch` (the real exported
  Worker) to: log in for real via `/auth/login` (real password hashing,
  real JWT signing) → create a real server and a real private channel via
  `POST /servers` / `POST /servers/:id/channels` → confirm the owner can
  read it on both `servers.ts` and `/relay/*` → add a second real user as
  a real server member (direct DB insert — there's no self-serve join
  flow in this app yet) → confirm they get a real 404 on **both** routers
  despite being a server member → add them via the real Phase 6
  `POST /servers/:id/channels/:chId/members` endpoint → confirm the exact
  same requests now return 200 on both routers, with no new login. This is
  the most direct possible proof the Phase 6 fix works, end to end, with
  nothing simulated.
- **`.github/workflows/deploy-worker.yml`**: added `npm run typecheck` and
  `npm test` steps before `wrangler deploy` — there was no test gate on
  deploys before this.

## A real bug this harness caught immediately

Switching `relayRateLimit.test.ts` from the fake KV to real `env.KV`
surfaced an actual production bug on the first run, not a test-only
artifact:

`checkRelayRateLimit`'s default `windowSec` is `10`, and it calls
`kv.put(key, ..., { expirationTtl: windowSec * 2 })` — `20`. **Real
Cloudflare KV rejects any `expirationTtl` under 60 seconds** (the fake KV
test double had no such check, so this was invisible before). This
function is invoked, with its default `windowSec`, as global middleware on
**every single `/relay/*` request** (`relay.use('*', ...)` in `relay.ts`).
Concretely: every request to the Server Relay surface would have called
`kv.put` with an invalid TTL, thrown, and (with no surrounding try/catch)
turned into an unhandled error on every relay request in production —
the entire Server Relay feature was one KV platform constraint away from
being completely broken.

Fixed in `worker/src/lib/relayRateLimit.ts`: the TTL is now
`Math.max(windowSec * 2, 60)`. Added a regression test
(`relayRateLimit.test.ts`, "a real KV `expirationTtl` under 60s ... does
not throw") specifically pinning this. `POLL_BUCKET_TTL_SEC` (3600) in the
same file was already comfortably above the minimum and needed no change.

This is exactly the class of bug fake test doubles are structurally
unable to catch — they model the interface, not the platform's real
constraints — and is the direct payoff of this phase's "no mocks, no
fakes" instruction.

## Test isolation note

This version of `@cloudflare/vitest-pool-workers` does **not** reset D1/KV
storage between individual `it()` blocks by default the way the old
per-test fake instances implicitly did. Every rewritten test file accounts
for this explicitly: `relayAccess.test.ts` and `channelMembers.test.ts`
`DELETE FROM servers` / `DELETE FROM users` in a top-level `beforeEach`
(cascading away everything else) before reseeding; `relayRateLimit.test.ts`
gives every test its own userId instead of sharing one. Documenting this
here since it's the kind of thing that's easy to reintroduce by copying an
old test's shape without noticing the assumption.

## Test results

```
$ npm run typecheck
(clean, no errors)

$ npm test
 ✓ src/routes/__tests__/privateChannels.e2e.test.ts  (2 tests)
 ✓ src/lib/__tests__/relayAccess.test.ts             (13 tests)
 ✓ src/lib/__tests__/channelMembers.test.ts          (8 tests)
 ✓ src/lib/__tests__/relayRateLimit.test.ts          (5 tests)
 ✓ src/lib/__tests__/relayCursor.test.ts             (4 tests)
 Test Files  5 passed (5)
      Tests  32 passed (32)
```

All real: real D1 (with the real schema), real KV, and — for the e2e file
— a real login and real HTTP requests against the real exported Worker.
