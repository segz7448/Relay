import { Hono } from "hono";
import { requireUserSession, UserSession } from "../middleware/auth";

const accounts = new Hono<{
  Bindings: any;
  Variables: { user: UserSession };
}>();
accounts.use("/me", requireUserSession);
accounts.use("/directory", requireUserSession);
accounts.use("/directory/*", requireUserSession);
accounts.use("/me/photo", requireUserSession);
accounts.use("/me/push-token", requireUserSession);
accounts.use("/me/sessions/*", requireUserSession);
accounts.use("/me/sessions", requireUserSession);


// Search people by exact username or display name. Password and session data
// never cross this boundary. An empty query intentionally returns no users.
accounts.get("/directory", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const q = (c.req.query("q") ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!q) return c.json([]);
  const like = `%${q.replace(/[%_]/g, "\\$&")}%`;
  const rows = await (c.env.DB as D1Database)
    .prepare(`SELECT id,username,name,bio,photo_url FROM users
      WHERE id != ? AND (lower(username) LIKE ? ESCAPE '\\' OR lower(name) LIKE ? ESCAPE '\\')
      ORDER BY CASE WHEN lower(username)=? THEN 0 ELSE 1 END, lower(username) LIMIT 25`)
    .bind(userId, like, like, q)
    .all<any>();
  return c.json((rows.results ?? []).map(publicUser));
});

accounts.get("/directory/:userId", async (c) => {
  const user = await (c.env.DB as D1Database)
    .prepare("SELECT id,username,name,bio,photo_url FROM users WHERE id=?")
    .bind(c.req.param("userId"))
    .first<any>();
  if (!user) return c.json({ error: "not_found" }, 404);
  return c.json(publicUser(user));
});

function publicUser(user: any) {
  return { id: user.id, username: user.username, name: user.name || user.username, bio: user.bio || "", photoUrl: user.photo_url ?? null };
}

// GET /accounts/me
accounts.get("/me", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const db: D1Database = c.env.DB;
  const user = await db
    .prepare(
      "SELECT id, email, username, name, bio, photo_url, two_step_enabled, created_at FROM users WHERE id = ?",
    )
    .bind(userId)
    .first<any>();
  if (!user) return c.json({ error: "not_found" }, 404);
  return c.json({ ...user, photoUrl: user.photo_url });
});

// PATCH /accounts/me — update profile
accounts.patch("/me", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const body = await c.req.json<{
    name?: string;
    bio?: string;
    username?: string;
  }>();
  const db: D1Database = c.env.DB;

  const updates: string[] = [];
  const vals: unknown[] = [];
  if (body.name !== undefined) {
    updates.push("name = ?");
    vals.push(body.name);
  }
  if (body.bio !== undefined) {
    updates.push("bio = ?");
    vals.push(body.bio);
  }
  if (body.username !== undefined) {
    const exists = await db
      .prepare("SELECT id FROM users WHERE username = ? AND id != ?")
      .bind(body.username.toLowerCase(), userId)
      .first();
    if (exists)
      return c.json(
        { error: "username_taken", message: "That username is taken." },
        409,
      );
    updates.push("username = ?");
    vals.push(body.username.toLowerCase());
  }
  if (!updates.length) return c.json({ error: "nothing_to_update" }, 400);

  updates.push("updated_at = ?");
  vals.push(Date.now(), userId);

  await db
    .prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...vals)
    .run();
  const user = await db
    .prepare(
      "SELECT id, email, username, name, bio, photo_url FROM users WHERE id = ?",
    )
    .bind(userId)
    .first<any>();
  return c.json({ ...user, photoUrl: user?.photo_url });
});

// POST /accounts/me/photo — upload profile photo via R2
accounts.post("/me/photo", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const formData = await c.req.formData();
  const value = formData.get("photo") as File | null;
  if (!value || typeof value.arrayBuffer !== "function")
    return c.json({ error: "photo_required" }, 400);
  const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowed.has(value.type))
    return c.json({ error: "unsupported_photo_type" }, 415);
  if (value.size <= 0 || value.size > 5 * 1024 * 1024)
    return c.json({ error: "photo_size_invalid" }, 413);
  const bytes = new Uint8Array(await value.arrayBuffer());
  const validBytes =
    (value.type === "image/png" && bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((b, i) => bytes[i] === b)) ||
    (value.type === "image/jpeg" && bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217) ||
    (value.type === "image/webp" && bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP");
  if (!validBytes) return c.json({ error: "malformed_photo" }, 422);
  const ext =
    value.type === "image/png"
      ? "png"
      : value.type === "image/webp"
        ? "webp"
        : "jpg";
  const db = c.env.DB as D1Database;
  const bucket = c.env.BUCKET as R2Bucket;
  const prior = await db
    .prepare("SELECT photo_key FROM users WHERE id = ?")
    .bind(userId)
    .first<{ photo_key: string | null }>();
  const key = `avatars/${userId}/${crypto.randomUUID()}.${ext}`;
  await bucket.put(key, bytes, {
    httpMetadata: {
      contentType: value.type,
      cacheControl: "public, max-age=31536000, immutable",
    },
  });
  const photoUrl = new URL(
    `/accounts/photos/${encodeURIComponent(userId)}?v=${crypto.randomUUID()}`,
    c.req.url,
  ).toString();
  try {
    await db
      .prepare(
        "UPDATE users SET photo_key = ?, photo_url = ?, updated_at = ? WHERE id = ?",
      )
      .bind(key, photoUrl, Date.now(), userId)
      .run();
  } catch (error) {
    await bucket.delete(key);
    throw error;
  }
  if (prior?.photo_key && prior.photo_key !== key)
    c.executionCtx.waitUntil(bucket.delete(prior.photo_key));
  const user = await db
    .prepare(
      "SELECT id,email,username,name,bio,photo_url FROM users WHERE id=?",
    )
    .bind(userId)
    .first<any>();
  return c.json({ ...user, photoUrl: user?.photo_url }, 201);
});

accounts.get("/photos/:userId", async (c) => {
  const row = await (c.env.DB as D1Database)
    .prepare("SELECT photo_key FROM users WHERE id=?")
    .bind(c.req.param("userId"))
    .first<{ photo_key: string | null }>();
  if (!row?.photo_key) return c.json({ error: "not_found" }, 404);
  const obj = await (c.env.BUCKET as R2Bucket).get(row.photo_key);
  if (!obj) return c.json({ error: "not_found" }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("ETag", obj.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
});

accounts.delete("/me/photo", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const db = c.env.DB as D1Database;
  const row = await db
    .prepare("SELECT photo_key FROM users WHERE id=?")
    .bind(userId)
    .first<{ photo_key: string | null }>();
  await db
    .prepare(
      "UPDATE users SET photo_key=NULL,photo_url=NULL,updated_at=? WHERE id=?",
    )
    .bind(Date.now(), userId)
    .run();
  if (row?.photo_key)
    c.executionCtx.waitUntil((c.env.BUCKET as R2Bucket).delete(row.photo_key));
  const user = await db
    .prepare(
      "SELECT id,email,username,name,bio,photo_url FROM users WHERE id=?",
    )
    .bind(userId)
    .first<any>();
  return c.json({ ...user, photoUrl: null });
});

// POST /accounts/me/push-token — register FCM device token
accounts.post("/me/push-token", async (c) => {
  const { sessionId } = c.get("user") as UserSession;
  const { token } = await c.req.json<{ token: string }>();
  if (!token) return c.json({ error: "token_required" }, 400);

  await (c.env.DB as D1Database)
    .prepare("UPDATE sessions SET fcm_token = ? WHERE id = ?")
    .bind(token, sessionId)
    .run();

  return c.json({ ok: true });
});

// GET /accounts/me/sessions — list all active sessions
accounts.get("/me/sessions", async (c) => {
  const { userId, sessionId } = c.get("user") as UserSession;
  const rows = await (c.env.DB as D1Database)
    .prepare(
      "SELECT id, device_name, device_ip, platform, app_version, push_enabled, last_active_at, created_at FROM sessions WHERE user_id = ? ORDER BY last_active_at DESC",
    )
    .bind(userId)
    .all<any>();
  return c.json(
    (rows.results ?? []).map((s) => ({ ...s, current: s.id === sessionId })),
  );
});

// PATCH /accounts/me/sessions/:sid — update a session (currently: push_enabled)
accounts.patch("/me/sessions/:sid", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const body = await c.req.json<{ pushEnabled?: boolean }>();
  if (body.pushEnabled === undefined)
    return c.json({ error: "nothing_to_update" }, 400);
  await (c.env.DB as D1Database)
    .prepare(
      "UPDATE sessions SET push_enabled = ? WHERE id = ? AND user_id = ?",
    )
    .bind(body.pushEnabled ? 1 : 0, c.req.param("sid"), userId)
    .run();
  return c.json({ ok: true });
});

// DELETE /accounts/me/sessions/everywhere — revoke every session, including this one
accounts.delete("/me/sessions/everywhere", async (c) => {
  const { userId } = c.get("user") as UserSession;
  await (c.env.DB as D1Database)
    .prepare("DELETE FROM sessions WHERE user_id = ?")
    .bind(userId)
    .run();
  return c.json({ ok: true });
});

// DELETE /accounts/me/sessions/:sessionId — revoke a session
accounts.delete("/me/sessions/:sid", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const sid = c.req.param("sid");
  await (c.env.DB as D1Database)
    .prepare("DELETE FROM sessions WHERE id = ? AND user_id = ?")
    .bind(sid, userId)
    .run();
  return c.json({ ok: true });
});

// DELETE /accounts/me/sessions — revoke all other sessions
accounts.delete("/me/sessions", async (c) => {
  const { userId, sessionId } = c.get("user") as UserSession;
  await (c.env.DB as D1Database)
    .prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?")
    .bind(userId, sessionId)
    .run();
  return c.json({ ok: true });
});

export default accounts;
