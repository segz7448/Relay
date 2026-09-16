import {
  idempotencyKey,
  priorResource,
  rememberResource,
} from "../lib/idempotency";
import { Hono } from "hono";
import { requireAuth, UserSession } from "../middleware/auth";
import { uid, hashToken, generateBotToken } from "../lib/keys";
import { sendFCMToTokens, botAlertPayload } from "../lib/fcm";
import {
  getBotAnalyticsSummary,
  getBotAnalyticsDaily,
  refreshBotAnalyticsForToday,
} from "../lib/botAnalytics";
// PHASE 14 — these three used to be defined inline in this file. Moved to
// lib/botCommands.ts so the new inbound message pipeline's command
// dispatcher (lib/botMessagePipeline.ts) uses the exact same rules, not a
// second copy that could drift. See lib/botCommands.ts for detail; values
// are unchanged.
import {
  COMMAND_RE,
  COMMAND_ACTION_TYPES,
  normalizeCommandName,
  DEFAULT_COMMANDS,
} from "../lib/botCommands";
import {
  deliverAndRecordOutbound,
  storeOutboundMessage,
  updateConversation,
  updateBotUserActivity,
} from "../lib/botMessagePipeline";
import { checkBotLimits, requestIp } from "../lib/botRateLimit";
// PHASE 16 — Bot Webhook System.
import {
  checkWebhookUrl,
  generateWebhookSecret,
  hashToken as hashWebhookSecret,
  deliverBotWebhookOnce,
  deliverBotWebhookWithRetry,
  BotWebhookRow,
} from "../lib/botWebhookDelivery";

const bots = new Hono<{ Bindings: any; Variables: { user: UserSession } }>();
bots.use("*", requireAuth);

// Phase 20: a shared KV-backed composite limiter protects every authenticated
// bot mutation. Reads stay unthrottled; mutations are keyed by source IP and,
// when the route identifies one, bot id. The public inbound webhook has its
// own per-bot counter and delivery rules in routes/other.ts.
bots.use("*", async (c, next) => {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(c.req.method)) return next();
  const botId = c.req.param("id");
  const result = await checkBotLimits(c.env.KV as KVNamespace, {
    surface: "bot-mutation",
    botId,
    ip: requestIp(c.req.raw),
    limit: 120,
    windowSec: 60,
  });
  if (!result.allowed) {
    c.header("Retry-After", String(result.retryAfter));
    return c.json(
      { error: "rate_limited", retryAfter: result.retryAfter },
      429,
    );
  }
  c.header("X-RateLimit-Remaining", String(result.remaining));
  return next();
});

// PHASE 10 — same format rule the create-bot screen already enforces
// client-side (app/create-bot.jsx); enforced here too so the API never
// depends on the client for validation. Starts with a letter, 4+ chars
// total, letters/numbers/underscores only.
const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{3,}$/;

// PHASE 11 — "Webhook settings" (spec, bot settings list). `webhook_url`
// already existed as a column and was already patchable, but nothing
// validated its shape before this — a typo'd URL would be stored as-is
// and silently fail every delivery attempt later. Empty string / null
// clears the webhook (a bot isn't required to have one).
function isValidWebhookUrl(raw: unknown): boolean {
  if (raw === null || raw === "") return true;
  if (typeof raw !== "string") return false;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

// ── List bots ─────────────────────────────────────────────────────────────────
bots.get("/", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const rows = await (c.env.DB as D1Database)
    .prepare("SELECT * FROM bots WHERE user_id = ? ORDER BY created_at DESC")
    .bind(userId)
    .all<any>();
  return c.json((rows.results ?? []).map(publicBot));
});

// ── Create bot ────────────────────────────────────────────────────────────────
bots.post("/", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const body = await c.req.json<{
    name: string;
    username: string;
    description?: string;
    category?: string;
    avatarColor?: string;
    welcomeMessage?: string;
    webhookUrl?: string;
    profileImage?: string;
    enableBot?: boolean;
    allowMessages?: boolean;
    allowFiles?: boolean;
    allowCommands?: boolean;
    enableNotifications?: boolean;
  }>();

  if (!body.name?.trim() || !body.username?.trim()) {
    return c.json({ error: "name_and_username_required" }, 400);
  }

  const usernameClean = body.username.trim().replace(/^@/, "").toLowerCase();
  if (!USERNAME_RE.test(usernameClean)) {
    return c.json(
      {
        error: "invalid_username",
        message:
          "At least 4 characters, starting with a letter — letters, numbers, underscores only.",
      },
      400,
    );
  }

  if (body.webhookUrl !== undefined && !isValidWebhookUrl(body.webhookUrl)) {
    return c.json(
      {
        error: "invalid_webhook_url",
        message:
          "Webhook URL must be a valid http(s) URL, or empty to omit it.",
      },
      400,
    );
  }

  const db: D1Database = c.env.DB;
  let requestKey: string | null;
  try {
    requestKey = idempotencyKey(c.req.raw);
  } catch {
    return c.json({ error: "invalid_idempotency_key" }, 400);
  }
  const prior = await priorResource(db, userId, requestKey, "create-bot");
  if (prior)
    return c.json(
      {
        error: "idempotency_replayed_secret_not_recoverable",
        resourceId: prior.resource_id,
        recovery: `POST /bots/${prior.resource_id}/rotate-token`,
      },
      409,
    );
  const taken = await db
    .prepare("SELECT id FROM bots WHERE username = ?")
    .bind(usernameClean)
    .first();
  if (taken)
    return c.json(
      { error: "username_taken", message: "That bot username is taken." },
      409,
    );

  const { raw: tokenRaw, prefix: tokenPrefix } = generateBotToken();
  const tokenHash = await hashToken(tokenRaw);
  const id = uid();
  const now = Date.now();

  const colors = [
    "#2E4A3E",
    "#3D6E8A",
    "#8A5A3D",
    "#6E3D8A",
    "#3D8A6E",
    "#8A3D5A",
    "#4A3D2E",
    "#2E3E4A",
  ];
  const avatarColor =
    body.avatarColor ?? colors[Math.floor(Math.random() * colors.length)];

  // PHASE 10 — the create-bot screen (app/create-bot.jsx) presents toggles
  // for enable/allow-messages/allow-files/allow-commands/notifications at
  // creation time; these default to true (matching the column defaults in
  // schema.sql) when omitted, but a caller that explicitly sends `false`
  // is respected rather than silently discarded.
  const enabled = body.enableBot ?? true;
  const allowMessages = body.allowMessages ?? true;
  const allowFiles = body.allowFiles ?? true;
  const allowCommands = body.allowCommands ?? true;
  const enableNotifications = body.enableNotifications ?? true;

  await db
    .prepare(
      `INSERT INTO bots (id, user_id, name, username, description, category, avatar_color, profile_image_url, welcome_message,
     token_hash, token_prefix, webhook_url, status, enabled, allow_messages, allow_files, allow_commands, enable_notifications,
     created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'offline', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      userId,
      body.name.trim(),
      usernameClean,
      body.description ?? "",
      body.category ?? "Utilities",
      avatarColor,
      body.profileImage ?? null,
      body.welcomeMessage ?? "",
      tokenHash,
      tokenPrefix,
      body.webhookUrl ?? null,
      enabled ? 1 : 0,
      allowMessages ? 1 : 0,
      allowFiles ? 1 : 0,
      allowCommands ? 1 : 0,
      enableNotifications ? 1 : 0,
      now,
      now,
    )
    .run();

  // PHASE 15 — Bot Commands: Execution Engine. Every new bot gets real
  // /start and /help rows from the moment it exists, exactly as if the
  // owner had added them by hand through "Add command" — same table, same
  // unique-name index, same enabled/disabled toggle, same edit/delete
  // routes below. See the long comment on `DEFAULT_COMMANDS` in
  // lib/botCommands.ts for why this is seeded here (at creation) rather
  // than treated as a hardcoded fallback with no row behind it.
  for (const [i, def] of DEFAULT_COMMANDS.entries()) {
    await db
      .prepare(
        "INSERT INTO bot_commands (id, bot_id, command, description, action_type, action_value, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
      )
      .bind(
        uid(),
        id,
        def.command,
        def.description,
        def.actionType,
        def.actionValue,
        now + i,
      )
      .run();
  }

  await rememberResource(db, userId, requestKey, "create-bot", id);
  const bot = await db
    .prepare("SELECT * FROM bots WHERE id = ?")
    .bind(id)
    .first<any>();
  return c.json({ ...publicBot(bot!), token: tokenRaw }, 201);
});

// ── Get bot ───────────────────────────────────────────────────────────────────
bots.get("/:id", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);

  // Load commands, users, analytics in parallel
  const [cmdRows, userRows, analyticsSummary] = await Promise.all([
    (c.env.DB as D1Database)
      .prepare(
        "SELECT * FROM bot_commands WHERE bot_id = ? ORDER BY created_at ASC",
      )
      .bind(bot.id)
      .all<any>(),
    (c.env.DB as D1Database)
      .prepare(
        "SELECT * FROM bot_users WHERE bot_id = ? ORDER BY last_active_at DESC",
      )
      .bind(bot.id)
      .all<any>(),
    getBotAnalyticsSummary(c.env.DB as D1Database, bot.id),
  ]);

  return c.json({
    ...publicBot(bot),
    // PHASE 11 — was returning raw snake_case rows here (action_type,
    // action_value); every UI screen reads item.actionType/actionValue,
    // so this embedded array previously rendered as undefined wherever it
    // was used. `commandShape` is now the single source of truth for how
    // a command is serialized, used by every commands route in this file.
    commands: (cmdRows.results ?? []).map(commandShape),
    users: (userRows.results ?? []).map(botUserShape),
    // PHASE 13 — real aggregate counts (see lib/botAnalytics.ts). Previously
    // this embedded a 7-day `bot_analytics` readout plus a hardcoded
    // `uptimePct: 99.2` that nothing in the schema actually measures — both
    // removed. The full daily time series lives at its own dedicated
    // endpoint (`GET /bots/:id/analytics/daily`) rather than being bundled
    // into every bot-detail fetch.
    analytics: analyticsSummary,
  });
});

// ── Update bot ────────────────────────────────────────────────────────────────
// PHASE 10 — profile fields. `PROFILE_FIELD_MAP` is explicit rather than a
// generic camelCase → snake_case conversion: the naive conversion mapped
// `profileImage` to the non-existent column `profile_image` instead of the
// real column `profile_image_url`, so every profile-photo edit was silently
// dropped. An explicit map can't drift out of sync with the schema that way.
const PROFILE_FIELD_MAP: Record<string, string> = {
  name: "name",
  username: "username",
  description: "description",
  category: "category",
  avatarColor: "avatar_color",
  profileImage: "profile_image_url",
  welcomeMessage: "welcome_message",
  webhookUrl: "webhook_url",
  enabled: "enabled",
  allowMessages: "allow_messages",
  allowFiles: "allow_files",
  allowCommands: "allow_commands",
  enableNotifications: "enable_notifications",
  notifyOnMessage: "notify_on_message",
  status: "status",
};

bots.patch("/:id", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json<Record<string, unknown>>();
  const db = c.env.DB as D1Database;

  // Username is a profile field (see spec) but needs its own validation +
  // uniqueness check, same rules as bot creation, before it can go through
  // the generic column-update loop below.
  if (body.username !== undefined) {
    const usernameClean = String(body.username)
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
    if (!USERNAME_RE.test(usernameClean)) {
      return c.json(
        {
          error: "invalid_username",
          message:
            "At least 4 characters, starting with a letter — letters, numbers, underscores only.",
        },
        400,
      );
    }
    if (usernameClean !== bot.username) {
      const taken = await db
        .prepare("SELECT id FROM bots WHERE username = ? AND id != ?")
        .bind(usernameClean, bot.id)
        .first();
      if (taken)
        return c.json(
          { error: "username_taken", message: "That bot username is taken." },
          409,
        );
    }
    body.username = usernameClean;
  }

  // PHASE 11 — validate webhookUrl shape before it reaches the generic
  // column-update loop (same pattern as the username check above).
  if (body.webhookUrl !== undefined && !isValidWebhookUrl(body.webhookUrl)) {
    return c.json(
      {
        error: "invalid_webhook_url",
        message:
          "Webhook URL must be a valid http(s) URL, or empty to clear it.",
      },
      400,
    );
  }
  if (body.webhookUrl === "") body.webhookUrl = null;

  const updates: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(body)) {
    const col = PROFILE_FIELD_MAP[k];
    if (col) {
      updates.push(`${col} = ?`);
      vals.push(v);
    }
  }
  if (!updates.length) return c.json({ error: "nothing_to_update" }, 400);

  updates.push("updated_at = ?");
  vals.push(Date.now(), bot.id);
  await db
    .prepare(`UPDATE bots SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...vals)
    .run();

  const updated = await db
    .prepare("SELECT * FROM bots WHERE id = ?")
    .bind(bot.id)
    .first<any>();
  return c.json(publicBot(updated!));
});

// ── Enable / disable bot ─────────────────────────────────────────────────────
// PHASE 10 — dedicated endpoints, distinct from the generic PATCH. Kept
// separate (rather than folding into PATCH { enabled }) because the spec
// lists "Enable bot" / "Disable bot" as their own management actions, and
// because disabling has a side effect PATCH shouldn't have to know about:
// it also clears `status` to 'disabled' so the UI doesn't show a stale
// online/offline state for a bot that's fully turned off. Re-enabling only
// resets status when the bot was actually in the 'disabled' state — it does
// NOT force 'online', since online/offline reflects real bot activity
// (Phase 14+), not just the owner flipping a switch.
bots.post("/:id/enable", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);

  const db = c.env.DB as D1Database;
  const nextStatus = bot.status === "disabled" ? "offline" : bot.status;
  await db
    .prepare(
      "UPDATE bots SET enabled = 1, status = ?, updated_at = ? WHERE id = ?",
    )
    .bind(nextStatus, Date.now(), bot.id)
    .run();

  const updated = await db
    .prepare("SELECT * FROM bots WHERE id = ?")
    .bind(bot.id)
    .first<any>();
  return c.json(publicBot(updated!));
});

bots.post("/:id/disable", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);

  const db = c.env.DB as D1Database;
  await db
    .prepare(
      "UPDATE bots SET enabled = 0, status = 'disabled', updated_at = ? WHERE id = ?",
    )
    .bind(Date.now(), bot.id)
    .run();

  const updated = await db
    .prepare("SELECT * FROM bots WHERE id = ?")
    .bind(bot.id)
    .first<any>();
  return c.json(publicBot(updated!));
});

// ── Rotate bot token ──────────────────────────────────────────────────────────
// PHASE 8 — the UPDATE overwrites token_hash in place, so the previous
// hash stops matching the instant this commits: there is no window where
// both the old and new token validate. Also clears token_revoked, so
// rotating a revoked bot's token is how you bring it back to life with a
// fresh credential (see the revoke-token route below).
bots.post("/:id/rotate-token", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);

  const { raw, prefix } = generateBotToken();
  const hash = await hashToken(raw);
  await (c.env.DB as D1Database)
    .prepare(
      "UPDATE bots SET token_hash = ?, token_prefix = ?, token_revoked = 0, updated_at = ? WHERE id = ?",
    )
    .bind(hash, prefix, Date.now(), bot.id)
    .run();
  return c.json({ token: raw, tokenPrefix: prefix });
});

// ── Revoke bot token ───────────────────────────────────────────────────────────
// PHASE 8 — immediate invalidation without issuing a replacement. Sets a
// status flag rather than nulling token_hash (the column is NOT NULL/
// UNIQUE and holds a hash, never the raw token, so leaving the old hash in
// place is not a disclosure risk) — every token-validating query filters
// on token_revoked = 0, so the flag alone is enough to stop the old token
// from working the instant this commits. Get a working bot again via
// rotate-token, which clears the flag and issues a new token.
bots.post("/:id/revoke-token", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);

  await (c.env.DB as D1Database)
    .prepare("UPDATE bots SET token_revoked = 1, updated_at = ? WHERE id = ?")
    .bind(Date.now(), bot.id)
    .run();
  return c.json({ revoked: true });
});

// ── Delete bot ────────────────────────────────────────────────────────────────
bots.delete("/:id", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  await (c.env.DB as D1Database)
    .prepare("DELETE FROM bots WHERE id = ?")
    .bind(bot.id)
    .run();
  return c.body(null, 204);
});

// ── Webhook (PHASE 16 — Bot Webhook System) ─────────────────────────────────
// Configure/update/enable/disable/rotate/test/delete the bot's outbound
// webhook, plus its delivery history — the spec's full bullet list, wired
// for real (see lib/botWebhookDelivery.ts for signing/SSRF/retry).
//
// `bots.webhook_url` is kept mirrored here so the pre-existing synchronous
// "ask the bot's own logic for a reply" leg of the inbound pipeline
// (lib/botMessagePipeline.ts, unchanged by this phase) always agrees with
// this config: enabling/disabling the webhook here enables/disables that
// leg too, by writing/clearing the same column it already reads.

async function getBotWebhook(
  db: D1Database,
  botId: string,
): Promise<BotWebhookRow | null> {
  return db
    .prepare("SELECT * FROM bot_webhooks WHERE bot_id = ?")
    .bind(botId)
    .first<BotWebhookRow>();
}

function webhookShape(wh: BotWebhookRow) {
  return {
    id: wh.id,
    botId: wh.bot_id,
    url: wh.url,
    secretPrefix: wh.secret_prefix,
    enabled: !!wh.enabled,
    lastDeliveryAt: wh.last_delivery_at,
    lastDeliveryCode: wh.last_delivery_code,
    lastDeliveryStatus: wh.last_delivery_status,
    createdAt: wh.created_at,
    updatedAt: wh.updated_at,
  };
}

function deliveryShape(d: any) {
  return {
    id: d.id,
    eventId: d.event_id,
    eventType: d.event_type,
    attempt: d.attempt,
    status: d.status,
    responseCode: d.response_code,
    latencyMs: d.latency_ms,
    createdAt: d.created_at,
  };
}

const WEBHOOK_URL_ERROR_MESSAGE: Record<string, string> = {
  missing: "A webhook URL is required.",
  invalid_url: "That is not a valid URL.",
  https_required: "Webhook URLs must use https://.",
  blocked_host:
    "That host is not allowed for a webhook (local/private/link-local addresses are blocked).",
};

bots.get("/:id/webhook", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  const wh = await getBotWebhook(c.env.DB, bot.id);
  if (!wh) return c.json({ error: "not_configured" }, 404);
  return c.json(webhookShape(wh));
});

bots.post("/:id/webhook", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);

  const existing = await getBotWebhook(c.env.DB, bot.id);
  if (existing)
    return c.json(
      {
        error: "already_configured",
        message: "This bot already has a webhook. Use PATCH to update it.",
      },
      409,
    );

  const body = await c.req.json<{ url?: string }>();
  const checked = checkWebhookUrl(body.url);
  if (!checked.ok)
    return c.json(
      {
        error: `invalid_webhook_url:${checked.error}`,
        message: WEBHOOK_URL_ERROR_MESSAGE[checked.error],
      },
      400,
    );

  const db = c.env.DB as D1Database;
  const { raw: secret, prefix: secretPrefix } = generateWebhookSecret();
  const secretHash = await hashWebhookSecret(secret);
  const id = uid();
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO bot_webhooks (id, bot_id, url, secret_hash, secret_prefix, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(id, bot.id, checked.url, secretHash, secretPrefix, now, now)
    .run();
  await db
    .prepare("UPDATE bots SET webhook_url = ?, updated_at = ? WHERE id = ?")
    .bind(checked.url, now, bot.id)
    .run();

  const wh = await getBotWebhook(db, bot.id);
  return c.json({ ...webhookShape(wh!), secret }, 201);
});

bots.patch("/:id/webhook", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  const wh = await getBotWebhook(c.env.DB, bot.id);
  if (!wh) return c.json({ error: "not_configured" }, 404);

  const body = await c.req.json<{ url?: string }>();
  if (body.url === undefined)
    return c.json({ error: "nothing_to_update" }, 400);
  const checked = checkWebhookUrl(body.url);
  if (!checked.ok)
    return c.json(
      {
        error: `invalid_webhook_url:${checked.error}`,
        message: WEBHOOK_URL_ERROR_MESSAGE[checked.error],
      },
      400,
    );

  const db = c.env.DB as D1Database;
  const now = Date.now();
  await db
    .prepare("UPDATE bot_webhooks SET url = ?, updated_at = ? WHERE id = ?")
    .bind(checked.url, now, wh.id)
    .run();
  // Only mirror into the pipeline's column while the webhook is actually
  // enabled — otherwise a URL change on a disabled webhook would
  // accidentally turn the pipeline's callback back on.
  if (wh.enabled) {
    await db
      .prepare("UPDATE bots SET webhook_url = ?, updated_at = ? WHERE id = ?")
      .bind(checked.url, now, bot.id)
      .run();
  }

  const updated = await getBotWebhook(db, bot.id);
  return c.json(webhookShape(updated!));
});

bots.post("/:id/webhook/enable", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  const wh = await getBotWebhook(c.env.DB, bot.id);
  if (!wh) return c.json({ error: "not_configured" }, 404);

  const db = c.env.DB as D1Database;
  const now = Date.now();
  await db
    .prepare("UPDATE bot_webhooks SET enabled = 1, updated_at = ? WHERE id = ?")
    .bind(now, wh.id)
    .run();
  await db
    .prepare("UPDATE bots SET webhook_url = ?, updated_at = ? WHERE id = ?")
    .bind(wh.url, now, bot.id)
    .run();
  const updated = await getBotWebhook(db, bot.id);
  return c.json(webhookShape(updated!));
});

bots.post("/:id/webhook/disable", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  const wh = await getBotWebhook(c.env.DB, bot.id);
  if (!wh) return c.json({ error: "not_configured" }, 404);

  const db = c.env.DB as D1Database;
  const now = Date.now();
  await db
    .prepare("UPDATE bot_webhooks SET enabled = 0, updated_at = ? WHERE id = ?")
    .bind(now, wh.id)
    .run();
  // Clears the pipeline's own column too, so the synchronous logic-callback
  // stops firing the instant the webhook is disabled here — same
  // single-source-of-truth mirroring the other routes in this section keep.
  await db
    .prepare("UPDATE bots SET webhook_url = NULL, updated_at = ? WHERE id = ?")
    .bind(now, bot.id)
    .run();
  const updated = await getBotWebhook(db, bot.id);
  return c.json(webhookShape(updated!));
});

bots.post("/:id/webhook/rotate-secret", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  const wh = await getBotWebhook(c.env.DB, bot.id);
  if (!wh) return c.json({ error: "not_configured" }, 404);

  const { raw: secret, prefix: secretPrefix } = generateWebhookSecret();
  const secretHash = await hashWebhookSecret(secret);
  await (c.env.DB as D1Database)
    .prepare(
      "UPDATE bot_webhooks SET secret_hash = ?, secret_prefix = ?, updated_at = ? WHERE id = ?",
    )
    .bind(secretHash, secretPrefix, Date.now(), wh.id)
    .run();
  return c.json({ secret, secretPrefix });
});

// Real test delivery: signs and POSTs an actual synthetic event to the
// configured URL (single attempt, awaited — the owner wants immediate
// feedback, not a queued retry), and records + returns the real outcome.
bots.post("/:id/webhook/test", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  const wh = await getBotWebhook(c.env.DB, bot.id);
  if (!wh) return c.json({ error: "not_configured" }, 404);

  // Signing key is `secret_hash`, not the raw secret — the raw secret is
  // shown to the owner exactly once (at create/rotate time) and never
  // stored, matching the dev-platform webhook precedent (routes/other.ts).
  // This works because `hashWebhookSecret`/`hashToken` is a plain,
  // unsalted SHA-256 digest: a receiver who was given the raw secret can
  // independently recompute the same `secret_hash` and verify against it,
  // without BotManager ever needing to retain the raw value server-side.
  const { result, eventId } = await deliverBotWebhookOnce(
    c.env.DB as D1Database,
    wh,
    wh.secret_hash,
    "bot.webhook.test",
    { botId: bot.id, botName: bot.name, sentAt: Date.now() },
  );
  return c.json({
    delivery: {
      eventId,
      ok: result.ok,
      code: result.code,
      latencyMs: result.latencyMs,
    },
  });
});

bots.get("/:id/webhook/deliveries", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  const wh = await getBotWebhook(c.env.DB, bot.id);
  if (!wh) return c.json({ error: "not_configured" }, 404);

  const rows = await (c.env.DB as D1Database)
    .prepare(
      "SELECT * FROM bot_webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT 50",
    )
    .bind(wh.id)
    .all<any>();
  return c.json((rows.results ?? []).map(deliveryShape));
});

bots.delete("/:id/webhook", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  const db = c.env.DB as D1Database;
  await db
    .prepare("DELETE FROM bot_webhooks WHERE bot_id = ?")
    .bind(bot.id)
    .run();
  await db
    .prepare("UPDATE bots SET webhook_url = NULL, updated_at = ? WHERE id = ?")
    .bind(Date.now(), bot.id)
    .run();
  return c.body(null, 204);
});

// ── Commands ──────────────────────────────────────────────────────────────────
// PHASE 11 — Bot API: Settings & Commands Endpoints.
//
// Full CRUD plus the spec's explicitly-listed "Enable command" / "Disable
// command" as their own dedicated actions (same precedent Phase 10 set for
// bot enable/disable — not folded into the generic PATCH).
//
// Every read-back in this section filters by `bot_id`, not just `id`, even
// where the preceding UPDATE/DELETE already scoped by bot_id. Before this
// phase, PATCH's read-back was `SELECT * FROM bot_commands WHERE id = ?`
// with no bot_id filter: if `:cmdId` belonged to a *different* bot (any
// bot, any owner — ids are globally unique), the UPDATE correctly touched
// zero rows, but the trailing SELECT still found and returned that other
// bot's command — a cross-bot data leak (name/description/action config)
// reachable by guessing/enumerating a command id. Every command route
// below reads back with `AND bot_id = ?` and 404s if that doesn't match.

async function getCommand(db: D1Database, botId: string, cmdId: string) {
  return db
    .prepare("SELECT * FROM bot_commands WHERE id = ? AND bot_id = ?")
    .bind(cmdId, botId)
    .first<any>();
}

function commandShape(cmd: any) {
  return {
    id: cmd.id,
    botId: cmd.bot_id,
    command: cmd.command,
    description: cmd.description,
    actionType: cmd.action_type,
    actionValue: cmd.action_value,
    enabled: !!cmd.enabled,
    createdAt: cmd.created_at,
  };
}

bots.get("/:id/commands", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  const rows = await (c.env.DB as D1Database)
    .prepare(
      "SELECT * FROM bot_commands WHERE bot_id = ? ORDER BY created_at ASC",
    )
    .bind(bot.id)
    .all<any>();
  return c.json((rows.results ?? []).map(commandShape));
});

// ── Get single command — "Get command" (spec), distinct from "List
// commands". Lets the command-edit screen fetch exactly the row it's
// editing instead of loading the whole bot and filtering client-side.
bots.get("/:id/commands/:cmdId", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  const cmd = await getCommand(c.env.DB, bot.id, c.req.param("cmdId"));
  if (!cmd) return c.json({ error: "not_found" }, 404);
  return c.json(commandShape(cmd));
});

bots.post("/:id/commands", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json<{
    command: string;
    description?: string;
    actionType?: string;
    actionValue?: string;
    enabled?: boolean;
  }>();
  const commandClean = normalizeCommandName(body.command);
  if (!COMMAND_RE.test(commandClean)) {
    return c.json(
      {
        error: "invalid_command",
        message:
          "Lowercase letters, numbers, underscores — must start with a letter, up to 32 characters.",
      },
      400,
    );
  }

  const actionType = body.actionType ?? "No action";
  if (!COMMAND_ACTION_TYPES.has(actionType)) {
    return c.json(
      {
        error: "invalid_action_type",
        message: `actionType must be one of: ${[...COMMAND_ACTION_TYPES].join(", ")}`,
      },
      400,
    );
  }

  const db = c.env.DB as D1Database;
  const dup = await db
    .prepare("SELECT id FROM bot_commands WHERE bot_id = ? AND command = ?")
    .bind(bot.id, commandClean)
    .first();
  if (dup)
    return c.json(
      {
        error: "command_taken",
        message: `/${commandClean} already exists on this bot.`,
      },
      409,
    );

  const id = uid();
  const now = Date.now();
  await db
    .prepare(
      "INSERT INTO bot_commands (id, bot_id, command, description, action_type, action_value, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      id,
      bot.id,
      commandClean,
      body.description ?? "",
      actionType,
      body.actionValue ?? "",
      (body.enabled ?? true) ? 1 : 0,
      now,
    )
    .run();

  const cmd = await getCommand(db, bot.id, id);
  return c.json(commandShape(cmd!), 201);
});

bots.patch("/:id/commands/:cmdId", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  const db = c.env.DB as D1Database;

  const existing = await getCommand(db, bot.id, c.req.param("cmdId"));
  if (!existing) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json<Record<string, unknown>>();

  // Renaming needs the same format + per-bot uniqueness check creation does.
  if (body.command !== undefined) {
    const commandClean = normalizeCommandName(body.command);
    if (!COMMAND_RE.test(commandClean)) {
      return c.json(
        {
          error: "invalid_command",
          message:
            "Lowercase letters, numbers, underscores — must start with a letter, up to 32 characters.",
        },
        400,
      );
    }
    if (commandClean !== existing.command) {
      const dup = await db
        .prepare(
          "SELECT id FROM bot_commands WHERE bot_id = ? AND command = ? AND id != ?",
        )
        .bind(bot.id, commandClean, existing.id)
        .first();
      if (dup)
        return c.json(
          {
            error: "command_taken",
            message: `/${commandClean} already exists on this bot.`,
          },
          409,
        );
    }
    body.command = commandClean;
  }

  if (
    body.actionType !== undefined &&
    !COMMAND_ACTION_TYPES.has(String(body.actionType))
  ) {
    return c.json(
      {
        error: "invalid_action_type",
        message: `actionType must be one of: ${[...COMMAND_ACTION_TYPES].join(", ")}`,
      },
      400,
    );
  }

  const allowed = [
    "command",
    "description",
    "action_type",
    "action_value",
    "enabled",
  ];
  const updates: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(body)) {
    const col = camelToSnake(k);
    if (allowed.includes(col)) {
      updates.push(`${col} = ?`);
      vals.push(col === "enabled" ? (v ? 1 : 0) : v);
    }
  }
  if (!updates.length) return c.json({ error: "nothing_to_update" }, 400);
  vals.push(existing.id, bot.id);
  await db
    .prepare(
      `UPDATE bot_commands SET ${updates.join(", ")} WHERE id = ? AND bot_id = ?`,
    )
    .bind(...vals)
    .run();

  const cmd = await getCommand(db, bot.id, existing.id);
  return c.json(commandShape(cmd!));
});

// ── Enable / disable command ──────────────────────────────────────────────
// PHASE 11 — dedicated actions, same precedent as bot enable/disable
// (Phase 10): the spec lists "Enable command" / "Disable command" as their
// own capabilities, distinct from "Update command". Also removes a small
// client-side race that existed before this: toggling used to mean
// "fetch the current list, find this command, PATCH the opposite of
// whatever it currently says" — two requests, with a window for the
// second to act on stale data. These just set the state directly.
bots.post("/:id/commands/:cmdId/enable", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  const db = c.env.DB as D1Database;
  const existing = await getCommand(db, bot.id, c.req.param("cmdId"));
  if (!existing) return c.json({ error: "not_found" }, 404);
  await db
    .prepare("UPDATE bot_commands SET enabled = 1 WHERE id = ? AND bot_id = ?")
    .bind(existing.id, bot.id)
    .run();
  const cmd = await getCommand(db, bot.id, existing.id);
  return c.json(commandShape(cmd!));
});

bots.post("/:id/commands/:cmdId/disable", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  const db = c.env.DB as D1Database;
  const existing = await getCommand(db, bot.id, c.req.param("cmdId"));
  if (!existing) return c.json({ error: "not_found" }, 404);
  await db
    .prepare("UPDATE bot_commands SET enabled = 0 WHERE id = ? AND bot_id = ?")
    .bind(existing.id, bot.id)
    .run();
  const cmd = await getCommand(db, bot.id, existing.id);
  return c.json(commandShape(cmd!));
});

bots.delete("/:id/commands/:cmdId", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  const db = c.env.DB as D1Database;
  const existing = await getCommand(db, bot.id, c.req.param("cmdId"));
  if (!existing) return c.json({ error: "not_found" }, 404);
  await db
    .prepare("DELETE FROM bot_commands WHERE id = ? AND bot_id = ?")
    .bind(existing.id, bot.id)
    .run();
  return c.body(null, 204);
});

// ── Bot users ─────────────────────────────────────────────────────────────────
// PHASE 12 — Bot API: Users & Messages Endpoints.
//
// `getBotUser` is the single-source-of-truth read for one bot user, always
// scoped by bot_id — same precedent `getCommand` set in Phase 11, for the
// same reason: every route below reads back through this helper so a
// guessed/foreign userId can never surface another bot's user data.
async function getBotUser(db: D1Database, botId: string, botUserId: string) {
  return db
    .prepare("SELECT * FROM bot_users WHERE id = ? AND bot_id = ?")
    .bind(botUserId, botId)
    .first<any>();
}

bots.get("/:id/users", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  const rows = await (c.env.DB as D1Database)
    .prepare(
      "SELECT * FROM bot_users WHERE bot_id = ? ORDER BY last_active_at DESC",
    )
    .bind(bot.id)
    .all<any>();
  return c.json((rows.results ?? []).map(botUserShape));
});

// ── Get single bot user — "Get bot user" (spec), distinct from "List bot
// users". Lets the user-profile and history screens fetch exactly the row
// they need instead of loading every user for the bot and filtering
// client-side (that was `fetchBotUser`'s old behavior in botsApi.js).
bots.get("/:id/users/:userId", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  const u = await getBotUser(c.env.DB, bot.id, c.req.param("userId"));
  if (!u) return c.json({ error: "not_found" }, 404);
  return c.json(botUserShape(u));
});

bots.patch("/:id/users/:userId", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json<{ blocked?: boolean; muted?: boolean }>();
  const updates: string[] = [];
  const vals: unknown[] = [];
  if (body.blocked !== undefined) {
    updates.push("blocked = ?");
    vals.push(body.blocked ? 1 : 0);
  }
  if (body.muted !== undefined) {
    updates.push("muted = ?");
    vals.push(body.muted ? 1 : 0);
  }
  if (!updates.length) return c.json({ error: "nothing_to_update" }, 400);
  vals.push(c.req.param("userId"), bot.id);
  await (c.env.DB as D1Database)
    .prepare(
      `UPDATE bot_users SET ${updates.join(", ")} WHERE id = ? AND bot_id = ?`,
    )
    .bind(...vals)
    .run();
  // PHASE 11 — incidental fix, same bug class this phase fixed for
  // commands: the read-back must filter by bot_id too, not just id.
  // (Full bot_users isolation work is Phase 17's scope; this is just
  // closing the one leak spotted while fixing the identical pattern in
  // bot_commands above.)
  const u = await getBotUser(c.env.DB, bot.id, c.req.param("userId"));
  if (!u) return c.json({ error: "not_found" }, 404);
  return c.json(botUserShape(u));
});

// ── Block / unblock / mute / unmute — dedicated actions ─────────────────────
// PHASE 12 — same precedent Phase 10 set for bot enable/disable and Phase
// 11 set for command enable/disable: the spec lists "Block user" /
// "Unblock user" / "Mute user" / "Unmute user" as their own capabilities,
// distinct from the generic PATCH above (which is kept for callers that
// already depend on it). These also close a real race the UI's old
// "toggle" helpers had: `toggleUserBlocked` used to read the current
// `blocked` value from a full user-list fetch and then PATCH the opposite
// of whatever it saw — two round trips, with a window for a second toggle
// (e.g. from another device) to land in between and get silently
// overwritten. These set the state directly; there is nothing to race.
async function setBotUserFlag(
  c: any,
  column: "blocked" | "muted",
  value: boolean,
) {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  const db = c.env.DB as D1Database;
  const existing = await getBotUser(db, bot.id, c.req.param("userId"));
  if (!existing) return c.json({ error: "not_found" }, 404);
  await db
    .prepare(`UPDATE bot_users SET ${column} = ? WHERE id = ? AND bot_id = ?`)
    .bind(value ? 1 : 0, existing.id, bot.id)
    .run();
  const u = await getBotUser(db, bot.id, existing.id);
  return c.json(botUserShape(u!));
}

bots.post("/:id/users/:userId/block", (c) =>
  setBotUserFlag(c, "blocked", true),
);
bots.post("/:id/users/:userId/unblock", (c) =>
  setBotUserFlag(c, "blocked", false),
);
bots.post("/:id/users/:userId/mute", (c) => setBotUserFlag(c, "muted", true));
bots.post("/:id/users/:userId/unmute", (c) =>
  setBotUserFlag(c, "muted", false),
);

// ── Bot analytics ─────────────────────────────────────────────────────────────
// PHASE 13 — Bot API: Analytics Endpoints.
//
// Two dedicated, read-only endpoints, both scoped by `getBot`'s
// bot_id + user_id ownership check (same isolation guarantee every other
// route in this file relies on) and both computed live from the real
// `bot_messages`/`bot_users` rows — see lib/botAnalytics.ts for the exact
// queries and why they replace the previous `bot_analytics`-table readout
// (which was missing outbound messages entirely and had a broken
// `active_users` column — see other.ts's webhook handler comment).
//
// `GET /:id/analytics` — aggregate totals: total/inbound/outbound message
// counts, total + recently-active user counts, and today's figures.
bots.get("/:id/analytics", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  const summary = await getBotAnalyticsSummary(c.env.DB as D1Database, bot.id);
  return c.json(summary);
});

// `GET /:id/analytics/daily?days=N` — per-day time series (default 7,
// capped at 90 so this can never turn into an unbounded scan/response),
// oldest first, zero-filled for days with no activity (a real zero, not a
// gap and not an interpolated/fabricated value).
bots.get("/:id/analytics/daily", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  const days = Number(c.req.query("days") ?? 7) || 7;
  const daily = await getBotAnalyticsDaily(
    c.env.DB as D1Database,
    bot.id,
    days,
  );
  return c.json(daily);
});

// ── Message shape ────────────────────────────────────────────────────────────
// PHASE 12 — single source of truth for how a `bot_messages` row is
// serialized, used by every route below that returns one (activity log,
// per-user history, send). Was previously three different ad-hoc shapes:
//   - GET .../messages spread the RAW row (snake_case `created_at`, no
//     `createdAt`) plus a bolted-on `dir`. `components/MessageBubble.jsx`
//     reads `message.createdAt` (via `timeLabel`) — the history screen's
//     bubbles were rendering with an invalid/undefined timestamp on every
//     single message, bot- and user-sent alike.
//   - GET .../activity returned the raw row with no shaping at all.
//   - POST .../messages (send) had its own inline camelCase object that
//     happened to get `createdAt` right but duplicated the same field
//     list a third time.
// `attachment` is nested (`{ url, kind }`, omitted when there's no
// attachment) rather than left as flat `attachmentUrl`/`attachmentType` —
// matching this codebase's own `searchMsgShape` convention in
// routes/messages.ts, and what MessageBubble/ImageMessage/VideoMessage
// read (`message.attachment?.kind`). Only `url`/`kind` are included: the
// richer fields those components optionally read (width, height,
// duration, waveform) aren't columns this table has, and fabricating
// values for them would mean displaying fake data next to the user's
// real message — so those are left absent rather than invented, exactly
// as the request that started this phase requires.
function botMessageShape(m: any) {
  return {
    id: m.id,
    botId: m.bot_id,
    botUserId: m.bot_user_id,
    dir: m.direction,
    text: m.text,
    attachment: m.attachment_url
      ? { url: m.attachment_url, kind: m.attachment_type }
      : null,
    createdAt: m.created_at,
  };
}

// ── Bot activity (recent message log) ────────────────────────────────────────
bots.get("/:id/activity", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  const limit = Math.max(
    1,
    Math.min(Number(c.req.query("limit") ?? 20) || 20, 100),
  );
  const rows = await (c.env.DB as D1Database)
    .prepare(
      "SELECT * FROM bot_messages WHERE bot_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .bind(bot.id, limit)
    .all<any>();
  return c.json((rows.results ?? []).map(botMessageShape));
});

// ── Bot user message history — "View message history" (spec) ────────────────
// PHASE 12 — now validates the bot user actually belongs to this bot
// before querying messages (previously it silently returned `[]` for a
// foreign/nonexistent userId instead of 404ing, which — since the two
// error conditions were indistinguishable from the response — made "no
// messages yet" and "wrong user id" look identical to the caller).
// `limit` is caller-adjustable (matches `/activity` above) but capped, so
// this can never turn into an unbounded table scan.
bots.get("/:id/users/:userId/messages", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  const botUser = await getBotUser(c.env.DB, bot.id, c.req.param("userId"));
  if (!botUser) return c.json({ error: "not_found" }, 404);
  const limit = Math.max(
    1,
    Math.min(Number(c.req.query("limit") ?? 100) || 100, 200),
  );
  const rows = await (c.env.DB as D1Database)
    .prepare(
      "SELECT * FROM bot_messages WHERE bot_id = ? AND bot_user_id = ? ORDER BY created_at ASC LIMIT ?",
    )
    .bind(bot.id, botUser.id, limit)
    .all<any>();
  return c.json((rows.results ?? []).map(botMessageShape));
});

bots.delete("/:id/users/:userId", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  const botUser = await getBotUser(c.env.DB, bot.id, c.req.param("userId"));
  if (!botUser) return c.json({ error: "not_found" }, 404);
  // Message history is intentionally kept (see the PHASE 12 note on
  // bot_messages.bot_user_id in db/schema.sql) — this only removes the
  // bot_users row itself; ON DELETE SET NULL detaches, rather than
  // deletes, that user's past messages.
  await (c.env.DB as D1Database)
    .prepare("DELETE FROM bot_users WHERE id = ? AND bot_id = ?")
    .bind(botUser.id, bot.id)
    .run();
  return c.body(null, 204);
});

// ── Send outbound message to a bot user ─────────────────────────────────────
bots.post("/:id/users/:userId/messages", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  const botUser = await getBotUser(c.env.DB, bot.id, c.req.param("userId"));
  if (!botUser) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json<{
    text?: string;
    attachmentUrl?: string;
    attachmentType?: string;
  }>();
  if (!body.text && !body.attachmentUrl)
    return c.json({ error: "empty_message" }, 400);

  const db = c.env.DB as D1Database;
  const attachment = body.attachmentUrl
    ? { url: body.attachmentUrl, type: body.attachmentType ?? null }
    : null;

  // PHASE 14 — an owner's manual reply is "generate response" -> "store
  // outbound" -> "deliver" -> "update delivery status" just like an
  // auto-reply from the inbound pipeline, only with `source: 'admin'`
  // instead of 'command'/'webhook'. Reuses the exact same three steps
  // (lib/botMessagePipeline.ts) rather than a second, drifted-apart
  // implementation of "write an outbound bot_messages row" — this route
  // used to hand-roll its own INSERT with no status/delivery tracking at
  // all (every admin-sent row was stuck at the schema default `status =
  // 'received'`, which is nonsensical for an outbound message, and
  // `delivered`/`delivery_code` were never populated).
  const outbound = await storeOutboundMessage(
    db,
    bot.id,
    botUser.id,
    body.text ?? null,
    "admin",
    attachment,
  );
  await updateConversation(
    db,
    bot.id,
    botUser.id,
    body.text ?? null,
    attachment,
    outbound.createdAt,
  );
  await db
    .prepare(
      "UPDATE bot_conversations SET last_message_id=?, updated_at=? WHERE bot_id=? AND bot_user_id=?",
    )
    .bind(outbound.id, outbound.createdAt, bot.id, botUser.id)
    .run();
  await updateBotUserActivity(db, botUser.id, outbound.createdAt);

  // PHASE 13 — outbound sends previously never touched `bot_analytics` at
  // all, so the "today" counter (GET /stats/summary) silently undercounted
  // by omitting every admin-sent reply. Refreshed the same way the inbound
  // webhook handler does, from the real rows, not incremented blindly.
  //
  // Awaited (not `waitUntil`) alongside the delivery attempt below so the
  // response the owner gets back already reflects the real outcome of
  // this send — matches the inbound pipeline's own synchronous design.
  await refreshBotAnalyticsForToday(db, bot.id);

  // PHASE 14 — deliver to the bot's registered webhook (if any) and record
  // the real outcome on this row via the same delivery step the inbound
  // pipeline uses, instead of a fire-and-forget fetch whose result was
  // previously discarded entirely.
  const delivery = await deliverAndRecordOutbound(
    db,
    bot as any,
    botUser.id,
    { id: outbound.id, text: body.text ?? null, createdAt: outbound.createdAt },
    null,
  );

  return c.json(
    {
      id: outbound.id,
      botId: bot.id,
      userId: botUser.id,
      dir: "out",
      text: body.text ?? null,
      attachmentUrl: body.attachmentUrl ?? null,
      attachmentType: body.attachmentType ?? null,
      createdAt: outbound.createdAt,
      status: delivery.status,
      deliveryCode: delivery.code,
    },
    201,
  );
});

// PHASE 18 - durable bot conversation summaries, always owner- and bot-scoped.
bots.get("/:id/conversations", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  const rows = await (c.env.DB as D1Database)
    .prepare(
      `SELECT bc.*, bu.name, bu.username, bu.blocked, bu.muted, bm.text AS last_message_text, bm.direction AS last_message_direction, bm.status AS last_message_status
     FROM bot_conversations bc JOIN bot_users bu ON bu.id=bc.bot_user_id AND bu.bot_id=bc.bot_id
     LEFT JOIN bot_messages bm ON bm.id=bc.last_message_id AND bm.bot_id=bc.bot_id
     WHERE bc.bot_id=? ORDER BY bc.last_message_at DESC LIMIT 100`,
    )
    .bind(bot.id)
    .all<any>();
  return c.json(
    (rows.results ?? []).map((r: any) => ({
      id: r.id,
      botId: r.bot_id,
      botUserId: r.bot_user_id,
      name: r.name,
      username: r.username,
      unreadCount: r.unread_count,
      lastMessageAt: r.last_message_at,
      lastMessage: r.last_message_id
        ? {
            id: r.last_message_id,
            text: r.last_message_text,
            direction: r.last_message_direction,
            status: r.last_message_status,
          }
        : null,
      blocked: !!r.blocked,
      muted: !!r.muted,
    })),
  );
});

bots.get("/:id/conversations/:userId/messages", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  const botUser = await getBotUser(c.env.DB, bot.id, c.req.param("userId"));
  if (!botUser) return c.json({ error: "not_found" }, 404);
  const db = c.env.DB as D1Database;
  await db
    .prepare(
      "UPDATE bot_conversations SET unread_count=0, updated_at=? WHERE bot_id=? AND bot_user_id=?",
    )
    .bind(Date.now(), bot.id, botUser.id)
    .run();
  const rows = await db
    .prepare(
      "SELECT * FROM bot_messages WHERE bot_id=? AND bot_user_id=? ORDER BY created_at ASC LIMIT 200",
    )
    .bind(bot.id, botUser.id)
    .all<any>();
  return c.json((rows.results ?? []).map(botMessageShape));
});

// PHASE 19 - private R2 bot files. Object keys are generated server-side and never returned.
const BOT_FILE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/plain",
  "audio/mpeg",
  "audio/mp4",
  "video/mp4",
]);
const BOT_FILE_MAX = 20 * 1024 * 1024;
bots.post("/:id/files", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  if (!bot.allow_files) return c.json({ error: "files_disabled" }, 403);
  const limited = await checkBotLimits(c.env.KV, {
    surface: "file",
    botId: bot.id,
    ip: requestIp(c.req.raw),
    limit: 20,
    windowSec: 60,
  });
  if (!limited.allowed)
    return c.json(
      { error: "rate_limited", retryAfter: limited.retryAfter },
      429,
      { "Retry-After": String(limited.retryAfter) },
    );
  const form = await c.req.formData();
  const file = form.get("file");
  if (
    !file ||
    typeof file === "string" ||
    typeof (file as Blob).arrayBuffer !== "function"
  )
    return c.json({ error: "file_required" }, 400);
  const uploadFile = file as File;
  if (!BOT_FILE_TYPES.has(uploadFile.type))
    return c.json({ error: "mime_not_allowed" }, 415);
  if (uploadFile.size <= 0 || uploadFile.size > BOT_FILE_MAX)
    return c.json({ error: "file_too_large", maxBytes: BOT_FILE_MAX }, 413);
  const botUserId = String(form.get("botUserId") ?? "") || null;
  if (botUserId && !(await getBotUser(c.env.DB, bot.id, botUserId)))
    return c.json({ error: "not_found" }, 404);
  const id = uid(),
    now = Date.now(),
    ext =
      (uploadFile.name.split(".").pop() || "bin")
        .replace(/[^a-zA-Z0-9]/g, "")
        .slice(0, 8) || "bin";
  const key = `bots/${bot.id}/users/${botUserId ?? "owner"}/${id}.${ext}`;
  await c.env.BUCKET.put(key, await uploadFile.arrayBuffer(), {
    httpMetadata: { contentType: uploadFile.type },
    customMetadata: { fileId: id, botId: bot.id },
  });
  await (c.env.DB as D1Database)
    .prepare(
      "INSERT INTO bot_files (id,bot_id,bot_user_id,object_key,original_name,mime_type,byte_size,created_at) VALUES (?,?,?,?,?,?,?,?)",
    )
    .bind(
      id,
      bot.id,
      botUserId,
      uploadFile.name.slice(0, 255),
      uploadFile.type,
      uploadFile.size,
      now,
    )
    .run();
  return c.json(
    {
      id,
      botId: bot.id,
      botUserId,
      name: uploadFile.name.slice(0, 255),
      mimeType: uploadFile.type,
      size: uploadFile.size,
      createdAt: now,
      url: `/bots/${bot.id}/files/${id}`,
    },
    201,
  );
});

bots.get("/:id/files", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  const rows = await (c.env.DB as D1Database)
    .prepare(
      "SELECT id,bot_id,bot_user_id,original_name,mime_type,byte_size,created_at FROM bot_files WHERE bot_id=? ORDER BY created_at DESC LIMIT 100",
    )
    .bind(bot.id)
    .all<any>();
  return c.json(
    (rows.results ?? []).map((r: any) => ({
      id: r.id,
      botId: r.bot_id,
      botUserId: r.bot_user_id,
      name: r.original_name,
      mimeType: r.mime_type,
      size: r.byte_size,
      createdAt: r.created_at,
      url: `/bots/${bot.id}/files/${r.id}`,
    })),
  );
});

bots.get("/:id/files/:fileId", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  const meta = await (c.env.DB as D1Database)
    .prepare("SELECT * FROM bot_files WHERE id=? AND bot_id=?")
    .bind(c.req.param("fileId"), bot.id)
    .first<any>();
  if (!meta) return c.json({ error: "not_found" }, 404);
  const obj = await c.env.BUCKET.get(meta.object_key);
  if (!obj) return c.json({ error: "not_found" }, 404);
  const h = new Headers({
    "Content-Type": meta.mime_type,
    "Content-Length": String(meta.byte_size),
    "Content-Disposition": `inline; filename="${encodeURIComponent(meta.original_name)}"`,
  });
  h.set("ETag", obj.httpEtag);
  return new Response(obj.body, { headers: h });
});

bots.delete("/:id/files/:fileId", async (c) => {
  const { userId } = c.get("user") as UserSession;
  const bot = await getBot(c.env.DB, c.req.param("id"), userId);
  if (!bot) return c.json({ error: "not_found" }, 404);
  const db = c.env.DB as D1Database;
  const meta = await db
    .prepare("SELECT * FROM bot_files WHERE id=? AND bot_id=?")
    .bind(c.req.param("fileId"), bot.id)
    .first<any>();
  if (!meta) return c.json({ error: "not_found" }, 404);
  await c.env.BUCKET.delete(meta.object_key);
  await db
    .prepare("DELETE FROM bot_files WHERE id=? AND bot_id=?")
    .bind(meta.id, bot.id)
    .run();
  return c.body(null, 204);
});

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getBot(db: D1Database, botId: string, userId: string) {
  return db
    .prepare("SELECT * FROM bots WHERE id = ? AND user_id = ?")
    .bind(botId, userId)
    .first<any>();
}

function publicBot(bot: any) {
  const { token_hash, user_id, ...rest } = bot;
  return {
    ...rest,
    id: rest.id,
    name: rest.name,
    username: rest.username,
    avatarColor: rest.avatar_color,
    profileImage: rest.profile_image_url ?? null,
    category: rest.category,
    description: rest.description,
    welcomeMessage: rest.welcome_message,
    status: rest.status,
    enabled: !!rest.enabled,
    allowMessages: !!rest.allow_messages,
    allowFiles: !!rest.allow_files,
    allowCommands: !!rest.allow_commands,
    enableNotifications: !!rest.enable_notifications,
    notifyOnMessage: !!rest.notify_on_message,
    webhookUrl: rest.webhook_url,
    tokenPrefix: rest.token_prefix,
    tokenRevoked: !!rest.token_revoked,
    createdAt: rest.created_at,
    updatedAt: rest.updated_at,
  };
}

function botUserShape(u: any) {
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    joinedAt: u.joined_at,
    lastActiveAt: u.last_active_at,
    messageCount: u.message_count,
    blocked: !!u.blocked,
    muted: !!u.muted,
  };
}

function camelToSnake(s: string) {
  return s.replace(/([A-Z])/g, "_$1").toLowerCase();
}

export default bots;
