// worker/src/routes/botRuntime.ts
//
// PHASE 9 — Bot Authentication: Dual Identity Model.
//
// This is the BOT's own surface — mounted at /bot-runtime, gated
// exclusively by `requireBotToken` (never `requireAuth`/
// `requireUserSession`). A bot authenticates here with its own token,
// scoped to exactly that one bot. This is deliberately kept minimal for
// this phase: it establishes and proves the identity boundary (a bot can
// read its own profile and its own commands, and nothing else) without
// building out the full message send/receive pipeline, which Phase 14
// ("Bot Message Flow: End-to-End Pipeline") and Phase 15 ("Bot Commands:
// Execution Engine") own — adding that here now would just mean redoing
// it there. Inbound message delivery already exists as its own surface
// (`POST /webhook/:token`, routes/other.ts) and is unaffected by this
// phase.
//
// Every route below gets its bot id from `c.get('bot').botId` — set only
// by requireBotToken from the verified token — and never from a request
// body or query parameter. There is no route here, or anywhere in this
// file, that accepts a `botId` as user-supplied input.

import { Hono } from 'hono';
import { requireBotToken, BotIdentity } from '../middleware/auth';

const botRuntime = new Hono<{ Bindings: any; Variables: { bot: BotIdentity } }>();
botRuntime.use('*', requireBotToken);

// ── GET /bot-runtime/me — the bot's own public profile ─────────────────────
// Analogous to Telegram Bot API's getMe: lets a running bot process
// confirm its own identity and read its own current config. Reuses the
// same shape the owner-facing API returns (minus owner-only fields like
// tokenPrefix) so a bot integration and the BotManager UI never see two
// different ideas of what a bot record looks like.
botRuntime.get('/me', async (c) => {
  const { botId } = c.get('bot');
  const bot = await (c.env.DB as D1Database)
    .prepare('SELECT * FROM bots WHERE id = ?')
    .bind(botId)
    .first<any>();
  // The token was valid when requireBotToken ran, but the bot could in
  // principle be deleted between then and now (same request) — treat that
  // as "not found" rather than trusting a stale in-memory copy.
  if (!bot) return c.json({ error: 'not_found' }, 404);

  return c.json({
    id: bot.id,
    name: bot.name,
    username: bot.username,
    description: bot.description,
    category: bot.category,
    avatarColor: bot.avatar_color,
    profileImage: bot.profile_image_url ?? null,
    welcomeMessage: bot.welcome_message,
    status: bot.status,
    enabled: !!bot.enabled,
    allowMessages: !!bot.allow_messages,
    allowFiles: !!bot.allow_files,
    allowCommands: !!bot.allow_commands,
    webhookUrl: bot.webhook_url,
  });
});

// ── GET /bot-runtime/commands — the bot's own enabled commands ────────────
// What a running bot process needs to know what it currently supports.
// Only enabled commands are returned — a disabled command isn't part of
// the bot's live runtime surface even though the owner can still see/edit
// it from the management API.
//
// PHASE 11 — also enforces the "Allow commands" bot setting server-side.
// Before this, `allow_commands` was surfaced to the bot via GET /me as
// information but nothing actually stopped this endpoint from handing
// back the command list regardless of that flag — the owner could switch
// "Allow commands" off in Settings and a runtime that didn't bother
// re-checking `/me` first would keep getting the full command list. Now
// the list is empty whenever the owner has turned commands off, whether
// or not the bot process itself checks the flag.
botRuntime.get('/commands', async (c) => {
  const { botId } = c.get('bot');
  const bot = await (c.env.DB as D1Database).prepare('SELECT allow_commands FROM bots WHERE id = ?').bind(botId).first<any>();
  if (!bot || !bot.allow_commands) return c.json([]);

  const rows = await (c.env.DB as D1Database)
    .prepare('SELECT command, description, action_type, action_value FROM bot_commands WHERE bot_id = ? AND enabled = 1 ORDER BY created_at ASC')
    .bind(botId)
    .all<any>();
  return c.json((rows.results ?? []).map((r: any) => ({
    command: r.command,
    description: r.description,
    actionType: r.action_type,
    actionValue: r.action_value,
  })));
});

export default botRuntime;
