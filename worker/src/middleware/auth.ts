import { Context, Next } from "hono";
import { verifyJWT } from "../lib/jwt";
import { hashToken } from "../lib/keys";
import { verifyBotToken } from "../lib/botToken";
import { API_MODES, ApiMode, apiModeAllows } from "../lib/agentAccess";

import { checkBotLimits, requestIp } from "../lib/botRateLimit";
import { retryD1Read } from "../lib/resilience";

export interface UserSession {
  userId: string;
  sessionId: string;
  email: string;
  username: string;
  name: string;
  accessMode?: "session" | "Admin" | "Builder" | "Operator" | "Read only";
}

async function resolveApiKey(
  c: Context,
  token: string,
): Promise<UserSession | null> {
  if (!token.startsWith("sk_live_")) return null;
  const db = c.env.DB as D1Database;
  const row = await db
    .prepare(
      "SELECT k.*,u.email,u.username,u.name FROM api_keys k JOIN users u ON u.id=k.user_id WHERE k.key_hash=?",
    )
    .bind(await hashToken(token))
    .first<any>();
  if (!row || !API_MODES.includes(row.scope)) return null;
  const allowed =
    !row.revoked &&
    apiModeAllows(row.scope as ApiMode, c.req.method, c.req.path);
  c.executionCtx?.waitUntil(
    db.batch([
      db
        .prepare("UPDATE api_keys SET last_used_at=? WHERE id=?")
        .bind(Date.now(), row.id),
      db
        .prepare(
          "INSERT INTO agent_access_audit(id,api_key_id,user_id,method,path,outcome,created_at)VALUES(?,?,?,?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          row.id,
          row.user_id,
          c.req.method,
          c.req.path,
          allowed ? "allowed" : row.revoked ? "revoked" : "forbidden",
          Date.now(),
        ),
    ]),
  );
  if (!allowed) return null;
  return {
    userId: row.user_id,
    sessionId: `api-key:${row.id}`,
    email: row.email,
    username: row.username,
    name: row.name,
    accessMode: row.scope,
  };
}

async function resolveUserSession(
  c: Context,
  token: string,
): Promise<UserSession | null> {
  const env = c.env as { JWT_SECRET: string; DB: D1Database };
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (
    !payload ||
    typeof payload.sub !== "string" ||
    typeof payload.sid !== "string"
  )
    return null;
  const tokenHash = await hashToken(token);
  const row = await retryD1Read(() => env.DB.prepare(
    "SELECT id FROM sessions WHERE id=? AND user_id=? AND token_hash=?",
  )
    .bind(payload.sid, payload.sub, tokenHash)
    .first());
  if (!row) return null;
  c.executionCtx?.waitUntil(
    env.DB.prepare("UPDATE sessions SET last_active_at=? WHERE id=?")
      .bind(Date.now(), payload.sid)
      .run(),
  );
  return {
    userId: payload.sub,
    sessionId: payload.sid,
    email: String(payload.email ?? ""),
    username: String(payload.username ?? ""),
    name: String(payload.name ?? ""),
    accessMode: "session",
  };
}
export async function requireAuth(c: Context, next: Next) {
  const h = c.req.header("Authorization") ?? "";
  const t = h.startsWith("Bearer ") ? h.slice(7).trim() : null;
  if (!t) return c.json({ error: "missing_token" }, 401);
  const user = (await resolveUserSession(c, t)) ?? (await resolveApiKey(c, t));
  if (!user)
    return c.json({ error: "invalid_revoked_or_forbidden_credential" }, 401);
  c.set("user", user);
  await next();
}
export async function requireUserSession(c: Context, next: Next) {
  const h = c.req.header("Authorization") ?? "";
  const t = h.startsWith("Bearer ") ? h.slice(7).trim() : null;
  if (!t) return c.json({ error: "missing_token" }, 401);
  const user = await resolveUserSession(c, t);
  if (!user) return c.json({ error: "invalid_or_revoked_session" }, 401);
  c.set("user", user);
  await next();
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 9 — Bot Authentication: Dual Identity Model
//
// There are two, deliberately separate, never-interchangeable identities
// in this app:
//
//   1. BotManager USER  — a human with an account. Authenticated by
//      `requireAuth` (aliased below as `requireUserSession`, matching the
//      spec's naming) via their session JWT. Used on every management
//      route: /bots*, /conversations*, /servers*, /accounts*, etc. — the
//      surface a user's own session token can reach.
//
//   2. BOT               — a single bot's own runtime identity, scoped to
//      exactly that bot and nothing else. Authenticated by
//      `requireBotToken` below via the bot's own token, and used
//      exclusively on /bot-runtime/* (see routes/botRuntime.ts). A bot
//      token must never work on a /bots* management route, and a user's
//      session JWT must never work on /bot-runtime/*.
//
// requireBotToken attaches only `{ botId }` to the context — never a full
// bot row, and never anything named `userId`. Every /bot-runtime/* route
// must scope its queries by that botId and that botId alone; a `botId`
// arriving in a request body or query string is never trusted as the
// source of truth (see routes/botRuntime.ts).
// ─────────────────────────────────────────────────────────────────────────────

// Named per the spec's terminology — same function as requireAuth, kept as
// one implementation rather than a parallel copy so there is exactly one
// place that validates a user session.

export interface BotIdentity {
  botId: string;
}

export async function requireBotToken(c: Context, next: Next) {
  const env = c.env as { DB: D1Database; KV: KVNamespace };
  const limited = await checkBotLimits(env.KV, {
    surface: "bot-token",
    ip: requestIp(c.req.raw),
    limit: 60,
    windowSec: 60,
  });
  if (!limited.allowed) {
    c.header("Retry-After", String(limited.retryAfter));
    return c.json({ error: "rate_limited" }, 429);
  }
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) return c.json({ error: "missing_bot_token" }, 401);

  const bot = await verifyBotToken(env.DB, token);
  if (!bot) return c.json({ error: "invalid_or_disabled_bot_token" }, 401);

  // Only the id crosses into the context — every downstream route re-reads
  // whatever bot fields it needs, scoped by this id, so nothing works off
  // of a snapshot that could go stale mid-request (e.g. a token revoked by
  // the owner a moment ago).
  c.set("bot", { botId: bot.id } satisfies BotIdentity);

  await next();
}

// Same as requireAuth but doesn't 401 — attaches user if token present
export async function optionalAuth(c: Context, next: Next) {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (token) {
    const env = c.env as { JWT_SECRET: string; DB: D1Database };
    const payload = await verifyJWT(token, env.JWT_SECRET);
    if (payload) {
      c.set("user", {
        userId: payload.sub as string,
        sessionId: payload.sid as string,
        email: payload.email as string,
        username: payload.username as string,
        name: payload.name as string,
      } satisfies UserSession);
    }
  }
  await next();
}
