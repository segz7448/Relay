# Phase 5 — Server Relay Security: Audit Notes

## What changed

- `worker/src/lib/relayAccess.ts` (new): single `assertRelayAccess(db, userId, target)`
  gate. Replaces the two near-identical `assertServerAccess` / `assertChannelAccess`
  helpers that used to live inline at the bottom of `routes/relay.ts`. Every relay
  route that resolves a server or channel ID now calls this first.
- `worker/src/lib/relayRateLimit.ts`: added `checkRelayPollRateLimit`, a KV token
  bucket keyed by `userId` (capacity 30, refill 1/sec), applied specifically to
  `GET /relay/channels/:id/poll` on top of the existing general per-surface limiter.
- `worker/src/routes/relay.ts`: wired both of the above in; removed the dead
  duplicate helpers; updated file-header comments to describe the Phase 5 design.
- Tests (new — none existed before this phase): `worker/src/lib/__tests__/
  relayAccess.test.ts`, `relayRateLimit.test.ts`, `relayCursor.test.ts`, plus
  `fakes.ts` (minimal in-memory D1/KV doubles). `npm test` (vitest) now runs 17
  tests, all green. `npm run typecheck` (`tsc --noEmit`) is clean.

## Spec prevent-list, mapped to what stops it

| Spec item | Where it's prevented |
|---|---|
| IDOR | `assertRelayAccess` — every route resolves by `(id, verified userId)`, never `id` alone |
| Unauthorized server/channel access | same — membership join is the only way to get a non-null row |
| Cross-user / cross-server / cross-channel leakage | same join, scoped per request; no route ever returns another server's rows |
| Unauthorized member enumeration | `/relay/servers/:id/members` sits behind the same gate as every other route |
| Cursor manipulation | Phase 4's HMAC-signed cursors (`relayCursor.ts`) — now covered by explicit tamper/wrong-secret/malformed tests |
| Replay attacks | out of scope for today's idempotent GET polling (see `relaySigning.ts` header — kept ready, not force-fit onto reads) |
| Message duplication | poll endpoint returns strictly-greater-than-cursor rows only; covered indirectly by cursor tests |
| Unauthorized polling / abuse | general per-surface KV limiter (Phase 4) **+** new poll-specific token bucket (Phase 5) |

## Decisions / things deliberately left alone

- **`channels.private` flag has no read-time enforcement, and this phase does not
  add any.** The column exists in the schema and is settable via the old CRUD
  router (`servers.ts`), but neither that router's own read paths nor the
  reference project (`backend/src/socialGroups.ts` — see its single `isMember
  (groupId, address)` gate) enforce anything beyond server/group-level membership.
  Introducing a channel-level ACL here would be a data-model change the spec
  didn't ask for and the reference doesn't model either. Flagging this explicitly
  rather than silently leaving it: if channel-level restriction becomes a real
  requirement, it needs a `channel_members` (or similar) table and is a
  schema-touching follow-up, not a Phase 5 fix.
  **UPDATE (Phase 6): fixed — see `notes/06-private-channel-membership.md`.**
  The `channel_members` table now exists and both `/relay/*` and `servers.ts`
  enforce it for `private = 1` channels.
- **`router.push('/server/${item.id}')` in `app/(tabs)/relay.jsx` has no matching
  screen in this codebase snapshot.** Not a security issue and not in Phase 5's
  scope (Security Requirements) — the file's own comment attributes wiring the
  Server Relay UI to the real backend to a later phase. Noted here so it isn't
  mistaken for something this phase silently broke.
- **`verifyRelaySignature` / nonce replay guard remains unwired**, as it was
  after Phase 4 — there is still no signed relay-to-worker call in this project
  for it to guard (see `relaySigning.ts` header). Wiring it to a route that
  doesn't need it would add a hard nonce requirement to idempotent GET polling,
  which breaks normal client retry/resume behavior instead of protecting
  anything real.

## Test results

```
$ npm run typecheck
(clean, no errors)

$ npm test
 ✓ src/lib/__tests__/relayCursor.test.ts   (4 tests)
 ✓ src/lib/__tests__/relayRateLimit.test.ts (4 tests)
 ✓ src/lib/__tests__/relayAccess.test.ts    (9 tests)
 Test Files  3 passed (3)
      Tests  17 passed (17)
```

No Miniflare/`@cloudflare/vitest-pool-workers` harness exists in this project, so
these are plain-Node unit tests against minimal D1/KV fakes (`__tests__/fakes.ts`)
rather than a full Worker runtime integration test. They exercise the actual
`relayAccess.ts` / `relayRateLimit.ts` / `relayCursor.ts` modules the routes
import — not reimplementations of the logic — so they do catch regressions in
the real authorization/rate-limit/cursor code, just not in an end-to-end
HTTP-request sense. Standing up the full Workers test pool is a larger,
separate investment flagged as a follow-up, not done here.

**UPDATE (Phase 7): fixed — see `notes/07-real-test-harness.md`.** A real
`@cloudflare/vitest-pool-workers` harness now exists; `fakes.ts` is deleted
and every test above runs against real D1/KV, plus a new real end-to-end
HTTP test. Switching to real KV also surfaced and fixed a genuine
production bug in `checkRelayRateLimit`'s default TTL that the fake KV
had been hiding.
