// worker/src/lib/botMessagePipeline.ts
//
// PHASE 14 — Bot Message Flow: End-to-End Pipeline.
//
// Implements the spec's diagram, step for step, as discrete, individually
// testable functions, composed by `handleInboundMessage` — the one and
// only inbound entry point for a bot message. No other code path writes
// an inbound `bot_messages` row (routes/other.ts's `webhook.post('/:token')`
// calls straight into this and does nothing else message-related itself).
//
//   USER -> BOT API -> AUTHENTICATE BOT TOKEN -> IDENTIFY BOT ->
//   IDENTIFY OR CREATE BOT USER -> CHECK BOT STATUS -> CHECK USER
//   PERMISSIONS -> STORE INBOUND MESSAGE -> UPDATE CONVERSATION ->
//   UPDATE BOT USER ACTIVITY -> UPDATE ANALYTICS -> PROCESS COMMAND / BOT
//   LOGIC / WEBHOOK -> GENERATE RESPONSE -> STORE OUTBOUND MESSAGE ->
//   DELIVER RESPONSE -> UPDATE DELIVERY STATUS
//
// This runs synchronously (awaited) inside the request instead of the
// previous fire-and-forget `waitUntil` block routes/other.ts used to have
// — the spec's diagram is a single ordered pipeline that ends in "deliver
// a response", which is impossible to do honestly without waiting to see
// what, if anything, there is to deliver. Per the spec: "Make this a real
// working system... Do not only store the incoming webhook JSON."
//
// What "process command / bot logic / webhook" and "generate response"
// mean concretely, using only real data already in this schema (nothing
// fabricated):
//   - If the message text is a recognized, enabled command for this bot
//     (bot_commands, Phase 11's CRUD), its configured action_type decides
//     the reply: static text, the bot's welcome message, a generated menu
//     of the bot's own commands, or a call out to the bot's webhook_url.
//     An unrecognized/disabled command produces no reply — never a
//     fabricated "unknown command" string that isn't actually configured
//     anywhere.
//   - Otherwise, if the bot has a webhook_url configured, that URL is
//     called once with the inbound message; if it responds with a JSON
//     body containing a `reply` or `text` string field, that becomes the
//     bot's response. This is the real integration point for a bot
//     owner's own server-side logic — BotManager does not run an AI or
//     any other kind of auto-responder of its own, so a bot with no
//     webhook_url and no matching command genuinely has nothing to reply
//     with, and this pipeline says so honestly (no outbound row at all)
//     rather than inventing a reply.

import { uid } from './keys';
import { verifyBotToken, BotRow } from './botToken';
import { refreshBotAnalyticsForToday } from './botAnalytics';
// PHASE 15 — Bot Commands: Execution Engine. The dispatch switch that used
// to live inline in `processCommandOrLogicOrWebhook` below now lives in
// lib/botCommands.ts as `executeCommandAction`, alongside the other
// command-shape rules (`COMMAND_RE`, `COMMAND_ACTION_TYPES`,
// `normalizeCommandName`) it must stay consistent with. This file still
// owns *finding* the command row and *calling* the engine with it — the
// engine itself is a standalone, independently unit-testable unit that
// does not know or care that it's being called from an inbound webhook.
import { normalizeCommandName, executeCommandAction } from './botCommands';

const WEBHOOK_TIMEOUT_MS = 8000;
const PREVIEW_MAX_LEN = 120;

export interface BotUserRow {
  id: string;
  bot_id: string;
  name: string;
  username: string;
  joined_at: number;
  last_active_at: number | null;
  message_count: number;
  blocked: number;
  muted: number;
  last_message_preview: string | null;
  last_message_at: number | null;
}

export interface InboundAttachment {
  url: string;
  type?: string | null;
}

// ── Step: AUTHENTICATE BOT TOKEN ────────────────────────────────────────────
// Thin, explicit wrapper around the shared verifier (lib/botToken.ts) so
// this step shows up in the pipeline exactly like every other one, even
// though the underlying check already existed (Phase 8).
export async function authenticateBotToken(db: D1Database, rawToken: string | null | undefined): Promise<BotRow | null> {
  return verifyBotToken(db, rawToken);
}

// ── Step: IDENTIFY BOT ──────────────────────────────────────────────────────
// A no-op pass-through by design: `authenticateBotToken` already resolved
// the one bot this token belongs to. Kept as its own named step so the
// pipeline's shape matches the spec's diagram exactly, and so a future
// change that needs to re-resolve/enrich the bot record (without
// re-authenticating) has an obvious place to live.
export function identifyBot(bot: BotRow): BotRow {
  return bot;
}

// ── Step: CHECK BOT STATUS ──────────────────────────────────────────────────
// `authenticateBotToken` already refuses a disabled bot's token (Phase 8),
// so in the normal flow this can only ever see an enabled bot. It's kept
// as an explicit, separate check — rather than folded into authentication
// — for two real reasons: (1) it also rejects `status = 'disabled'` even
// in the hypothetical case of `enabled = 1` (an inconsistent row a direct
// DB write could produce, which `enabled` alone wouldn't catch), and (2)
// on success it is what flips a bot from 'offline' to 'online' — the one
// place in this codebase that ever sets a bot 'online' from something
// other than an optimistic client-side guess (see
// app/bot/[id]/settings.jsx's enable toggle, which only guesses). 'online'
// here means "a message was just processed for this bot", a real signal.
export async function checkBotStatus(db: D1Database, bot: BotRow & { status?: string }): Promise<boolean> {
  if (!bot.enabled) return false;
  if (bot.status === 'disabled') return false;
  if (bot.status === 'offline') {
    await db.prepare("UPDATE bots SET status = 'online', updated_at = ? WHERE id = ? AND status = 'offline'")
      .bind(Date.now(), bot.id).run();
  }
  return true;
}

// ── Step: IDENTIFY OR CREATE BOT USER ───────────────────────────────────────
// Preserves the exact pre-Phase-14 behavior (routes/other.ts's inline
// version): a message with no `from.id` in the payload is stored as
// anonymous (no bot_users row at all, `bot_user_id` stays NULL on the
// message) rather than being rejected — some inbound payloads genuinely
// don't carry sender identity, and that's not an error condition.
export async function identifyOrCreateBotUser(
  db: D1Database,
  botId: string,
  fromUser: { id?: unknown; first_name?: unknown; name?: unknown; username?: unknown },
): Promise<BotUserRow | null> {
  if (!fromUser.id) return null;
  const botUserId = `${botId}:${fromUser.id}`;
  const now = Date.now();
  await db.prepare(
    `INSERT OR IGNORE INTO bot_users (id, bot_id, name, username, joined_at, last_active_at, message_count)
     VALUES (?, ?, ?, ?, ?, ?, 0)`
  ).bind(
    botUserId, botId,
    (fromUser.first_name as string) ?? (fromUser.name as string) ?? 'User',
    (fromUser.username as string) ?? 'user',
    now, now,
  ).run();

  return db.prepare('SELECT * FROM bot_users WHERE id = ? AND bot_id = ?').bind(botUserId, botId).first<BotUserRow>();
}

// ── Step: CHECK USER PERMISSIONS ────────────────────────────────────────────
// Three real, already-existing bot-level settings this codebase had never
// actually enforced anywhere before this phase (see the PHASE 14 comment
// on `allow_messages`/`allow_files` at their call sites below): a blocked
// bot_user is dropped entirely (pre-existing Phase 12 behavior, preserved
// here unchanged); a bot with messaging turned off drops every message;
// a bot with files turned off never stores an attachment (the message
// itself still goes through if it also has text — only the attachment is
// refused).
export interface PermissionCheck {
  allowed: boolean;
  reason: 'blocked' | 'messages_disabled' | null;
  stripAttachment: boolean;
}

export function checkUserPermissions(
  bot: { allow_messages: number; allow_files: number },
  botUser: BotUserRow | null,
): PermissionCheck {
  if (botUser?.blocked) return { allowed: false, reason: 'blocked', stripAttachment: false };
  if (!bot.allow_messages) return { allowed: false, reason: 'messages_disabled', stripAttachment: false };
  return { allowed: true, reason: null, stripAttachment: !bot.allow_files };
}

// Reads an inbound attachment out of a webhook payload, in either the
// nested `{ attachment: { url, type } }` shape or a flat
// `{ attachmentUrl, attachmentType }` shape — the latter matches exactly
// what the outbound send route (routes/bots.ts) already accepts, so a
// bot's own backend can use one consistent attachment shape whichever
// direction it's sending.
export function extractAttachment(payload: any, container: any): InboundAttachment | null {
  const nested = container?.attachment;
  if (nested?.url) return { url: String(nested.url), type: nested.type ?? null };
  const flatUrl = container?.attachmentUrl ?? payload?.attachmentUrl;
  const flatType = container?.attachmentType ?? payload?.attachmentType;
  if (flatUrl) return { url: String(flatUrl), type: flatType ?? null };
  return null;
}

// ── Step: STORE INBOUND MESSAGE ─────────────────────────────────────────────
export async function storeInboundMessage(
  db: D1Database,
  botId: string,
  botUserId: string | null,
  text: string | null,
  attachment: InboundAttachment | null,
): Promise<{ id: string; createdAt: number }> {
  const id = uid();
  const now = Date.now();
  await db.prepare(
    `INSERT INTO bot_messages (id, bot_id, bot_user_id, direction, text, attachment_url, attachment_type, status, created_at)
     VALUES (?, ?, ?, 'in', ?, ?, ?, 'received', ?)`
  ).bind(id, botId, botUserId, text ?? null, attachment?.url ?? null, attachment?.type ?? null, now).run();
  return { id, createdAt: now };
}

function preview(text: string | null): string | null {
  if (!text) return null;
  return text.length > PREVIEW_MAX_LEN ? `${text.slice(0, PREVIEW_MAX_LEN - 1)}…` : text;
}

// ── Step: UPDATE CONVERSATION ───────────────────────────────────────────────
// The spec's diagram has this as a distinct step from "update bot user
// activity" below, and it is one: activity is "when did this person last
// do anything" (already existed pre-Phase-14); this is "what does their
// conversation with the bot look like right now" — a preview surfaced on
// app/bot/[id]/users.jsx, which previously had no conversation preview at
// all. Called for both directions (an outbound reply is just as much part
// of "the conversation" as an inbound message).
export async function updateConversation(
  db: D1Database,
  botId: string,
  botUserId: string | null,
  text: string | null,
  attachment: InboundAttachment | null,
  when: number,
): Promise<void> {
  if (!botUserId) return;
  const summary = preview(text) ?? (attachment ? '📎 Attachment' : null);
  if (summary === null) return;
  await db.batch([
    db.prepare('UPDATE bot_users SET last_message_preview = ?, last_message_at = ? WHERE id = ? AND bot_id = ?').bind(summary, when, botUserId, botId),
    db.prepare(`INSERT INTO bot_conversations (id, bot_id, bot_user_id, last_message_id, last_message_at, unread_count, created_at, updated_at)
      VALUES (?, ?, ?, NULL, ?, 0, ?, ?)
      ON CONFLICT(bot_id, bot_user_id) DO UPDATE SET last_message_at=excluded.last_message_at, updated_at=excluded.updated_at`).bind(`${botId}:${botUserId}`, botId, botUserId, when, when, when),
  ]);
}

// ── Step: UPDATE BOT USER ACTIVITY ──────────────────────────────────────────
// Unchanged from the pre-Phase-14 inline version: bump the recency signal
// and running message count real analytics (Phase 13) reads.
export async function updateBotUserActivity(db: D1Database, botUserId: string | null, when: number): Promise<void> {
  if (!botUserId) return;
  await db.prepare('UPDATE bot_users SET message_count = message_count + 1, last_active_at = ? WHERE id = ?')
    .bind(when, botUserId).run();
}

// ── Step: UPDATE ANALYTICS ──────────────────────────────────────────────────
// Delegates to the exact Phase 13 helper both other call sites already use
// — one real, recomputed-from-source-rows implementation, not a third copy.
export async function updateAnalytics(db: D1Database, botId: string): Promise<void> {
  await refreshBotAnalyticsForToday(db, botId);
}

// ── Real HTTP call to a bot's own webhook_url ───────────────────────────────
// Shared by the "Trigger webhook" command action, the no-command fallback,
// and (via `deliverAndRecordOutbound` below) the outbound-reply
// notification and the admin-send route. Bounded by a real timeout so one
// slow/unresponsive bot backend can't hang the inbound request
// indefinitely; a timeout is recorded as a failed delivery, exactly like
// any other non-2xx/network outcome — never silently swallowed.
export interface WebhookCallResult {
  ok: boolean;
  code: number | null;
  latencyMs: number;
  replyText: string | null;
}

export async function callBotWebhook(webhookUrl: string, event: string, data: Record<string, unknown>): Promise<WebhookCallResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-BotManager-Event': event },
      body: JSON.stringify({ event, ...data, sentAt: started }),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    let replyText: string | null = null;
    // A bot backend is not required to return a reply — only parsed if the
    // body is real JSON with a string `reply`/`text` field. Anything else
    // (empty body, non-JSON, wrong field type) is treated as "no reply",
    // never coerced into a fabricated string.
    try {
      const body = await res.clone().json<any>();
      const candidate = body?.reply ?? body?.text;
      if (typeof candidate === 'string' && candidate.trim()) replyText = candidate;
    } catch {
      // no JSON body — not an error, just nothing to reply with.
    }
    return { ok: res.ok, code: res.status, latencyMs, replyText };
  } catch {
    // Network failure, DNS failure, or the abort() from the timeout above.
    return { ok: false, code: null, latencyMs: Date.now() - started, replyText: null };
  } finally {
    clearTimeout(timer);
  }
}

export interface GeneratedResponse {
  text: string | null;
  source: 'command' | 'webhook' | null;
  commandMatched: string | null;
  delivery: WebhookCallResult | null; // set only when `source === 'webhook'` — the same call already produced this text, so nothing needs to fire twice.
}

// ── Step: PROCESS COMMAND / BOT LOGIC / WEBHOOK, then GENERATE RESPONSE ────
// Two spec steps implemented together because, for this codebase's real
// data, they're the same decision: what generates the response *is* which
// branch (command config vs. webhook) the message was processed by.
export async function processCommandOrLogicOrWebhook(
  db: D1Database,
  bot: BotRow & { allow_commands: number; welcome_message: string; webhook_url: string | null },
  botUser: BotUserRow | null,
  text: string | null,
): Promise<GeneratedResponse> {
  const trimmed = (text ?? '').trim();
  const isCommand = bot.allow_commands && trimmed.startsWith('/');

  if (isCommand) {
    const commandName = normalizeCommandName(trimmed.split(/\s+/)[0]);
    const cmd = await db.prepare(
      'SELECT * FROM bot_commands WHERE bot_id = ? AND command = ? AND enabled = 1'
    ).bind(bot.id, commandName).first<any>();

    if (!cmd) return { text: null, source: null, commandMatched: null, delivery: null };

    // PHASE 15 — the actual dispatch now lives in lib/botCommands.ts
    // (`executeCommandAction`), a fixed switch over the same
    // `COMMAND_ACTION_TYPES` the CRUD routes validate against on write.
    // `callBotWebhook` is passed in rather than imported by botCommands.ts
    // itself, so the one real HTTP-call implementation stays here (also
    // used by the no-command webhook fallback just below, and by
    // `deliverAndRecordOutbound`) without the two files importing each
    // other in a circle.
    return executeCommandAction(db, bot, botUser, cmd, text, callBotWebhook);
  }

  // Not a command (or commands are off for this bot) — the bot's own
  // backend, if configured, is the only source of a reply. No AI, no
  // built-in auto-responder: nothing here fabricates a reply that isn't
  // actually coming from somewhere real.
  if (!bot.webhook_url) return { text: null, source: null, commandMatched: null, delivery: null };
  const result = await callBotWebhook(bot.webhook_url, 'message', {
    botId: bot.id, botUserId: botUser?.id ?? null, text,
  });
  return { text: result.replyText, source: 'webhook', commandMatched: null, delivery: result };
}

// ── Step: STORE OUTBOUND MESSAGE ────────────────────────────────────────────
// `attachment` is optional — the inbound pipeline's own auto-replies
// (commands, webhook fallback) are always text-only, but this step is
// shared with the owner-facing admin-send route
// (POST /bots/:id/users/:userId/messages), which does let an owner attach
// a file to a manual reply. Accepting it here, rather than bolting a
// second INSERT onto that route, keeps "how an outbound bot_messages row
// is written" in one real place regardless of who's sending it.
export async function storeOutboundMessage(
  db: D1Database,
  botId: string,
  botUserId: string | null,
  text: string | null,
  source: 'command' | 'webhook' | 'admin',
  attachment: InboundAttachment | null = null,
): Promise<{ id: string; createdAt: number }> {
  const id = uid();
  const now = Date.now();
  await db.prepare(
    `INSERT INTO bot_messages (id, bot_id, bot_user_id, direction, text, attachment_url, attachment_type, status, source, created_at)
     VALUES (?, ?, ?, 'out', ?, ?, ?, 'pending', ?, ?)`
  ).bind(id, botId, botUserId, text, attachment?.url ?? null, attachment?.type ?? null, source, now).run();
  return { id, createdAt: now };
}

// ── Step: UPDATE DELIVERY STATUS ────────────────────────────────────────────
export async function updateDeliveryStatus(
  db: D1Database,
  messageId: string,
  status: 'delivered' | 'failed' | 'sent',
  code: number | null,
  deliveredAt: number,
): Promise<void> {
  await db.prepare('UPDATE bot_messages SET status = ?, delivery_code = ?, delivered_at = ? WHERE id = ?')
    .bind(status, code, deliveredAt, messageId).run();
}

// ── Step: DELIVER RESPONSE (+ UPDATE DELIVERY STATUS) ───────────────────────
// Reused by both the inbound pipeline and the owner-facing admin-send
// route (routes/bots.ts) — one real implementation of "try to deliver this
// outbound bot_messages row, then record what actually happened" instead
// of two. `knownDelivery` lets a caller that already made the exact
// network call this would make (the "Trigger webhook"/fallback-webhook
// branch in `processCommandOrLogicOrWebhook`, whose response body is what
// produced the reply text in the first place) skip firing a second,
// redundant request — the delivery status is just the outcome of the call
// that already happened.
export async function deliverAndRecordOutbound(
  db: D1Database,
  bot: { webhook_url: string | null },
  botUserId: string | null,
  // `text` is nullable here (unlike the inbound pipeline's own outbound
  // replies, which are always text) because the admin-send route
  // (routes/bots.ts) allows an attachment-only reply with no text at all
  // — sending a fabricated `''` to the bot's own webhook notification in
  // that case would misrepresent what the owner actually sent.
  outboundMessage: { id: string; text: string | null; createdAt: number },
  knownDelivery: WebhookCallResult | null,
): Promise<{ status: 'delivered' | 'failed' | 'sent'; code: number | null }> {
  let result: WebhookCallResult;
  if (knownDelivery) {
    result = knownDelivery;
  } else if (bot.webhook_url) {
    result = await callBotWebhook(bot.webhook_url, 'message.reply', {
      botUserId, messageId: outboundMessage.id, text: outboundMessage.text,
    });
  } else {
    // Nothing to deliver to — stored, not delivered anywhere, and that's
    // reported honestly rather than as a fabricated "delivered".
    await updateDeliveryStatus(db, outboundMessage.id, 'sent', null, Date.now());
    return { status: 'sent', code: null };
  }

  const status = result.ok ? 'delivered' : 'failed';
  await updateDeliveryStatus(db, outboundMessage.id, status, result.code, Date.now());
  return { status, code: result.code };
}

// ── Full pipeline ────────────────────────────────────────────────────────────
export type PipelineResult =
  | { ok: false } // invalid/unknown/revoked/disabled-bot token
  | { ok: true; stored: false; botId: string; reason: 'blocked' | 'messages_disabled' | 'bot_disabled' | 'empty_message' }
  | {
      ok: true;
      stored: true;
      botId: string;
      botUserId: string | null;
      messageId: string;
      // The inbound message's own stored text (may be null for an
      // attachment-only message). Exposed here — rather than making a
      // caller re-query bot_messages for something this function already
      // had in hand — so route-level, non-pipeline concerns that still
      // need the inbound content (e.g. the FCM push in
      // routes/other.ts) have one real source for it instead of a second
      // ad hoc read.
      text: string | null;
      // Whether the sender is currently muted, straight from bot_users —
      // the same flag routes/other.ts's push logic has always keyed off.
      muted: boolean;
      reply: { id: string; text: string; status: 'delivered' | 'failed' | 'sent' } | null;
    };

export async function handleInboundMessage(db: D1Database, rawToken: string | null | undefined, payload: any): Promise<PipelineResult> {
  const authenticated = await authenticateBotToken(db, rawToken);
  if (!authenticated) return { ok: false };
  const bot = identifyBot(authenticated);

  const statusOk = await checkBotStatus(db, bot as any);
  if (!statusOk) return { ok: true, stored: false, botId: bot.id, reason: 'bot_disabled' };

  const container = payload?.message ?? payload ?? {};
  const fromUser = container.from ?? payload?.from ?? {};
  const text: string | null = container.text ?? payload?.text ?? (
    // Preserves the pre-Phase-14 fallback: an inbound payload with no
    // recognizable text field is still stored, truncated, rather than
    // dropped — some integrations send arbitrary JSON with no `text` key.
    Object.keys(payload ?? {}).length ? JSON.stringify(payload).slice(0, 500) : null
  );

  const botUser = await identifyOrCreateBotUser(db, bot.id, fromUser);

  const permission = checkUserPermissions(bot as any, botUser);
  if (!permission.allowed) return { ok: true, stored: false, botId: bot.id, reason: permission.reason! };

  const attachment = permission.stripAttachment ? null : extractAttachment(payload, container);
  // If files are disallowed and the *only* content was an attachment (or
  // the payload genuinely had nothing recognizable in it), there is
  // nothing left to store — an honest drop, not an empty row.
  if (!text && !attachment) return { ok: true, stored: false, botId: bot.id, reason: 'empty_message' };

  const inbound = await storeInboundMessage(db, bot.id, botUser?.id ?? null, text, attachment);
  await updateConversation(db, bot.id, botUser?.id ?? null, text, attachment, inbound.createdAt);
  if (botUser) await db.prepare('UPDATE bot_conversations SET last_message_id=?, unread_count=unread_count+1, updated_at=? WHERE bot_id=? AND bot_user_id=?').bind(inbound.id,inbound.createdAt,bot.id,botUser.id).run();
  await updateBotUserActivity(db, botUser?.id ?? null, inbound.createdAt);
  await updateAnalytics(db, bot.id);

  const generated = await processCommandOrLogicOrWebhook(db, bot as any, botUser, text);

  let reply: { id: string; text: string; status: 'delivered' | 'failed' | 'sent' } | null = null;
  if (generated.text) {
    const outbound = await storeOutboundMessage(db, bot.id, botUser?.id ?? null, generated.text, (generated.source ?? 'command') as 'command' | 'webhook');
    const delivered = await deliverAndRecordOutbound(db, bot as any, botUser?.id ?? null, { id: outbound.id, text: generated.text, createdAt: outbound.createdAt }, generated.delivery);
    await updateConversation(db, bot.id, botUser?.id ?? null, generated.text, null, outbound.createdAt);
    if (botUser) await db.prepare('UPDATE bot_conversations SET last_message_id=?, updated_at=? WHERE bot_id=? AND bot_user_id=?').bind(outbound.id,outbound.createdAt,bot.id,botUser.id).run();
    await updateBotUserActivity(db, botUser?.id ?? null, outbound.createdAt);
    await updateAnalytics(db, bot.id);
    reply = { id: outbound.id, text: generated.text, status: delivered.status };
  }

  return {
    ok: true, stored: true, botId: bot.id, botUserId: botUser?.id ?? null, messageId: inbound.id,
    text, muted: !!botUser?.muted, reply,
  };
}
