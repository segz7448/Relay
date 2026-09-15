// worker/src/routes/relay.ts
//
// SERVER RELAY — READ ONLY.
//
// This router is the entire Server Relay API surface. It exposes GET
// requests only. There is intentionally no create/update/delete of any
// kind here — no create server, no edit channel, no send message, no
// kick member. If a future change needs a write operation for servers/
// channels/members, it does NOT belong in this file; this file must stay
// read-only per spec.
//
// Authorization: every route below resolves the requesting user's
// membership via `server_members` (or the channel's parent server's
// membership) before returning anything. Nothing is ever looked up by a
// bare ID supplied by the client without checking that join first — that
// is what prevents IDOR / cross-user / cross-server / cross-channel reads.
//
// Data model reuse note (see notes/02-relay-vs-servers-discrepancy.md from
// the Phase 1 discovery pass): this reuses the existing `servers` /
// `server_categories` / `channels` / `channel_messages` / `server_members`
// tables — they already have the right shape for this feature. What was
// missing was a route surface that only ever reads them. `servers.ts`
// (the pre-existing mutable CRUD router) is left completely untouched by
// this file and continues to serve its own `/servers` mount; this router
// mounts separately at `/relay` and the frontend's Server Relay screen
// now talks to `/relay`, not `/servers`.
//
// PHASE 4 additions (reference architecture ported from the second ZIP's
// Automaton Social Relay — see lib/relaySigning.ts, lib/relayCursor.ts,
// lib/relayPagination.ts, lib/relayRateLimit.ts, lib/relayErrors.ts for
// what was ported, what was deliberately left out, and why):
//   - opaque cursors are now HMAC-signed (relayCursor.ts) so they can't be
//     hand-edited to skip pagination/authorization bounds
//   - the `{ items, nextCursor, hasMore }` page shape is now shared across
//     every relay list endpoint, not just messages (relayPagination.ts)
//   - a per-user KV rate limit applies to the whole /relay/* surface
//     (relayRateLimit.ts) — full authorization hardening lands in Phase 5
//   - message `text` is defensively size-capped on the way out
//     (relayPagination.ts guardMessageText)
//   - every error response uses one structured shape (relayErrors.ts)
//
// PHASE 5 additions (Server Relay Security — see lib/relayAccess.ts for
// the full design note, including the anti-enumeration rule every route
// below follows):
//   - the two ad hoc `assertServerAccess` / `assertChannelAccess`
//     helpers that used to live at the bottom of this file are replaced
//     by one shared gate, `assertRelayAccess`, imported from
//     lib/relayAccess.ts and called first in every route below that
//     touches a server or channel ID. Same query shape, same
//     parameterized `?`-bound D1 calls, same "member row or null"
//     result — just centralized so there's exactly one place this logic
//     can drift from correct.
//   - `userId` is read only from `c.get('user')`, which `requireAuth`
//     populated from the verified session/JWT (middleware/auth.ts) —
//     never from a route param, query string, or request body. This is
//     what makes IDOR-by-guessing-an-id impossible: the id alone is
//     never sufficient, the (id, verified-userId) pair is.
//   - the channel poll endpoint additionally goes through
//     `checkRelayPollRateLimit`, a KV token bucket keyed by userId
//     (lib/relayRateLimit.ts), on top of the general per-surface limiter
//     below — "Unauthorized polling" in the spec's prevent-list is read
//     as "polling used to hammer the backend / abuse an authorized
//     session," which the general limiter already blocks for every
//     relay route; this adds a bucket sized for polling's legitimate
//     call pattern specifically.

import { Hono } from 'hono';
import { requireAuth, UserSession } from '../middleware/auth';
import { encodeCursor, decodeCursor } from '../lib/relayCursor';
import { buildPage, clampLimit, guardMessageText } from '../lib/relayPagination';
import { checkRelayRateLimit, checkRelayPollRateLimit } from '../lib/relayRateLimit';
import { relayError } from '../lib/relayErrors';
import { assertRelayAccess } from '../lib/relayAccess';

const relay = new Hono<{ Bindings: any; Variables: { user: UserSession } }>();
relay.use('*', requireAuth);

// ── Rate limit the whole relay read surface ────────────────────────────────────
relay.use('*', async (c, next) => {
  const { userId } = c.get('user') as UserSession;
  const result = await checkRelayRateLimit(c.env.KV, userId);
  if (!result.allowed) return relayError(c, 'rate_limited');
  await next();
});

// ── List servers the user is authorized to see ─────────────────────────────────
// GET /relay/servers?cursor=<opaque>&limit=50
relay.get('/servers', async (c) => {
  const { userId } = c.get('user') as UserSession;
  const limit = clampLimit(c.req.query('limit'));
  const cursorParam = c.req.query('cursor');

  let cursor: { ts: number; id: string } | null = null;
  if (cursorParam) {
    cursor = await decodeCursor(cursorParam, c.env.JWT_SECRET);
    if (!cursor) return relayError(c, 'invalid_cursor');
  }

  // last_activity_at is nullable in the schema (a brand-new server has
  // none yet) — COALESCE to 0 consistently on both the order/compare side
  // and the cursor we hand back, so a null never produces an unusable cursor.
  const rows = cursor
    ? await (c.env.DB as D1Database).prepare(
        `SELECT s.*,
           (SELECT COUNT(*) FROM server_members sm2 WHERE sm2.server_id = s.id) AS member_count,
           (SELECT COUNT(*) FROM server_members sm3 WHERE sm3.server_id = s.id AND sm3.online = 1) AS online_count
         FROM servers s
         JOIN server_members sm ON sm.server_id = s.id AND sm.user_id = ?
         WHERE (COALESCE(s.last_activity_at, 0) < ? OR (COALESCE(s.last_activity_at, 0) = ? AND s.id < ?))
         ORDER BY COALESCE(s.last_activity_at, 0) DESC, s.id DESC LIMIT ?`
      ).bind(userId, cursor.ts, cursor.ts, cursor.id, limit).all<any>()
    : await (c.env.DB as D1Database).prepare(
        `SELECT s.*,
           (SELECT COUNT(*) FROM server_members sm2 WHERE sm2.server_id = s.id) AS member_count,
           (SELECT COUNT(*) FROM server_members sm3 WHERE sm3.server_id = s.id AND sm3.online = 1) AS online_count
         FROM servers s
         JOIN server_members sm ON sm.server_id = s.id AND sm.user_id = ?
         ORDER BY COALESCE(s.last_activity_at, 0) DESC, s.id DESC LIMIT ?`
      ).bind(userId, limit).all<any>();

  const items = rows.results ?? [];
  const nextCursor = items.length === limit
    ? await encodeCursor({ created_at: items[items.length - 1].last_activity_at ?? 0, id: items[items.length - 1].id }, c.env.JWT_SECRET)
    : null;

  return c.json(buildPage(items.map(serverSummaryShape), limit, nextCursor));
});

// ── Get one server, with categories, channels and members ─────────────────────
relay.get('/servers/:id', async (c) => {
  const { userId } = c.get('user') as UserSession;
  const server = await assertRelayAccess(c.env.DB, userId, { kind: 'server', serverId: c.req.param('id') });
  if (!server) return relayError(c, 'not_found');
  return c.json(await relayServerDetail(c.env.DB, server, userId));
});

// ── Members (read only — no role/permission changes, no kicks) ────────────────
// GET /relay/servers/:id/members?cursor=<opaque>&limit=50
relay.get('/servers/:id/members', async (c) => {
  const { userId } = c.get('user') as UserSession;
  const server = await assertRelayAccess(c.env.DB, userId, { kind: 'server', serverId: c.req.param('id') });
  if (!server) return relayError(c, 'not_found');

  const limit = clampLimit(c.req.query('limit'));
  const cursorParam = c.req.query('cursor');
  let cursor: { ts: number; id: string } | null = null;
  if (cursorParam) {
    cursor = await decodeCursor(cursorParam, c.env.JWT_SECRET);
    if (!cursor) return relayError(c, 'invalid_cursor');
  }

  const rows = cursor
    ? await (c.env.DB as D1Database).prepare(
        `SELECT * FROM server_members
         WHERE server_id = ? AND (joined_at > ? OR (joined_at = ? AND id > ?))
         ORDER BY role DESC, joined_at ASC, id ASC LIMIT ?`
      ).bind(server.id, cursor.ts, cursor.ts, cursor.id, limit).all<any>()
    : await (c.env.DB as D1Database).prepare(
        'SELECT * FROM server_members WHERE server_id = ? ORDER BY role DESC, joined_at ASC, id ASC LIMIT ?'
      ).bind(server.id, limit).all<any>();

  const items = rows.results ?? [];
  const nextCursor = items.length === limit
    ? await encodeCursor({ created_at: items[items.length - 1].joined_at, id: items[items.length - 1].id }, c.env.JWT_SECRET)
    : null;

  return c.json(buildPage(items.map(memberShape), limit, nextCursor));
});

// ── Channels list for a server ─────────────────────────────────────────────────
// GET /relay/servers/:id/channels?cursor=<opaque>&limit=50
relay.get('/servers/:id/channels', async (c) => {
  const { userId } = c.get('user') as UserSession;
  const server = await assertRelayAccess(c.env.DB, userId, { kind: 'server', serverId: c.req.param('id') });
  if (!server) return relayError(c, 'not_found');

  const limit = clampLimit(c.req.query('limit'));
  const cursorParam = c.req.query('cursor');
  let cursor: { ts: number; id: string } | null = null;
  if (cursorParam) {
    cursor = await decodeCursor(cursorParam, c.env.JWT_SECRET);
    if (!cursor) return relayError(c, 'invalid_cursor');
  }

  const rows = cursor
    ? await (c.env.DB as D1Database).prepare(
        `SELECT * FROM channels
         WHERE server_id = ? AND (created_at > ? OR (created_at = ? AND id > ?))
         ORDER BY created_at ASC, id ASC LIMIT ?`
      ).bind(server.id, cursor.ts, cursor.ts, cursor.id, limit).all<any>()
    : await (c.env.DB as D1Database).prepare(
        'SELECT * FROM channels WHERE server_id = ? ORDER BY created_at ASC, id ASC LIMIT ?'
      ).bind(server.id, limit).all<any>();

  const items = rows.results ?? [];
  const nextCursor = items.length === limit
    ? await encodeCursor({ created_at: items[items.length - 1].created_at, id: items[items.length - 1].id }, c.env.JWT_SECRET)
    : null;

  return c.json(buildPage(items.map(channelShape), limit, nextCursor));
});

// ── Single channel info ─────────────────────────────────────────────────────────
relay.get('/channels/:id', async (c) => {
  const { userId } = c.get('user') as UserSession;
  const channel = await assertRelayAccess(c.env.DB, userId, { kind: 'channel', channelId: c.req.param('id') });
  if (!channel) return relayError(c, 'not_found');
  return c.json(channelShape(channel));
});

// ── Channel message history (paginated, newest-first cursor) ──────────────────
// GET /relay/channels/:id/messages?cursor=<opaque>&limit=50
// Returns items in ascending (chat-reading) order plus an opaque nextCursor
// for the next older page. First page omits `cursor`.
relay.get('/channels/:id/messages', async (c) => {
  const { userId } = c.get('user') as UserSession;
  const channel = await assertRelayAccess(c.env.DB, userId, { kind: 'channel', channelId: c.req.param('id') });
  if (!channel) return relayError(c, 'not_found');

  const limit = clampLimit(c.req.query('limit'));
  const cursorParam = c.req.query('cursor');

  let rows;
  if (cursorParam) {
    const decoded = await decodeCursor(cursorParam, c.env.JWT_SECRET);
    if (!decoded) return relayError(c, 'invalid_cursor');
    rows = await (c.env.DB as D1Database).prepare(
      `SELECT * FROM channel_messages
       WHERE channel_id = ? AND (created_at < ? OR (created_at = ? AND id < ?))
       ORDER BY created_at DESC, id DESC LIMIT ?`
    ).bind(channel.id, decoded.ts, decoded.ts, decoded.id, limit).all<any>();
  } else {
    rows = await (c.env.DB as D1Database).prepare(
      'SELECT * FROM channel_messages WHERE channel_id = ? ORDER BY created_at DESC, id DESC LIMIT ?'
    ).bind(channel.id, limit).all<any>();
  }

  const items = rows.results ?? [];
  const nextCursor = items.length === limit
    ? await encodeCursor(items[items.length - 1], c.env.JWT_SECRET)
    : null;

  const page = buildPage([...items].reverse().map(messageShape), limit, nextCursor); // ascending order for rendering
  return c.json(page);
});

// ── Poll for new messages since a cursor ────────────────────────────────────────
// GET /relay/channels/:id/poll?since=<opaque>
// `since` should be the cursor the client already has (e.g. the id/createdAt of
// the newest message it has rendered). Returns only messages strictly newer than
// that cursor, in ascending order, plus the new cursor to poll from next time —
// this is what prevents duplicate delivery on repeated polls.
relay.get('/channels/:id/poll', async (c) => {
  const { userId } = c.get('user') as UserSession;

  // PHASE 5: poll-specific token bucket, on top of the general
  // /relay/* limiter above — see file header and relayRateLimit.ts.
  // Checked before the authorization query so a caller spamming polls
  // for a channel they're not even a member of still gets throttled by
  // this cheaper KV check rather than repeatedly driving a D1 query.
  const bucket = await checkRelayPollRateLimit(c.env.KV, userId);
  if (!bucket.allowed) return relayError(c, 'rate_limited');

  const channel = await assertRelayAccess(c.env.DB, userId, { kind: 'channel', channelId: c.req.param('id') });
  if (!channel) return relayError(c, 'not_found');

  const sinceParam = c.req.query('since');
  let rows;
  if (sinceParam) {
    const decoded = await decodeCursor(sinceParam, c.env.JWT_SECRET);
    if (!decoded) return relayError(c, 'invalid_cursor');
    rows = await (c.env.DB as D1Database).prepare(
      `SELECT * FROM channel_messages
       WHERE channel_id = ? AND (created_at > ? OR (created_at = ? AND id > ?))
       ORDER BY created_at ASC, id ASC LIMIT 100`
    ).bind(channel.id, decoded.ts, decoded.ts, decoded.id).all<any>();
  } else {
    // No cursor yet — hand back just the latest message as an initial sync
    // point rather than the whole history (history comes from /messages).
    rows = await (c.env.DB as D1Database).prepare(
      'SELECT * FROM channel_messages WHERE channel_id = ? ORDER BY created_at DESC, id DESC LIMIT 1'
    ).bind(channel.id).all<any>();
  }

  const items = rows.results ?? [];
  const nextCursor = items.length
    ? await encodeCursor(items[items.length - 1], c.env.JWT_SECRET)
    : (sinceParam ?? null);
  return c.json({ items: items.map(messageShape), nextCursor });
});

// ── Shapes ────────────────────────────────────────────────────────────────────
// Authorization is now handled entirely by `assertRelayAccess` (see
// lib/relayAccess.ts, imported above) — it replaces the two inline
// `assertServerAccess` / `assertChannelAccess` helpers that used to live
// here in Phase 3/4.
function serverSummaryShape(s: any) {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    icon: s.icon_url ?? null,
    iconColor: s.icon_color,
    privacy: s.privacy,
    unreadCount: s.unread_count,
    muted: !!s.muted,
    memberCount: s.member_count ?? 0,
    onlineCount: s.online_count ?? 0,
    lastActivityAt: s.last_activity_at,
    createdAt: s.created_at,
  };
}

async function relayServerDetail(db: D1Database, server: any, userId: string) {
  const [cats, channelRows, members] = await Promise.all([
    db.prepare('SELECT * FROM server_categories WHERE server_id = ? ORDER BY position ASC').bind(server.id).all<any>(),
    db.prepare('SELECT * FROM channels WHERE server_id = ? ORDER BY created_at ASC').bind(server.id).all<any>(),
    db.prepare('SELECT * FROM server_members WHERE server_id = ? ORDER BY role DESC, joined_at ASC').bind(server.id).all<any>(),
  ]);

  const allChannels = (channelRows.results ?? []).map(channelShape);
  const categories = (cats.results ?? []).map((cat: any) => ({
    id: cat.id,
    name: cat.name,
    channels: allChannels.filter((ch: any) => ch.categoryId === cat.id),
  }));
  const uncategorized = allChannels.filter((ch: any) => !ch.categoryId);
  const memberList = members.results ?? [];
  const me = memberList.find((m: any) => m.user_id === userId);

  return {
    id: server.id,
    name: server.name,
    description: server.description,
    icon: server.icon_url ?? null,
    iconColor: server.icon_color,
    privacy: server.privacy,
    unreadCount: server.unread_count,
    muted: !!server.muted,
    lastActivityAt: server.last_activity_at,
    createdAt: server.created_at,
    categories,
    uncategorized,
    members: memberList.map(memberShape),
    memberCount: memberList.length,
    onlineCount: memberList.filter((m: any) => m.online).length,
    myRole: me?.role ?? 'member',
  };
}

function channelShape(ch: any) {
  return {
    id: ch.id,
    serverId: ch.server_id,
    categoryId: ch.category_id,
    name: ch.name,
    type: ch.type,
    topic: ch.topic,
    private: !!ch.private,
    notifications: ch.notifications,
    unreadCount: ch.unread_count,
    createdAt: ch.created_at,
  };
}

function memberShape(m: any) {
  return {
    id: m.id,
    userId: m.user_id,
    name: m.name,
    username: m.username,
    avatarColor: m.avatar_color,
    role: m.role,
    online: !!m.online,
    joinedAt: m.joined_at,
  };
}

function messageShape(m: any) {
  const { text, truncated } = guardMessageText(m.text);
  return {
    id: m.id,
    channelId: m.channel_id,
    senderId: m.sender_id,
    senderName: m.sender_name,
    text,
    truncated,
    kind: m.kind,
    attachmentUrl: m.attachment_url,
    reactions: JSON.parse(m.reactions || '{}'),
    replyToId: m.reply_to_id,
    createdAt: m.created_at,
  };
}

export default relay;
