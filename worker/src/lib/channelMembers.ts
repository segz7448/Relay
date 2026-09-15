// worker/src/lib/channelMembers.ts
//
// PHASE 6 — Private channel membership (closes the Phase 5 flagged gap:
// "channels.private has no read-time enforcement beyond server
// membership ... would need a schema change (channel_members table) if
// ever required"). It's now required, so here it is.
//
// This is the ONE place that reads/writes the `channel_members` table.
// Both the read-only Server Relay surface (relayAccess.ts, inlined as a
// single JOIN for its anti-enumeration query shape) and the native
// mutable servers.ts router (via the helpers below) key off the same
// table, so a user's private-channel access is identical no matter which
// router they hit.
//
// Semantics:
//   - A non-private channel (private = 0) is NOT gated by this table at
//     all — server membership remains sufficient, exactly as before.
//   - A private channel (private = 1) additionally requires a
//     channel_members row for (channel_id, userId).
//   - Adding/removing rows here never touches server_members — losing
//     private-channel access never removes someone from the server, and
//     vice versa. The two membership concepts are independent.

import { uid } from './keys';

export async function isChannelMember(
  db: D1Database,
  channelId: string,
  userId: string,
): Promise<boolean> {
  const row = await db.prepare(
    'SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?'
  ).bind(channelId, userId).first();
  return !!row;
}

/** Idempotent — adding an existing member again is a no-op, not an error. */
export async function addChannelMember(
  db: D1Database,
  channelId: string,
  userId: string,
): Promise<void> {
  await db.prepare(
    'INSERT OR IGNORE INTO channel_members (id, channel_id, user_id, added_at) VALUES (?, ?, ?, ?)'
  ).bind(uid(), channelId, userId, Date.now()).run();
}

export async function removeChannelMember(
  db: D1Database,
  channelId: string,
  userId: string,
): Promise<void> {
  await db.prepare(
    'DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?'
  ).bind(channelId, userId).run();
}

export async function listChannelMembers(
  db: D1Database,
  channelId: string,
): Promise<Array<{ id: string; channel_id: string; user_id: string; added_at: number }>> {
  const rows = await db.prepare(
    'SELECT * FROM channel_members WHERE channel_id = ? ORDER BY added_at ASC'
  ).bind(channelId).all<any>();
  return rows.results ?? [];
}

/**
 * The read-time gate itself, for callers (servers.ts) that already have
 * the channel row in hand and just need the yes/no answer: server
 * membership is checked by the caller first (it always was), this only
 * adds the private-channel check on top.
 */
export async function canReadChannel(
  db: D1Database,
  channel: { id: string; private?: unknown },
  userId: string,
): Promise<boolean> {
  if (!channel.private) return true;
  return isChannelMember(db, channel.id, userId);
}
