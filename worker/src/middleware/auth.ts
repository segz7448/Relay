import { Context, Next } from 'hono';
import { verifyJWT } from '../lib/jwt';
import { hashToken } from '../lib/keys';
import { verifyBotToken } from '../lib/botToken';

import { checkBotLimits, requestIp } from '../lib/botRateLimit';

export interface UserSession {
  userId: string;
  sessionId: string;
  email: string;
  username: string;
  name: string;
}

export async function requireAuth(c: Context, next: Next) {
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return c.json({ error: 'missing_token' }, 401);

  const env = c.env as { JWT_SECRET: string; DB: D1Database; KV: KVNamespace };

  // 1. Verify JWT signature + expiry
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) return c.json({ error: 'invalid_token' }, 401);

  const userId = payload.sub as string;
  const sessionId = payload.sid as string;

  // 2. Check session is still in DB (allows server-side revocation)
  const tokenHash = await hashToken(token);
  const session = await env.DB.prepare(
    'SELECT id FROM sessions WHERE id = ? AND user_id = ? AND token_hash = ?'
  ).bind(sessionId, userId, tokenHash).first<{ id: string }>();

  if (!session) return c.json({ error: 'session_revoked' }, 401);

  // 3. Update last_active (fire-and-forget)
  c.executionCtx?.waitUntil(
    env.DB.prepare('UPDATE sessions SET last_active_at = ? WHERE id = ?')
      .bind(Date.now(), sessionId).run()
  );

  c.set('user', {
    userId,
    sessionId,
    email: payload.email as string,
    username: payload.username as string,
    name: payload.name as string,
  } satisfies UserSession);

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
export { requireAuth as requireUserSession };

export interface BotIdentity {
  botId: string;
}

export async function requireBotToken(c: Context, next: Next) {
  const env = c.env as { DB: D1Database; KV: KVNamespace };
  const limited = await checkBotLimits(env.KV, { surface: 'bot-token', ip: requestIp(c.req.raw), limit: 60, windowSec: 60 });
  if (!limited.allowed) { c.header('Retry-After', String(limited.retryAfter)); return c.json({ error: 'rate_limited' }, 429); }
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return c.json({ error: 'missing_bot_token' }, 401);

  const bot = await verifyBotToken(env.DB, token);
  if (!bot) return c.json({ error: 'invalid_or_disabled_bot_token' }, 401);

  // Only the id crosses into the context — every downstream route re-reads
  // whatever bot fields it needs, scoped by this id, so nothing works off
  // of a snapshot that could go stale mid-request (e.g. a token revoked by
  // the owner a moment ago).
  c.set('bot', { botId: bot.id } satisfies BotIdentity);

  await next();
}

// Same as requireAuth but doesn't 401 — attaches user if token present
export async function optionalAuth(c: Context, next: Next) {
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (token) {
    const env = c.env as { JWT_SECRET: string; DB: D1Database };
    const payload = await verifyJWT(token, env.JWT_SECRET);
    if (payload) {
      c.set('user', {
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
