import { Hono } from "hono";
import {
  requireAuth,
  requireUserSession,
  UserSession,
} from "../middleware/auth";
import {
  uid,
  generateApiKey,
  generateWebhookSecret,
  hashToken,
} from "../lib/keys";
import { handleInboundMessage } from "../lib/botMessagePipeline";
import { fireBotWebhookEvent } from "../lib/botWebhookDelivery";

import { checkBotLimits, requestIp } from "../lib/botRateLimit";

// ─── Privacy ──────────────────────────────────────────────────────────────────
export const privacy = new Hono<{
  Bindings: any;
  Variables: { user: UserSession };
}>();
privacy.use("*", requireAuth);

privacy.get("/blocked", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const rows = await (c.env.DB as D1Database)
    .prepare(
      "SELECT * FROM blocked_users WHERE blocker_id = ? ORDER BY blocked_at DESC",
    )
    .bind(userId)
    .all<any>();
  return c.json(
    (rows.results ?? []).map((b: any) => ({
      id: b.blocked_id,
      name: b.blocked_name,
      username: b.blocked_username,
      blockedAt: b.blocked_at,
    })),
  );
});

privacy.post("/blocked", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const { id, name, username } = await c.req.json<{
    id: string;
    name: string;
    username: string;
  }>();
  const rid = uid();
  await (c.env.DB as D1Database)
    .prepare(
      "INSERT OR REPLACE INTO blocked_users (id, blocker_id, blocked_id, blocked_name, blocked_username, blocked_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(rid, userId, id, name, username, Date.now())
    .run();
  return c.json({ ok: true }, 201);
});

privacy.delete("/blocked/:blockedId", async (c) => {
  const { userId } = c.get("user") as UserSession;
  await (c.env.DB as D1Database)
    .prepare(
      "DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?",
    )
    .bind(userId, c.req.param("blockedId"))
    .run();
  return c.json({ ok: true });
});

privacy.get("/settings", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const row = await (c.env.DB as D1Database)
    .prepare("SELECT * FROM privacy_settings WHERE user_id = ?")
    .bind(userId)
    .first<any>();
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({
    phoneNumber: row.phone_number,
    lastSeen: row.last_seen,
    profilePhoto: row.profile_photo,
    calls: row.calls,
    forwardedMessages: row.forwarded_msgs,
    groups: row.groups,
    voiceMessages: row.voice_messages,
    alerts: {
      newLogin: !!row.alert_new_login,
      newDevice: !!row.alert_new_device,
      failedAttempts: !!row.alert_failed_attempts,
      apiKeyUsage: !!row.alert_api_key_usage,
      emailAlerts: !!row.alert_email,
      pushAlerts: !!row.alert_push,
    },
  });
});

privacy.patch("/settings", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const body = await c.req.json<Record<string, unknown>>();
  const colMap: Record<string, string> = {
    phoneNumber: "phone_number",
    lastSeen: "last_seen",
    profilePhoto: "profile_photo",
    calls: "calls",
    forwardedMessages: "forwarded_msgs",
    groups: "groups",
    voiceMessages: "voice_messages",
  };
  const updates: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(body)) {
    const col = colMap[k];
    if (col) {
      updates.push(`${col} = ?`);
      vals.push(v);
    }
    if (k === "alerts" && typeof v === "object" && v) {
      const a = v as any;
      if (a.newLogin !== undefined) {
        updates.push("alert_new_login = ?");
        vals.push(a.newLogin ? 1 : 0);
      }
      if (a.newDevice !== undefined) {
        updates.push("alert_new_device = ?");
        vals.push(a.newDevice ? 1 : 0);
      }
      if (a.failedAttempts !== undefined) {
        updates.push("alert_failed_attempts = ?");
        vals.push(a.failedAttempts ? 1 : 0);
      }
      if (a.apiKeyUsage !== undefined) {
        updates.push("alert_api_key_usage = ?");
        vals.push(a.apiKeyUsage ? 1 : 0);
      }
      if (a.emailAlerts !== undefined) {
        updates.push("alert_email = ?");
        vals.push(a.emailAlerts ? 1 : 0);
      }
      if (a.pushAlerts !== undefined) {
        updates.push("alert_push = ?");
        vals.push(a.pushAlerts ? 1 : 0);
      }
    }
  }
  if (!updates.length) return c.json({ error: "nothing_to_update" }, 400);
  vals.push(userId);
  await (c.env.DB as D1Database)
    .prepare(
      `UPDATE privacy_settings SET ${updates.join(", ")} WHERE user_id = ?`,
    )
    .bind(...vals)
    .run();
  return c.json({ ok: true });
});

// ─── Developer Platform (API Keys + Webhooks) ─────────────────────────────────
export const dev = new Hono<{
  Bindings: any;
  Variables: { user: UserSession };
}>();
dev.use("*", requireUserSession);

// API Keys
dev.get("/api-keys", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const rows = await (c.env.DB as D1Database)
    .prepare(
      "SELECT id, name, key_prefix, scope, last_used_at, revoked, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC",
    )
    .bind(userId)
    .all<any>();
  return c.json(rows.results ?? []);
});

dev.post("/api-keys", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const { name, scope } = await c.req.json<{ name: string; scope?: string }>();
  if (!name?.trim()) return c.json({ error: "name_required" }, 400);
  if (!scope || !["Admin", "Builder", "Operator", "Read only"].includes(scope))
    return c.json({ error: "invalid_access_mode" }, 400);
  const { raw, prefix } = generateApiKey();
  const hash = await hashToken(raw);
  const id = uid();
  await (c.env.DB as D1Database)
    .prepare(
      "INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, scope, revoked, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
    )
    .bind(id, userId, name, hash, prefix, scope, Date.now())
    .run();
  return c.json({ id, name, key: raw, prefix, scope: scope }, 201);
});

dev.delete("/api-keys/:keyId", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const keyId = c.req.param("keyId");
  const changed = await (c.env.DB as D1Database)
    .prepare(
      "UPDATE api_keys SET revoked = 1 WHERE id = ? AND user_id = ? AND revoked = 0 RETURNING id",
    )
    .bind(keyId, userId)
    .first();
  if (!changed) return c.json({ error: "not_found" }, 404);
  await c.env.DB.prepare(
    "INSERT INTO agent_access_audit(id,api_key_id,user_id,method,path,outcome,created_at)VALUES(?,?,?,?,?,?,?)",
  )
    .bind(
      crypto.randomUUID(),
      keyId,
      userId,
      "DELETE",
      `/dev/api-keys/${keyId}`,
      "revoked",
      Date.now(),
    )
    .run();
  return c.json({ ok: true });
});

dev.get("/api-keys/:keyId/audit", async (c) => {
  const { userId } = c.get("user");
  const rows = await c.env.DB.prepare(
    "SELECT method,path,outcome,created_at FROM agent_access_audit WHERE api_key_id=? AND user_id=? ORDER BY created_at DESC LIMIT 100",
  )
    .bind(c.req.param("keyId"), userId)
    .all();
  return c.json(rows.results ?? []);
});
dev.post("/api-keys/:keyId/rotate", async (c) => {
  const { userId } = c.get("user");
  const key = await c.env.DB.prepare(
    "SELECT * FROM api_keys WHERE id=? AND user_id=? AND revoked=0",
  )
    .bind(c.req.param("keyId"), userId)
    .first();
  if (!key) return c.json({ error: "not_found" }, 404);
  const { raw, prefix } = generateApiKey();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE api_keys SET key_hash=?,key_prefix=?,last_used_at=NULL WHERE id=? AND user_id=?",
    ).bind(await hashToken(raw), prefix, key.id, userId),
    c.env.DB.prepare(
      "INSERT INTO agent_access_audit(id,api_key_id,user_id,method,path,outcome,created_at)VALUES(?,?,?,?,?,?,?)",
    ).bind(
      crypto.randomUUID(),
      key.id,
      userId,
      "POST",
      `/dev/api-keys/${key.id}/rotate`,
      "rotated",
      Date.now(),
    ),
  ]);
  return c.json(
    { id: key.id, name: key.name, scope: key.scope, key: raw, prefix },
    201,
  );
});

// Webhooks
dev.get("/webhooks", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const rows = await (c.env.DB as D1Database)
    .prepare(
      "SELECT id, description, url, secret_prefix, events, enabled, last_delivery_at, last_delivery_code, last_delivery_status, created_at FROM webhooks WHERE user_id = ? ORDER BY created_at DESC",
    )
    .bind(userId)
    .all<any>();
  return c.json((rows.results ?? []).map(webhookShape));
});

dev.get("/webhooks/:whId", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const wh = await getWebhook(c.env.DB, c.req.param("whId"), userId);
  if (!wh) return c.json({ error: "not_found" }, 404);
  return c.json(webhookShape(wh));
});

dev.get("/webhooks/:whId/deliveries", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const wh = await getWebhook(c.env.DB, c.req.param("whId"), userId);
  if (!wh) return c.json({ error: "not_found" }, 404);
  const rows = await (c.env.DB as D1Database)
    .prepare(
      "SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT 50",
    )
    .bind(wh.id)
    .all<any>();
  return c.json((rows.results ?? []).map(deliveryShape));
});

dev.post("/webhooks", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const body = await c.req.json<{
    description?: string;
    url: string;
    events?: string[];
  }>();
  if (!body.url?.trim()) return c.json({ error: "url_required" }, 400);
  const { raw: secret, prefix: secretPrefix } = generateWebhookSecret();
  const secretHash = await hashToken(secret);
  const id = uid();
  await (c.env.DB as D1Database)
    .prepare(
      "INSERT INTO webhooks (id, user_id, description, url, secret_hash, secret_prefix, events, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)",
    )
    .bind(
      id,
      userId,
      body.description ?? "",
      body.url,
      secretHash,
      secretPrefix,
      JSON.stringify(body.events ?? []),
      Date.now(),
    )
    .run();
  const wh = await getWebhook(c.env.DB, id, userId);
  return c.json({ ...webhookShape(wh!), secret }, 201);
});

dev.patch("/webhooks/:whId", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const body = await c.req.json<{
    description?: string;
    url?: string;
    events?: string[];
    enabled?: boolean;
  }>();
  const updates: string[] = [];
  const vals: unknown[] = [];
  if (body.description !== undefined) {
    updates.push("description = ?");
    vals.push(body.description);
  }
  if (body.url !== undefined) {
    updates.push("url = ?");
    vals.push(body.url);
  }
  if (body.events !== undefined) {
    updates.push("events = ?");
    vals.push(JSON.stringify(body.events));
  }
  if (body.enabled !== undefined) {
    updates.push("enabled = ?");
    vals.push(body.enabled ? 1 : 0);
  }
  if (!updates.length) return c.json({ error: "nothing_to_update" }, 400);
  vals.push(c.req.param("whId"), userId);
  await (c.env.DB as D1Database)
    .prepare(
      `UPDATE webhooks SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`,
    )
    .bind(...vals)
    .run();
  const wh = await getWebhook(c.env.DB, c.req.param("whId"), userId);
  if (!wh) return c.json({ error: "not_found" }, 404);
  return c.json(webhookShape(wh));
});

// Toggle enabled on/off and return the FULL updated list (matches the
// Webhooks screen's optimistic-update-then-reconcile pattern).
dev.post("/webhooks/:whId/toggle", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const wh = await getWebhook(c.env.DB, c.req.param("whId"), userId);
  if (!wh) return c.json({ error: "not_found" }, 404);
  await (c.env.DB as D1Database)
    .prepare("UPDATE webhooks SET enabled = ? WHERE id = ? AND user_id = ?")
    .bind(wh.enabled ? 0 : 1, wh.id, userId)
    .run();
  const rows = await (c.env.DB as D1Database)
    .prepare(
      "SELECT id, description, url, secret_prefix, events, enabled, last_delivery_at, last_delivery_code, last_delivery_status, created_at FROM webhooks WHERE user_id = ? ORDER BY created_at DESC",
    )
    .bind(userId)
    .all<any>();
  return c.json((rows.results ?? []).map(webhookShape));
});

dev.post("/webhooks/:whId/rotate-secret", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const wh = await getWebhook(c.env.DB, c.req.param("whId"), userId);
  if (!wh) return c.json({ error: "not_found" }, 404);
  const { raw, prefix } = generateWebhookSecret();
  const hash = await hashToken(raw);
  await (c.env.DB as D1Database)
    .prepare(
      "UPDATE webhooks SET secret_hash = ?, secret_prefix = ? WHERE id = ? AND user_id = ?",
    )
    .bind(hash, prefix, wh.id, userId)
    .run();
  return c.json({ secret: raw, secretPrefix: prefix });
});

// Send a real test delivery: POSTs an actual (synthetic) event payload to
// the webhook's URL, signed the same way a live event would be, and
// records + returns the delivery outcome.
dev.post("/webhooks/:whId/test", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const wh = await getWebhook(c.env.DB, c.req.param("whId"), userId);
  if (!wh) return c.json({ error: "not_found" }, 404);
  const { event } = await c.req.json<{ event: string }>();
  const payload = JSON.stringify({ event, test: true, sentAt: Date.now() });

  const started = Date.now();
  let code: number | null = null;
  let status: "success" | "failed" = "failed";
  try {
    const sig = await hashToken(`${wh.secret_hash ?? ""}.${payload}`);
    const res = await fetch(wh.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": sig,
        "X-Webhook-Test": "1",
      },
      body: payload,
    });
    code = res.status;
    status = res.ok ? "success" : "failed";
  } catch {
    code = null;
    status = "failed";
  }
  const latencyMs = Date.now() - started;

  const deliveryId = uid();
  const now = Date.now();
  await (c.env.DB as D1Database)
    .prepare(
      "INSERT INTO webhook_deliveries (id, webhook_id, event, status, code, latency_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(deliveryId, wh.id, event, status, code, latencyMs, now)
    .run();
  await (c.env.DB as D1Database)
    .prepare(
      "UPDATE webhooks SET last_delivery_at = ?, last_delivery_code = ?, last_delivery_status = ? WHERE id = ?",
    )
    .bind(now, code, status, wh.id)
    .run();

  return c.json({
    delivery: {
      id: deliveryId,
      event,
      status,
      code,
      latencyMs,
      timestamp: now,
    },
  });
});

dev.delete("/webhooks/:whId", async (c) => {
  const { userId } = c.get("user") as UserSession;
  await (c.env.DB as D1Database)
    .prepare("DELETE FROM webhooks WHERE id = ? AND user_id = ?")
    .bind(c.req.param("whId"), userId)
    .run();
  return c.body(null, 204);
});

// ── Dev settings (IP allowlist, signing/sandbox/logging/beta toggles) ────────
dev.get("/settings", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const row = await (c.env.DB as D1Database)
    .prepare("SELECT * FROM dev_settings WHERE user_id = ?")
    .bind(userId)
    .first<any>();
  return c.json(devSettingsShape(row));
});

dev.patch("/settings", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const body = await c.req.json<Record<string, unknown>>();
  const colMap: Record<string, string> = {
    ipAllowlist: "ip_allowlist",
    requireSigning: "require_signing",
    sandboxMode: "sandbox_mode",
    verboseLogging: "verbose_logging",
    betaAccess: "beta_access",
  };
  const current = (await (c.env.DB as D1Database)
    .prepare("SELECT * FROM dev_settings WHERE user_id = ?")
    .bind(userId)
    .first<any>()) ?? {
    ip_allowlist: "[]",
    require_signing: 1,
    sandbox_mode: 0,
    verbose_logging: 0,
    beta_access: 0,
  };

  const merged: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(body)) {
    const col = colMap[k];
    if (!col) continue;
    merged[col] =
      col === "ip_allowlist"
        ? JSON.stringify(v)
        : typeof v === "boolean"
          ? v
            ? 1
            : 0
          : v;
  }

  await (c.env.DB as D1Database)
    .prepare(
      `INSERT INTO dev_settings (user_id, ip_allowlist, require_signing, sandbox_mode, verbose_logging, beta_access, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       ip_allowlist = excluded.ip_allowlist, require_signing = excluded.require_signing,
       sandbox_mode = excluded.sandbox_mode, verbose_logging = excluded.verbose_logging,
       beta_access = excluded.beta_access, updated_at = excluded.updated_at`,
    )
    .bind(
      userId,
      merged.ip_allowlist,
      merged.require_signing,
      merged.sandbox_mode,
      merged.verbose_logging,
      merged.beta_access,
      Date.now(),
    )
    .run();

  const row = await (c.env.DB as D1Database)
    .prepare("SELECT * FROM dev_settings WHERE user_id = ?")
    .bind(userId)
    .first<any>();
  return c.json(devSettingsShape(row));
});

function devSettingsShape(row: any) {
  return {
    ipAllowlist: row ? JSON.parse(row.ip_allowlist || "[]") : [],
    requireSigning: row ? !!row.require_signing : true,
    sandboxMode: row ? !!row.sandbox_mode : false,
    verboseLogging: row ? !!row.verbose_logging : false,
    betaAccess: row ? !!row.beta_access : false,
  };
}

async function getWebhook(db: D1Database, id: string, userId: string) {
  return db
    .prepare("SELECT * FROM webhooks WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<any>();
}

function deliveryShape(d: any) {
  return {
    id: d.id,
    event: d.event,
    status: d.status,
    code: d.code,
    latencyMs: d.latency_ms,
    timestamp: d.created_at,
  };
}

// Relay groups
dev.get("/relay", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const rows = await (c.env.DB as D1Database)
    .prepare(
      "SELECT * FROM relay_groups WHERE user_id = ? ORDER BY created_at DESC",
    )
    .bind(userId)
    .all<any>();
  return c.json(
    (rows.results ?? []).map((r: any) => ({
      id: r.id,
      name: r.name,
      members: r.member_count,
      status: r.status,
      createdAt: r.created_at,
    })),
  );
});

dev.post("/relay", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const { name } = await c.req.json<{ name: string }>();
  if (!name?.trim()) return c.json({ error: "name_required" }, 400);
  const id = uid();
  await (c.env.DB as D1Database)
    .prepare(
      "INSERT INTO relay_groups (id, user_id, name, status, member_count, created_at) VALUES (?, ?, ?, ?, 0, ?)",
    )
    .bind(id, userId, name, "online", Date.now())
    .run();
  return c.json({ id, name, members: 0, status: "online" }, 201);
});

function webhookShape(w: any) {
  return {
    id: w.id,
    description: w.description,
    url: w.url,
    secretPrefix: w.secret_prefix,
    events: JSON.parse(w.events || "[]"),
    enabled: !!w.enabled,
    lastDeliveryAt: w.last_delivery_at,
    lastDeliveryCode: w.last_delivery_code,
    lastDeliveryStatus: w.last_delivery_status,
    createdAt: w.created_at,
  };
}

// ─── Stats ────────────────────────────────────────────────────────────────────
export const stats = new Hono<{
  Bindings: any;
  Variables: { user: UserSession };
}>();
stats.use("*", requireAuth);

stats.get("/summary", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const today = new Date().toISOString().slice(0, 10);
  const bots = await (c.env.DB as D1Database)
    .prepare("SELECT id, name FROM bots WHERE user_id = ?")
    .bind(userId)
    .all<any>();
  const botList = bots.results ?? [];

  const rates = await Promise.all(
    botList.map(async (b: any) => {
      const row = await (c.env.DB as D1Database)
        .prepare(
          "SELECT message_count FROM bot_analytics WHERE bot_id = ? AND date = ?",
        )
        .bind(b.id, today)
        .first<{ message_count: number }>();
      return { id: b.id, name: b.name, msgsToday: row?.message_count ?? 0 };
    }),
  );

  return c.json({
    totalMsgsToday: rates.reduce((a, b) => a + b.msgsToday, 0),
    bots: rates,
  });
});

stats.get("/bots/:id/rate", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await (c.env.DB as D1Database)
    .prepare("SELECT id FROM bots WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), userId)
    .first<any>();
  if (!bot) return c.json({ error: "not_found" }, 404);
  // KV rate counter (set by webhook handler)
  const bucket = Math.floor(Date.now() / 1000) - 1;
  const count = await (c.env.KV as KVNamespace).get(`rate:${bot.id}:${bucket}`);
  return c.json({ botId: bot.id, msgsPerSec: Number(count ?? 0) });
});

// ─── Files (R2) ───────────────────────────────────────────────────────────────
export const files = new Hono<{
  Bindings: any;
  Variables: { user: UserSession };
}>();
files.use("*", requireAuth);

files.post("/upload", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return c.json({ error: "file_required" }, 400);

  const ext = file.name.split(".").pop() ?? "bin";
  const key = `uploads/${userId}/${Date.now()}-${uid()}.${ext}`;
  await (c.env.BUCKET as R2Bucket).put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
    customMetadata: { originalName: file.name, uploadedBy: userId },
  });

  const url = new URL(`/files/${key}`, c.req.url).toString();
  return c.json(
    { url, key, name: file.name, size: file.size, type: file.type },
    201,
  );
});

files.get("/:key{.+}", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const key = c.req.param("key");
  if (!key.startsWith(`uploads/${userId}/`))
    return c.json({ error: "not_found" }, 404);
  const obj = await (c.env.BUCKET as R2Bucket).get(key);
  if (!obj) return c.json({ error: "not_found" }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  return new Response(obj.body, { headers });
});

// ─── Webhook (public — authenticated by per-bot token in URL) ─────────────────
//
// PHASE 14 — Bot Message Flow: End-to-End Pipeline.
//
// This route no longer contains any message-handling logic of its own.
// Every step of the spec's diagram (authenticate token -> identify bot ->
// identify/create bot user -> check bot status -> check permissions ->
// store inbound -> update conversation -> update activity -> update
// analytics -> process command/logic/webhook -> generate response ->
// store outbound -> deliver -> update delivery status) lives in
// `handleInboundMessage` (lib/botMessagePipeline.ts) — the one and only
// inbound entry point. This handler's job is strictly what sits outside
// that pipeline: the public HTTP contract (still a generic 404 for any
// unrecognized/revoked/disabled token, same as before), the per-bot rate
// counter used by GET /stats/bots/:id/rate, and the owner's FCM push —
// neither of which the spec's diagram covers, both of which existed
// before this phase and must keep working unchanged.
export const webhook = new Hono<{ Bindings: any }>();

webhook.post("/:token", async (c) => {
  const limited = await checkBotLimits(c.env.KV as KVNamespace, {
    surface: "inbound-webhook",
    ip: requestIp(c.req.raw),
    limit: 120,
    windowSec: 60,
  });
  if (!limited.allowed) {
    c.header("Retry-After", String(limited.retryAfter));
    return c.json({ error: "rate_limited" }, 429);
  }
  const db: D1Database = c.env.DB;
  const kv: KVNamespace = c.env.KV;
  const payload = await c.req.json<any>().catch(() => ({}));

  const result = await handleInboundMessage(db, c.req.param("token"), payload);
  // Same generic 404 as before for an unknown/revoked token — the pipeline's
  // `authenticateBotToken` step is what actually makes this determination
  // now (Phase 8's rules, unchanged), not a second check here.
  if (!result.ok) return c.body(null, 404);

  // Rate counter in KV (TTL 10s, used by stats endpoint). Fires whenever a
  // real bot token was presented, independent of whether the message ended
  // up stored — matches the pre-Phase-14 behavior, which counted right
  // after token verification and before any storage decision.
  const bucket = Math.floor(Date.now() / 1000);
  const rateKey = `rate:${result.botId}:${bucket}`;
  const current = Number((await kv.get(rateKey)) ?? "0");
  await kv.put(rateKey, String(current + 1), { expirationTtl: 60 });

  // FCM push — an existing, pipeline-unrelated concern (the spec's
  // diagram never mentions push notifications). Only relevant when the
  // pipeline actually stored an inbound message; skipped for a muted
  // sender exactly as before ("Mute" is a notification preference, not a
  // block — see the PHASE 12 note that used to live here, now in
  // lib/botMessagePipeline.ts's checkUserPermissions/identifyOrCreateBotUser).
  if (result.stored && !result.muted && result.text && c.env.FCM_SERVER_KEY) {
    const bot = await db
      .prepare(
        "SELECT name, user_id, enable_notifications, notify_on_message FROM bots WHERE id = ?",
      )
      .bind(result.botId)
      .first<{
        name: string;
        user_id: string;
        enable_notifications: number;
        notify_on_message: number;
      }>();
    if (bot && bot.enable_notifications && bot.notify_on_message) {
      const sessions = await db
        .prepare(
          "SELECT fcm_token FROM sessions WHERE user_id = ? AND fcm_token IS NOT NULL",
        )
        .bind(bot.user_id)
        .all<{ fcm_token: string }>();
      const tokens = (sessions.results ?? [])
        .map((s) => s.fcm_token)
        .filter(Boolean) as string[];
      if (tokens.length) {
        const { sendFCMToTokens, botAlertPayload } = await import("../lib/fcm");
        await sendFCMToTokens(
          c.env.FCM_SERVER_KEY,
          tokens,
          botAlertPayload(
            bot.name,
            `New message: ${result.text.slice(0, 60)}`,
            result.botId,
          ),
        );
      }
    }
  }

  return c.json({
    ok: true,
    messageId: result.stored ? result.messageId : null,
  });
});
