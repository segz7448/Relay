import { Hono } from "hono";
import { requireAuth, UserSession } from "../middleware/auth";
import { uid } from "../lib/keys";
import { sendFCMToTokens, messagePayload } from "../lib/fcm";

const messages = new Hono<{
  Bindings: any;
  Variables: { user: UserSession };
}>();
messages.use("*", requireAuth);

// ── GET /conversations ────────────────────────────────────────────────────────
messages.get("/", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const rows = await (c.env.DB as D1Database)
    .prepare(
      `SELECT c.*, u.photo_url AS peer_photo_url FROM conversations c LEFT JOIN users u ON c.kind='direct' AND u.id=c.ref_id WHERE c.user_id = ? ORDER BY c.pinned DESC, c.last_message_at DESC NULLS LAST`,
    )
    .bind(userId)
    .all<any>();
  return c.json((rows.results ?? []).map(convShape));
});

// ── POST /conversations ───────────────────────────────────────────────────────
messages.post("/", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const body = await c.req.json<{
    kind: string;
    name: string;
    avatarColor?: string;
    bio?: string;
    refId?: string;
  }>();
  const id = uid();
  const now = Date.now();
  await (c.env.DB as D1Database)
    .prepare(
      `INSERT INTO conversations (id, user_id, kind, name, avatar_color, bio, pinned, muted, unread_count,
     ref_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?)`,
    )
    .bind(
      id,
      userId,
      body.kind,
      body.name,
      body.avatarColor ?? "#2E4A3E",
      body.bio ?? "",
      body.refId ?? null,
      now,
      now,
    )
    .run();
  const conv = await (c.env.DB as D1Database)
    .prepare("SELECT * FROM conversations WHERE id = ?")
    .bind(id)
    .first<any>();
  return c.json(convShape(conv!), 201);
});

// ── GET /conversations/search?q=&kinds=image,video ───────────────────────────
// Full-text-ish search (SQL LIKE) across every message the user owns,
// scoped by their conversations. Returns rows already shaped for the
// Search screen: text matches and, separately, attachment matches.
messages.get("/search", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const q = (c.req.query("q") ?? "").trim();
  const kinds = (c.req.query("kinds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const db = c.env.DB as D1Database;

  const like = `%${q}%`;
  const textRows = q
    ? await db
        .prepare(
          `SELECT m.*, cv.name AS conversation_name FROM messages m
         JOIN conversations cv ON cv.id = m.conversation_id
         WHERE cv.user_id = ? AND m.text LIKE ? ORDER BY m.created_at DESC LIMIT 100`,
        )
        .bind(userId, like)
        .all<any>()
    : await db
        .prepare(
          `SELECT m.*, cv.name AS conversation_name FROM messages m
         JOIN conversations cv ON cv.id = m.conversation_id
         WHERE cv.user_id = ? ORDER BY m.created_at DESC LIMIT 100`,
        )
        .bind(userId)
        .all<any>();

  let fileQuery = `SELECT m.*, cv.name AS conversation_name FROM messages m
     JOIN conversations cv ON cv.id = m.conversation_id
     WHERE cv.user_id = ? AND m.attachment_url IS NOT NULL`;
  const fileArgs: unknown[] = [userId];
  if (q) {
    fileQuery += " AND (m.attachment_name LIKE ? OR m.text LIKE ?)";
    fileArgs.push(like, like);
  }
  if (kinds.length) {
    fileQuery += ` AND m.attachment_type IN (${kinds.map(() => "?").join(",")})`;
    fileArgs.push(...kinds);
  }
  fileQuery += " ORDER BY m.created_at DESC LIMIT 100";
  const fileRows = await db
    .prepare(fileQuery)
    .bind(...fileArgs)
    .all<any>();

  return c.json({
    messages: (textRows.results ?? [])
      .filter((m: any) => m.text)
      .map(searchMsgShape),
    files: (fileRows.results ?? []).map(searchMsgShape),
  });
});

// ── GET /conversations/:id ────────────────────────────────────────────────────
messages.get("/:id", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const conv = await getConv(c.env.DB, c.req.param("id"), userId);
  if (!conv) return c.json({ error: "not_found" }, 404);
  return c.json(convShape(conv));
});

// ── PATCH /conversations/:id — pin, mute, mark read ──────────────────────────
messages.patch("/:id", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const conv = await getConv(c.env.DB, c.req.param("id"), userId);
  if (!conv) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json<{
    pinned?: boolean;
    muted?: boolean;
    unreadCount?: number;
  }>();
  const updates: string[] = [];
  const vals: unknown[] = [];
  if (body.pinned !== undefined) {
    updates.push("pinned = ?");
    vals.push(body.pinned ? 1 : 0);
  }
  if (body.muted !== undefined) {
    updates.push("muted = ?");
    vals.push(body.muted ? 1 : 0);
  }
  if (body.unreadCount !== undefined) {
    updates.push("unread_count = ?");
    vals.push(body.unreadCount);
  }
  if (!updates.length) return c.json({ error: "nothing_to_update" }, 400);

  updates.push("updated_at = ?");
  vals.push(Date.now(), conv.id, userId);
  await (c.env.DB as D1Database)
    .prepare(
      `UPDATE conversations SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`,
    )
    .bind(...vals)
    .run();
  const updated = await (c.env.DB as D1Database)
    .prepare("SELECT * FROM conversations WHERE id = ?")
    .bind(conv.id)
    .first<any>();
  return c.json(convShape(updated!));
});

// ── GET /conversations/:id/messages ───────────────────────────────────────────
messages.get("/:id/messages", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const conv = await getConv(c.env.DB, c.req.param("id"), userId);
  if (!conv) return c.json({ error: "not_found" }, 404);

  const limit = Number(c.req.query("limit") ?? 50);
  const before = c.req.query("before"); // cursor: created_at of last message

  const rows = before
    ? await (c.env.DB as D1Database)
        .prepare(
          "SELECT * FROM messages WHERE conversation_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?",
        )
        .bind(conv.id, Number(before), limit)
        .all<any>()
    : await (c.env.DB as D1Database)
        .prepare(
          "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .bind(conv.id, limit)
        .all<any>();

  const msgs = (rows.results ?? []).reverse().map(msgShape);
  return c.json({ messages: msgs, hasMore: msgs.length === limit });
});

// ── POST /conversations/:id/messages — send a message ────────────────────────
messages.post("/:id/messages", async (c) => {
  const { userId, name } = c.get("user") as UserSession;
  const conv = await getConv(c.env.DB, c.req.param("id"), userId);
  if (!conv) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json<{
    text?: string;
    kind?: string;
    attachmentUrl?: string;
    attachmentType?: string;
    attachmentName?: string;
    attachmentSize?: number;
    durationSec?: number;
    replyToId?: string;
  }>();

  if (!body.text && !body.attachmentUrl)
    return c.json({ error: "text_or_attachment_required" }, 400);

  const id = uid();
  const now = Date.now();
  await (c.env.DB as D1Database)
    .prepare(
      `INSERT INTO messages (id, conversation_id, sender_id, sender_name, text, kind,
     attachment_url, attachment_type, attachment_name, attachment_size, duration_sec,
     reply_to_id, reactions, read, delivered, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', 0, 1, ?)`,
    )
    .bind(
      id,
      conv.id,
      userId,
      name,
      body.text ?? null,
      body.kind ?? "text",
      body.attachmentUrl ?? null,
      body.attachmentType ?? null,
      body.attachmentName ?? null,
      body.attachmentSize ?? null,
      body.durationSec ?? null,
      body.replyToId ?? null,
      now,
    )
    .run();

  // Update conversation last message
  const preview =
    body.text ??
    (body.kind === "voice"
      ? "🎤 Voice message"
      : `📎 ${body.attachmentName ?? "Attachment"}`);
  await (c.env.DB as D1Database)
    .prepare(
      "UPDATE conversations SET last_message = ?, last_message_at = ?, updated_at = ? WHERE id = ?",
    )
    .bind(preview, now, now, conv.id)
    .run();

  const msg = await (c.env.DB as D1Database)
    .prepare("SELECT * FROM messages WHERE id = ?")
    .bind(id)
    .first<any>();

  // FCM push — send to all other sessions of the conversation's ref user
  if (c.env.FCM_SERVER_KEY && body.text) {
    c.executionCtx?.waitUntil(
      pushToConvParticipants(c.env, conv, userId, name, preview),
    );
  }

  return c.json(msgShape(msg!), 201);
});

// ── POST /conversations/:id/messages/:msgId/reactions ─────────────────────────
messages.post("/:id/messages/:msgId/reactions", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const conv = await getConv(c.env.DB, c.req.param("id"), userId);
  if (!conv) return c.json({ error: "not_found" }, 404);

  const { emoji } = await c.req.json<{ emoji: string }>();
  const db = c.env.DB as D1Database;
  const msg = await db
    .prepare("SELECT * FROM messages WHERE id = ? AND conversation_id = ?")
    .bind(c.req.param("msgId"), conv.id)
    .first<any>();
  if (!msg) return c.json({ error: "not_found" }, 404);

  const reactions = JSON.parse(msg.reactions || "{}");
  if (!reactions[emoji]) reactions[emoji] = [];
  if (reactions[emoji].includes(userId)) {
    reactions[emoji] = reactions[emoji].filter((u: string) => u !== userId);
    if (reactions[emoji].length === 0) delete reactions[emoji];
  } else {
    reactions[emoji].push(userId);
  }
  await db
    .prepare("UPDATE messages SET reactions = ? WHERE id = ?")
    .bind(JSON.stringify(reactions), msg.id)
    .run();
  const updated = await db
    .prepare("SELECT * FROM messages WHERE id = ?")
    .bind(msg.id)
    .first<any>();
  return c.json(msgShape(updated!));
});

// ── DELETE /conversations/:id ─────────────────────────────────────────────────
messages.delete("/:id", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const conv = await getConv(c.env.DB, c.req.param("id"), userId);
  if (!conv) return c.json({ error: "not_found" }, 404);
  await (c.env.DB as D1Database)
    .prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?")
    .bind(conv.id, userId)
    .run();
  return c.body(null, 204);
});

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getConv(db: D1Database, id: string, userId: string) {
  return db
    .prepare(
      `SELECT c.*,u.photo_url AS peer_photo_url FROM conversations c LEFT JOIN users u ON c.kind='direct' AND u.id=c.ref_id WHERE c.id=? AND c.user_id=?`,
    )
    .bind(id, userId)
    .first<any>();
}

function convShape(c: any) {
  return {
    id: c.id,
    kind: c.kind,
    name: c.name,
    avatarColor: c.avatar_color,
    bio: c.bio ?? "",
    lastMessage: c.last_message ?? "",
    lastMessageAt: c.last_message_at,
    unread: c.unread_count,
    pinned: !!c.pinned,
    muted: !!c.muted,
    online: !!c.online,
    typing: false,
    attachment: null,
    refId: c.ref_id,
    photoUrl: c.peer_photo_url ?? null,
  };
}

function searchMsgShape(m: any) {
  return {
    messageId: m.id,
    conversationId: m.conversation_id,
    conversationName: m.conversation_name,
    text: m.text ?? "",
    createdAt: m.created_at,
    attachment: m.attachment_url
      ? {
          url: m.attachment_url,
          kind: m.attachment_type,
          name: m.attachment_name,
          ext: (m.attachment_name ?? "").split(".").pop(),
        }
      : null,
  };
}

function msgShape(m: any) {
  const rawReactions = JSON.parse(m.reactions || "{}") as Record<
    string,
    string[]
  >;
  const reactions = Object.entries(rawReactions).flatMap(([emoji, userIds]) =>
    userIds.map((reactorId) => ({
      emoji,
      name:
        reactorId === m.sender_id ? (m.sender_name ?? "You") : "Participant",
      mine: false,
    })),
  );
  return {
    id: m.id,
    conversationId: m.conversation_id,
    senderId: m.sender_id,
    senderName: m.sender_name,
    dir: m.sender_id ? "out" : "in",
    text: m.text,
    kind: m.kind,
    attachmentUrl: m.attachment_url,
    attachmentType: m.attachment_type,
    attachmentName: m.attachment_name,
    attachmentSize: m.attachment_size,
    attachment: m.attachment_url
      ? {
          uri: m.attachment_url,
          kind: m.attachment_type ?? m.kind ?? "file",
          name: m.attachment_name ?? "Attachment",
          size: m.attachment_size,
          ext: (m.attachment_name ?? "").split(".").pop(),
          duration: m.duration_sec,
        }
      : null,
    durationSec: m.duration_sec,
    replyToId: m.reply_to_id,
    replyTo: m.reply_to_id,
    reactions,
    read: !!m.read,
    delivered: !!m.delivered,
    status: m.read ? "read" : m.delivered ? "delivered" : "sent",
    createdAt: m.created_at,
  };
}

async function pushToConvParticipants(
  env: any,
  conv: any,
  senderId: string,
  senderName: string,
  text: string,
) {
  const db: D1Database = env.DB;
  // Get FCM tokens for users who have the same conversation (by ref_id match)
  const sessions = await db
    .prepare(
      `SELECT s.fcm_token FROM sessions s
     JOIN conversations c ON c.user_id = s.user_id AND c.ref_id = ? AND c.user_id != ?
     WHERE s.fcm_token IS NOT NULL`,
    )
    .bind(conv.ref_id ?? conv.id, senderId)
    .all<{ fcm_token: string }>();

  const tokens = (sessions.results ?? [])
    .map((s) => s.fcm_token)
    .filter(Boolean) as string[];
  if (tokens.length) {
    await sendFCMToTokens(
      env.FCM_SERVER_KEY,
      tokens,
      messagePayload(senderName, text, conv.id),
    );
  }
}

export default messages;
