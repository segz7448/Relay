// worker/src/lib/relayAccess.ts
//
// PHASE 5 — SERVER RELAY SECURITY
// PHASE 6 — private-channel read enforcement (see below)
//
// Single authorization gate for the whole Server Relay read surface, per
// spec: "Every relay read must be authenticated and authorized ... Verify
// authorization on the server. Do not trust owner IDs supplied by the
// client."
//
// This replaces the two structurally-identical `assertServerAccess` /
// `assertChannelAccess` helpers that previously lived inline in
// routes/relay.ts (Phase 3/4) with one entry point, so every relay route
// goes through the same check, in the same shape, with the same
// anti-enumeration behavior. Reference pattern: this mirrors the
// second ZIP's `isMember(groupId, address)` gate (backend/src/
// socialGroups.ts) — one membership check, called first, in every route
// — adapted to this project's D1 schema (`server_members`) and
// session-derived `userId` instead of a wallet address.
//
// ── Anti-enumeration note ───────────────────────────────────────────────
// A request for a server/channel the user is not a member of, and a
// request for a server/channel that does not exist at all, return the
// exact same result from this function (`null`) — and therefore MUST
// produce the exact same route response (`relayError(c, 'not_found')`).
// This is deliberate: spec says "A user must not be able to access relay
// data simply by knowing an ID." If unauthorized access returned a
// distinct 403 while a nonexistent ID returned 404, that status-code
// difference would itself be an oracle an attacker could use to
// enumerate which server/channel IDs exist. Every relay route MUST treat
// a null result from `assertRelayAccess` the same way — never branch
// differently for "exists but not yours" vs. "doesn't exist."
//
// ── userId provenance ───────────────────────────────────────────────────
// `userId` is never accepted from a request body or query param here —
// every caller must pass the `userId` that `requireAuth` derived from the
// verified session/JWT (see middleware/auth.ts). Passing a
// client-supplied value in would defeat the entire point of this gate;
// that is also why this function takes `userId` as a plain argument
// rather than reading it off the request itself — it forces every call
// site to be explicit about where the value came from.
//
// ── Query safety ─────────────────────────────────────────────────────────
// Both queries below are parameterized (`?`-bound via `.bind(...)`) —
// never string-concatenated — per spec: "Use parameterized database
// queries."
//
// ── PHASE 6: private-channel gate ──────────────────────────────────────
// Phase 5 shipped this note as a known gap: "channels.private has no
// read-time enforcement beyond server membership ... would need a schema
// change (channel_members table) if ever required." That table now
// exists (see migrations in db/schema.sql + lib/channelMembers.ts), so
// the channel query below adds one more condition on top of the existing
// server-membership join: a channel with `private = 0` is unaffected
// (server membership is still the whole gate, exactly as before); a
// channel with `private = 1` additionally requires a `channel_members`
// row for (channelId, userId). This is folded into the SAME query rather
// than a second round-trip so the anti-enumeration property above still
// holds — "not a server member", "channel doesn't exist", and "private
// channel you're not in" all still collapse to one `null`, in one query,
// with no timing or branching difference between them.

export type RelayAccessTarget =
  | { kind: 'server'; serverId: string }
  | { kind: 'channel'; channelId: string };

/**
 * Resolve + authorize a relay target in one step. Returns the row
 * (server or channel) if, and only if, `userId` is a verified member of
 * the server that owns it. Returns `null` for "not a member" and
 * "doesn't exist" alike — see anti-enumeration note above. Callers must
 * map a `null` result to `relayError(c, 'not_found')` and nothing else.
 */
export async function assertRelayAccess(
  db: D1Database,
  userId: string,
  target: RelayAccessTarget,
): Promise<any | null> {
  if (target.kind === 'server') {
    return db.prepare(
      `SELECT s.* FROM servers s
       JOIN server_members sm ON sm.server_id = s.id AND sm.user_id = ?
       WHERE s.id = ?`
    ).bind(userId, target.serverId).first<any>();
  }

  return db.prepare(
    `SELECT ch.* FROM channels ch
     JOIN server_members sm ON sm.server_id = ch.server_id AND sm.user_id = ?
     LEFT JOIN channel_members cm ON cm.channel_id = ch.id AND cm.user_id = ?
     WHERE ch.id = ? AND (ch.private = 0 OR cm.user_id IS NOT NULL)`
  ).bind(userId, userId, target.channelId).first<any>();
}

/**
 * Membership-only check (no row returned) — for the rare case a route
 * already has the server/channel row from elsewhere (e.g. a second query
 * scoped to a server it already resolved) and only needs the yes/no
 * gate again rather than re-fetching the row.
 */
export async function isRelayMember(
  db: D1Database,
  userId: string,
  serverId: string,
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?`
  ).bind(serverId, userId).first();
  return !!row;
}
