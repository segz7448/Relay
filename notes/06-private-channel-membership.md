# Phase 6 — Private Channel Membership (closes the Phase 5 flagged gap)

## What this closes

Phase 5's notes (`notes/05-relay-security.md`) flagged, and deliberately did not
fix:

> `channels.private` flag has no read-time enforcement ... if channel-level
> restriction becomes a real requirement, it needs a `channel_members` (or
> similar) table and is a schema-touching follow-up, not a Phase 5 fix.

That requirement is now in scope, so this phase adds the table and wires
enforcement everywhere a channel can be read or posted into — not just the
Server Relay surface that originally flagged it.

## What changed

- `worker/src/db/schema.sql`: new `channel_members` table
  (`id, channel_id, user_id, added_at`, unique on `(channel_id, user_id)`) +
  index. Additive `CREATE TABLE IF NOT EXISTS`, applied the same way as the
  rest of the schema (`npm run db:migrate` / `db:migrate:remote`) — no
  destructive statements, safe to run against an existing database.
- `worker/src/lib/channelMembers.ts` (new): the one place that reads/writes
  `channel_members` — `isChannelMember`, `addChannelMember` (idempotent),
  `removeChannelMember`, `listChannelMembers`, and `canReadChannel` (the
  yes/no gate for callers that already have the channel row).
- `worker/src/lib/relayAccess.ts`: the channel query now `LEFT JOIN`s
  `channel_members` and gates on it — `private = 0` channels are unaffected
  (server membership is still the whole gate, exactly as before);
  `private = 1` channels additionally require a `channel_members` row. Kept
  as a single query (not a second round-trip) so the existing
  anti-enumeration property holds: "not a server member," "channel doesn't
  exist," and "private channel you're not in" all still collapse to one
  `null`.
- `worker/src/routes/servers.ts` (the native mutable CRUD router — separate
  from `/relay/*`, untouched by Phase 3-5): the same gap existed here too —
  `GET/POST /:id/channels/:chId/messages` only ever checked server
  membership. Both now resolve the channel through a new `getChannelForUser`
  helper that folds in `canReadChannel`. Channel creation and channel update
  (`POST/PATCH .../channels/:chId`) now grandfather the requesting user into
  `channel_members` whenever `private` is set true, so nobody locks
  themselves out of a channel they just made private. New endpoints:
  `GET/POST /:id/channels/:chId/members` and
  `DELETE /:id/channels/:chId/members/:userId` to manage membership going
  forward (server-relay's read-only router gets none of this — no new way to
  mutate relay state was added there, per the Phase 3 rule).
- Tests: `worker/src/lib/__tests__/fakes.ts` extended to model
  `channel_members` and the new query shape; `relayAccess.test.ts` gained a
  "private channel (Phase 6)" suite (4 tests); new
  `channelMembers.test.ts` (7 tests) exercises the read/write helpers
  directly against a small mutable in-memory D1 double scoped to this file.

## Scope notes

- Server Relay (`/relay/*`) stays strictly read-only — this phase adds no
  mutating relay route. Membership management lives only in `servers.ts`.
- Did not add role/permission checks (e.g. "only admins can manage channel
  members") beyond "must already be able to read the channel" — every other
  mutation in `servers.ts` (member role/permission edits, channel
  edit/delete) already follows that same loose "any server member" model,
  and tightening that project-wide is a separate, broader change than the
  one flagged.

## Test results

```
$ npm run typecheck
(clean, no errors)

$ npm test
 ✓ src/lib/__tests__/relayAccess.test.ts      (13 tests)
 ✓ src/lib/__tests__/channelMembers.test.ts   (7 tests)
 ✓ src/lib/__tests__/relayRateLimit.test.ts   (4 tests)
 ✓ src/lib/__tests__/relayCursor.test.ts      (4 tests)
 Test Files  4 passed (4)
      Tests  28 passed (28)
```

Still no Miniflare/`@cloudflare/vitest-pool-workers` harness in this project
(see Phase 5's notes on that) — these remain plain-Node unit tests against
the real `relayAccess.ts` / `channelMembers.ts` modules the routes import,
with lightweight D1 fakes, not full HTTP integration tests. Standing up the
full Workers test pool is still a separate, larger investment, not part of
this fix.

**UPDATE (Phase 7): fixed — see `notes/07-real-test-harness.md`.** All
tests in this file (and every other test file in the project) were
rewritten against a real D1 database and real KV namespace; the fakes
mentioned above are deleted. A new end-to-end test also exercises this
exact private-channel scenario over real HTTP against the real Worker.
