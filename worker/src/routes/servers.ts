import {
  idempotencyKey,
  priorResource,
  rememberResource,
} from "../lib/idempotency";
import { Hono } from "hono";
import { requireAuth, UserSession } from "../middleware/auth";
import { uid, generateInviteCode } from "../lib/keys";
import {
  addChannelMember,
  canReadChannel,
  listChannelMembers,
  removeChannelMember,
} from "../lib/channelMembers";

const servers = new Hono<{ Bindings: any; Variables: { user: UserSession } }>();
servers.use("*", requireAuth);

// ── List servers (user is a member of) ────────────────────────────────────────
servers.get("/", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const rows = await (c.env.DB as D1Database)
    .prepare(
      `SELECT s.* FROM servers s
     JOIN server_members sm ON sm.server_id = s.id AND sm.user_id = ?
     ORDER BY s.last_activity_at DESC`,
    )
    .bind(userId)
    .all<any>();
  const serverList = rows.results ?? [];

  // Load categories + channels for each server
  const full = await Promise.all(
    serverList.map((s) => enrichServer(c.env.DB, s, userId)),
  );
  return c.json(full);
});

// ── Create server ─────────────────────────────────────────────────────────────
servers.post("/", async (c) => {
  const { userId, name: userName, username } = c.get("user") as UserSession;
  const body = await c.req.json<{
    name: string;
    description?: string;
    iconColor?: string;
    privacy?: string;
  }>();
  if (!body.name?.trim()) return c.json({ error: "name_required" }, 400);

  const db: D1Database = c.env.DB;
  let requestKey: string | null;
  try {
    requestKey = idempotencyKey(c.req.raw);
  } catch {
    return c.json({ error: "invalid_idempotency_key" }, 400);
  }
  const prior = await priorResource(db, userId, requestKey, "create-server");
  if (prior) {
    const r = await db
      .prepare("SELECT * FROM servers WHERE id=? AND owner_id=?")
      .bind(prior.resource_id, userId)
      .first<any>();
    return r
      ? c.json(await enrichServer(db, r, userId))
      : c.json({ error: "idempotency_conflict" }, 409);
  }
  const id = uid();
  const generalCatId = uid();
  const generalChId = uid();
  const now = Date.now();
  const inviteCode = generateInviteCode();
  const memberId = uid();

  // Server
  await db
    .prepare(
      `INSERT INTO servers (id, owner_id, name, description, icon_color, privacy, invite_code, last_activity_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      userId,
      body.name.trim(),
      body.description ?? "",
      body.iconColor ?? "#3D6E8A",
      body.privacy ?? "private",
      inviteCode,
      now,
      now,
      now,
    )
    .run();

  // Default category
  await db
    .prepare(
      "INSERT INTO server_categories (id, server_id, name, position) VALUES (?, ?, ?, 0)",
    )
    .bind(generalCatId, id, "General")
    .run();

  // Default general channel
  await db
    .prepare(
      "INSERT INTO channels (id, server_id, category_id, name, type, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(generalChId, id, generalCatId, "general", "general", now)
    .run();

  // Owner as member
  await db
    .prepare(
      "INSERT INTO server_members (id, server_id, user_id, name, username, role, online, joined_at, permissions) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)",
    )
    .bind(
      memberId,
      id,
      userId,
      userName,
      username,
      "owner",
      now,
      JSON.stringify({ administrator: true }),
    )
    .run();

  await rememberResource(db, userId, requestKey, "create-server", id);
  const server = await db
    .prepare("SELECT * FROM servers WHERE id = ?")
    .bind(id)
    .first<any>();
  return c.json(await enrichServer(db, server!, userId), 201);
});

// ── Get server ────────────────────────────────────────────────────────────────
servers.get("/:id", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const server = await getServer(c.env.DB, c.req.param("id"), userId);
  if (!server) return c.json({ error: "not_found" }, 404);
  return c.json(await enrichServer(c.env.DB, server, userId));
});

// ── Update server ─────────────────────────────────────────────────────────────
servers.patch("/:id", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const server = await getServer(c.env.DB, c.req.param("id"), userId);
  if (!server) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json<Record<string, unknown>>();
  const allowed = [
    "name",
    "description",
    "icon_color",
    "privacy",
    "muted",
    "unread_count",
  ];
  const updates: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(body)) {
    const col = camelToSnake(k);
    if (allowed.includes(col)) {
      updates.push(`${col} = ?`);
      vals.push(typeof v === "boolean" ? (v ? 1 : 0) : v);
    }
  }
  if (!updates.length) return c.json({ error: "nothing_to_update" }, 400);
  updates.push("updated_at = ?");
  vals.push(Date.now(), server.id);
  await (c.env.DB as D1Database)
    .prepare(`UPDATE servers SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...vals)
    .run();
  const updated = await (c.env.DB as D1Database)
    .prepare("SELECT * FROM servers WHERE id = ?")
    .bind(server.id)
    .first<any>();
  return c.json(await enrichServer(c.env.DB, updated!, userId));
});

// ── Delete server ─────────────────────────────────────────────────────────────
servers.delete("/:id", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const server = await (c.env.DB as D1Database)
    .prepare("SELECT * FROM servers WHERE id = ? AND owner_id = ?")
    .bind(c.req.param("id"), userId)
    .first<any>();
  if (!server) return c.json({ error: "not_found" }, 404);
  await (c.env.DB as D1Database)
    .prepare("DELETE FROM servers WHERE id = ?")
    .bind(server.id)
    .run();
  return c.body(null, 204);
});

// ── Channels ──────────────────────────────────────────────────────────────────
servers.post("/:id/channels", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const server = await getServer(c.env.DB, c.req.param("id"), userId);
  if (!server) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json<{
    name: string;
    type?: string;
    topic?: string;
    categoryId?: string;
    postAccess?: string;
    private?: boolean;
  }>();
  if (!body.name?.trim()) return c.json({ error: "name_required" }, 400);

  const id = uid();
  await (c.env.DB as D1Database)
    .prepare(
      "INSERT INTO channels (id, server_id, category_id, name, type, topic, private, post_access, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      id,
      server.id,
      body.categoryId ?? null,
      body.name.toLowerCase().replace(/\s+/g, "-"),
      body.type ?? "text",
      body.topic ?? "",
      body.private ? 1 : 0,
      body.postAccess ?? "everyone",
      Date.now(),
    )
    .run();

  // PHASE 6: a brand-new private channel starts with nobody able to read
  // it (channel_members starts empty) — always grandfather the creator
  // in so they don't immediately lock themselves out of the channel they
  // just made. Nobody else gets added automatically; that's what the
  // member-management endpoints below are for.
  if (body.private) {
    await addChannelMember(c.env.DB, id, userId);
  }

  const ch = await (c.env.DB as D1Database)
    .prepare("SELECT * FROM channels WHERE id = ?")
    .bind(id)
    .first<any>();
  return c.json(chShape(ch!), 201);
});

servers.patch("/:id/channels/:chId", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const server = await getServer(c.env.DB, c.req.param("id"), userId);
  if (!server) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json<Record<string, unknown>>();
  const allowed = [
    "name",
    "topic",
    "type",
    "post_access",
    "notifications",
    "private",
  ];
  const updates: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(body)) {
    const col = camelToSnake(k);
    if (allowed.includes(col)) {
      updates.push(`${col} = ?`);
      vals.push(v);
    }
  }
  if (!updates.length) return c.json({ error: "nothing_to_update" }, 400);
  vals.push(c.req.param("chId"), server.id);
  await (c.env.DB as D1Database)
    .prepare(
      `UPDATE channels SET ${updates.join(", ")} WHERE id = ? AND server_id = ?`,
    )
    .bind(...vals)
    .run();

  // PHASE 6: same grandfather-in rule as channel creation — if this
  // update is the one flipping the channel to private (regardless of
  // whether it already had other channel_members rows from a previous
  // private period), make sure the person doing it keeps read access.
  // addChannelMember is idempotent so this is a no-op if they're already
  // a member.
  if (body.private) {
    await addChannelMember(c.env.DB, c.req.param("chId"), userId);
  }

  const ch = await (c.env.DB as D1Database)
    .prepare("SELECT * FROM channels WHERE id = ?")
    .bind(c.req.param("chId"))
    .first<any>();
  return c.json(chShape(ch!));
});

servers.delete("/:id/channels/:chId", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const server = await getServer(c.env.DB, c.req.param("id"), userId);
  if (!server) return c.json({ error: "not_found" }, 404);
  await (c.env.DB as D1Database)
    .prepare("DELETE FROM channels WHERE id = ? AND server_id = ?")
    .bind(c.req.param("chId"), server.id)
    .run();
  return c.body(null, 204);
});

// ── Channel messages ──────────────────────────────────────────────────────────
servers.get("/:id/channels/:chId/messages", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const server = await getServer(c.env.DB, c.req.param("id"), userId);
  if (!server) return c.json({ error: "not_found" }, 404);
  // PHASE 6: server membership alone used to be treated as sufficient
  // here, which was the same gap flagged for the relay's read surface —
  // a private channel's messages were readable by any server member.
  // getChannelForUser folds in the channel_members check for channels
  // with private = 1 (see lib/channelMembers.ts).
  const channel = await getChannelForUser(
    c.env.DB,
    server.id,
    c.req.param("chId"),
    userId,
  );
  if (!channel) return c.json({ error: "not_found" }, 404);
  const limit = Number(c.req.query("limit") ?? 50);
  const rows = await (c.env.DB as D1Database)
    .prepare(
      "SELECT * FROM channel_messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .bind(c.req.param("chId"), limit)
    .all<any>();
  return c.json((rows.results ?? []).reverse());
});

servers.post("/:id/channels/:chId/messages", async (c) => {
  const { userId, name } = c.get("user") as UserSession;
  const server = await getServer(c.env.DB, c.req.param("id"), userId);
  if (!server) return c.json({ error: "not_found" }, 404);
  // Same gate as the GET above — don't let someone post into a private
  // channel they aren't a member of just because they're in the server.
  const channel = await getChannelForUser(
    c.env.DB,
    server.id,
    c.req.param("chId"),
    userId,
  );
  if (!channel) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json<{
    text?: string;
    attachmentUrl?: string;
    replyToId?: string;
  }>();
  if (!body.text && !body.attachmentUrl)
    return c.json({ error: "content_required" }, 400);

  const id = uid();
  const now = Date.now();
  await (c.env.DB as D1Database)
    .prepare(
      "INSERT INTO channel_messages (id, channel_id, sender_id, sender_name, text, kind, attachment_url, reactions, reply_to_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      id,
      c.req.param("chId"),
      userId,
      name,
      body.text ?? null,
      "text",
      body.attachmentUrl ?? null,
      "{}",
      body.replyToId ?? null,
      now,
    )
    .run();

  await (c.env.DB as D1Database)
    .prepare("UPDATE servers SET last_activity_at = ? WHERE id = ?")
    .bind(now, server.id)
    .run();
  const msg = await (c.env.DB as D1Database)
    .prepare("SELECT * FROM channel_messages WHERE id = ?")
    .bind(id)
    .first<any>();
  return c.json(msg, 201);
});

// ── Members ───────────────────────────────────────────────────────────────────
servers.get("/:id/members", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const server = await getServer(c.env.DB, c.req.param("id"), userId);
  if (!server) return c.json({ error: "not_found" }, 404);
  const rows = await (c.env.DB as D1Database)
    .prepare(
      "SELECT * FROM server_members WHERE server_id = ? ORDER BY role DESC, joined_at ASC",
    )
    .bind(server.id)
    .all<any>();
  return c.json((rows.results ?? []).map(memberShape));
});

servers.patch("/:id/members/:memberId", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const server = await getServer(c.env.DB, c.req.param("id"), userId);
  if (!server) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json<{
    role?: string;
    permissions?: Record<string, boolean>;
  }>();
  const updates: string[] = [];
  const vals: unknown[] = [];
  if (body.role) {
    updates.push("role = ?");
    vals.push(body.role);
  }
  if (body.permissions) {
    updates.push("permissions = ?");
    vals.push(JSON.stringify(body.permissions));
  }
  if (!updates.length) return c.json({ error: "nothing_to_update" }, 400);
  vals.push(c.req.param("memberId"), server.id);
  await (c.env.DB as D1Database)
    .prepare(
      `UPDATE server_members SET ${updates.join(", ")} WHERE id = ? AND server_id = ?`,
    )
    .bind(...vals)
    .run();
  return c.json({ ok: true });
});

servers.delete("/:id/members/:memberId", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const server = await getServer(c.env.DB, c.req.param("id"), userId);
  if (!server) return c.json({ error: "not_found" }, 404);
  await (c.env.DB as D1Database)
    .prepare("DELETE FROM server_members WHERE id = ? AND server_id = ?")
    .bind(c.req.param("memberId"), server.id)
    .run();
  return c.body(null, 204);
});

// ── Private channel membership ──────────────────────────────────────────────
// PHASE 6: management surface for the channel_members table. This is
// part of the native mutable `servers.ts` router — same as everything
// else here — and is NOT exposed anywhere on the read-only `/relay/*`
// router, per the Phase 3 rule that Server Relay adds no way to modify
// relay state.
//
// Access rule, matching every other member/channel mutation already in
// this file (none of which check role beyond "is a member of the
// server"): whoever can already read the channel can manage its
// membership. For a private channel that means an existing channel
// member; for a non-private channel it means any server member (adding
// someone to channel_members on a non-private channel is harmless —
// it's simply not consulted for access — but is allowed so membership
// state carries over cleanly if the channel is made private later).
servers.get("/:id/channels/:chId/members", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const server = await getServer(c.env.DB, c.req.param("id"), userId);
  if (!server) return c.json({ error: "not_found" }, 404);
  const channel = await getChannelForUser(
    c.env.DB,
    server.id,
    c.req.param("chId"),
    userId,
  );
  if (!channel) return c.json({ error: "not_found" }, 404);
  const members = await listChannelMembers(c.env.DB, channel.id);
  return c.json(
    members.map((m) => ({ userId: m.user_id, addedAt: m.added_at })),
  );
});

servers.post("/:id/channels/:chId/members", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const server = await getServer(c.env.DB, c.req.param("id"), userId);
  if (!server) return c.json({ error: "not_found" }, 404);
  const channel = await getChannelForUser(
    c.env.DB,
    server.id,
    c.req.param("chId"),
    userId,
  );
  if (!channel) return c.json({ error: "not_found" }, 404);

  const { userId: targetUserId } = await c.req.json<{ userId?: string }>();
  if (!targetUserId) return c.json({ error: "user_id_required" }, 400);

  // Can only add someone who is already in the server — this table
  // grants channel visibility, not server membership.
  const targetIsServerMember = await (c.env.DB as D1Database)
    .prepare("SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?")
    .bind(server.id, targetUserId)
    .first<any>();
  if (!targetIsServerMember)
    return c.json({ error: "not_a_server_member" }, 400);

  await addChannelMember(c.env.DB, channel.id, targetUserId);
  return c.json({ ok: true }, 201);
});

servers.delete("/:id/channels/:chId/members/:userId", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const server = await getServer(c.env.DB, c.req.param("id"), userId);
  if (!server) return c.json({ error: "not_found" }, 404);
  const channel = await getChannelForUser(
    c.env.DB,
    server.id,
    c.req.param("chId"),
    userId,
  );
  if (!channel) return c.json({ error: "not_found" }, 404);
  await removeChannelMember(c.env.DB, channel.id, c.req.param("userId"));
  return c.body(null, 204);
});

servers.post("/:id/members", async (c) => {
  const { userId } = c.get("user");
  const server = await getServer(c.env.DB, c.req.param("id"), userId);
  if (!server) return c.json({ error: "not_found" }, 404);
  const {
    userId: targetId,
    role = "member",
    permissions = {},
  } = await c.req.json<{
    userId?: string;
    role?: string;
    permissions?: Record<string, boolean>;
  }>();
  const u = targetId
    ? await c.env.DB.prepare("SELECT * FROM users WHERE id=?")
        .bind(targetId)
        .first()
    : null;
  if (!u) return c.json({ error: "user_not_found" }, 404);
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO server_members(id,server_id,user_id,name,username,role,online,joined_at,permissions)VALUES(?,?,?,?,?,?,0,?,?)",
  )
    .bind(
      uid(),
      server.id,
      u.id,
      u.name,
      u.username,
      role,
      Date.now(),
      JSON.stringify(permissions),
    )
    .run();
  return c.json({ ok: true }, 201);
});
servers.get("/:id/bots", async (c) => {
  const { userId } = c.get("user");
  const server = await getServer(c.env.DB, c.req.param("id"), userId);
  if (!server) return c.json({ error: "not_found" }, 404);
  const rows = await c.env.DB.prepare(
    "SELECT b.id,b.name,b.username FROM server_bots sb JOIN bots b ON b.id=sb.bot_id WHERE sb.server_id=? AND b.user_id=?",
  )
    .bind(server.id, userId)
    .all();
  return c.json(rows.results ?? []);
});
servers.post("/:id/bots", async (c) => {
  const { userId } = c.get("user");
  const server = await getServer(c.env.DB, c.req.param("id"), userId);
  if (!server) return c.json({ error: "not_found" }, 404);
  const { botId } = await c.req.json<{ botId?: string }>();
  const bot = botId
    ? await c.env.DB.prepare("SELECT id FROM bots WHERE id=? AND user_id=?")
        .bind(botId, userId)
        .first()
    : null;
  if (!bot) return c.json({ error: "bot_not_found" }, 404);
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO server_bots(server_id,bot_id,added_by,created_at)VALUES(?,?,?,?)",
  )
    .bind(server.id, botId, userId, Date.now())
    .run();
  return c.json({ ok: true }, 201);
});

servers.delete("/:id/bots/:botId", async (c) => {
  const { userId } = c.get("user");
  const server = await getServer(c.env.DB, c.req.param("id"), userId);
  if (!server) return c.json({ error: "not_found" }, 404);
  await c.env.DB.prepare(
    "DELETE FROM server_bots WHERE server_id=? AND bot_id IN(SELECT id FROM bots WHERE id=? AND user_id=?)",
  )
    .bind(server.id, c.req.param("botId"), userId)
    .run();
  return c.body(null, 204);
});

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getServer(db: D1Database, serverId: string, userId: string) {
  return db
    .prepare(
      `SELECT s.* FROM servers s JOIN server_members sm ON sm.server_id = s.id AND sm.user_id = ? WHERE s.id = ?`,
    )
    .bind(userId, serverId)
    .first<any>();
}

// PHASE 6: resolves a channel the same way getServer resolves a server —
// return the row if, and only if, `userId` is allowed to read it; null
// for "not a server member", "no such channel", and "private channel
// you're not in" alike (see canReadChannel / lib/channelMembers.ts).
async function getChannelForUser(
  db: D1Database,
  serverId: string,
  channelId: string,
  userId: string,
) {
  const channel = await db
    .prepare("SELECT * FROM channels WHERE id = ? AND server_id = ?")
    .bind(channelId, serverId)
    .first<any>();
  if (!channel) return null;
  if (!(await canReadChannel(db, channel, userId))) return null;
  return channel;
}

async function enrichServer(db: D1Database, server: any, userId: string) {
  const [cats, members] = await Promise.all([
    db
      .prepare(
        "SELECT * FROM server_categories WHERE server_id = ? ORDER BY position ASC",
      )
      .bind(server.id)
      .all<any>(),
    db
      .prepare(
        "SELECT * FROM server_members WHERE server_id = ? ORDER BY role DESC",
      )
      .bind(server.id)
      .all<any>(),
  ]);

  const categoryList = cats.results ?? [];
  const channelRows = await db
    .prepare(
      "SELECT * FROM channels WHERE server_id = ? ORDER BY created_at ASC",
    )
    .bind(server.id)
    .all<any>();
  const allChannels = channelRows.results ?? [];

  const categories = categoryList.map((cat: any) => ({
    id: cat.id,
    name: cat.name,
    channels: allChannels
      .filter((ch: any) => ch.category_id === cat.id)
      .map(chShape),
  }));

  const uncategorized = allChannels
    .filter((ch: any) => !ch.category_id)
    .map(chShape);

  const member = (members.results ?? []).find((m: any) => m.user_id === userId);

  return {
    id: server.id,
    name: server.name,
    description: server.description,
    icon: null,
    iconColor: server.icon_color,
    privacy: server.privacy,
    inviteCode: server.invite_code,
    ownerId: server.owner_id,
    createdAt: server.created_at,
    lastActivityAt: server.last_activity_at,
    unreadCount: server.unread_count,
    muted: !!server.muted,
    categories,
    uncategorized,
    members: (members.results ?? []).map(memberShape),
    myRole: member?.role ?? "member",
  };
}

function chShape(ch: any) {
  return {
    id: ch.id,
    name: ch.name,
    type: ch.type,
    topic: ch.topic,
    unread: ch.unread_count,
    private: !!ch.private,
    postAccess: ch.post_access,
    notifications: ch.notifications,
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
    permissions: JSON.parse(m.permissions || "{}"),
  };
}

function camelToSnake(s: string) {
  return s.replace(/([A-Z])/g, "_$1").toLowerCase();
}

export default servers;
