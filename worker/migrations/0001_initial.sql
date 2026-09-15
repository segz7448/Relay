
-- ─────────────────────────────────────────────────────────────────────────────
-- USERS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  username    TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  bio         TEXT NOT NULL DEFAULT '',
  photo_url   TEXT,
  password_hash TEXT NOT NULL,
  two_step_enabled INTEGER NOT NULL DEFAULT 0,
  two_step_hash TEXT,
  two_step_hint TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- SESSIONS (one per device sign-in)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT UNIQUE NOT NULL,
  device_name   TEXT NOT NULL DEFAULT 'Unknown Device',
  device_ip     TEXT,
  platform      TEXT NOT NULL DEFAULT 'unknown',
  app_version   TEXT,
  fcm_token     TEXT,
  push_enabled  INTEGER NOT NULL DEFAULT 1,
  last_active_at INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);

-- ─────────────────────────────────────────────────────────────────────────────
-- API KEYS (developer keys for the account)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  key_hash    TEXT UNIQUE NOT NULL,
  key_prefix  TEXT NOT NULL,
  scope       TEXT NOT NULL DEFAULT 'Full access',
  last_used_at INTEGER,
  revoked     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- ─────────────────────────────────────────────────────────────────────────────
-- BOTS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bots (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  username            TEXT UNIQUE NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  category            TEXT NOT NULL DEFAULT 'Utilities',
  avatar_color        TEXT NOT NULL DEFAULT '#2E4A3E',
  profile_image_url   TEXT,
  welcome_message     TEXT NOT NULL DEFAULT '',
  token_hash          TEXT UNIQUE NOT NULL,
  token_prefix        TEXT NOT NULL,
  token_revoked       INTEGER NOT NULL DEFAULT 0,
  webhook_url         TEXT,
  status              TEXT NOT NULL DEFAULT 'offline',
  enabled             INTEGER NOT NULL DEFAULT 1,
  allow_messages      INTEGER NOT NULL DEFAULT 1,
  allow_files         INTEGER NOT NULL DEFAULT 1,
  allow_commands      INTEGER NOT NULL DEFAULT 1,
  enable_notifications INTEGER NOT NULL DEFAULT 1,
  notify_on_message   INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bots_user ON bots(user_id);
CREATE INDEX IF NOT EXISTS idx_bots_token ON bots(token_hash);

-- ─────────────────────────────────────────────────────────────────────────────
-- BOT COMMANDS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_commands (
  id           TEXT PRIMARY KEY,
  bot_id       TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  command      TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  action_type  TEXT NOT NULL DEFAULT 'No action',
  action_value TEXT NOT NULL DEFAULT '',
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bot_commands_bot ON bot_commands(bot_id);
-- PHASE 11 — a bot's own command menu and its runtime dispatch (Phase 15)
-- both key off `command` alone; two rows with the same name for the same
-- bot would be ambiguous ("which /start fires?"). Enforced here, not just
-- in the route, so it holds even against a future direct-DB write.
-- NOTE: if a database already has duplicate (bot_id, command) rows from
-- before this index existed, this CREATE will fail until they're deduped.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_commands_unique ON bot_commands(bot_id, command);

-- ─────────────────────────────────────────────────────────────────────────────
-- BOT USERS (end-users who have interacted with the bot)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_users (
  id            TEXT PRIMARY KEY,
  bot_id        TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  username      TEXT NOT NULL,
  joined_at     INTEGER NOT NULL,
  last_active_at INTEGER,
  message_count INTEGER NOT NULL DEFAULT 0,
  blocked       INTEGER NOT NULL DEFAULT 0,
  muted         INTEGER NOT NULL DEFAULT 0,
  -- PHASE 14 — Bot Message Flow: End-to-End Pipeline. The "UPDATE
  -- CONVERSATION" step of the spec's pipeline diagram: a short preview of
  -- the most recent message exchanged with this bot user (either
  -- direction) and when it happened, kept in sync by
  -- lib/botMessagePipeline.ts on every inbound message and by the
  -- outbound send route. Real, always derived from an actual stored
  -- bot_messages row — never a placeholder. Closes a real gap: before
  -- this, app/bot/[id]/users.jsx had no way to show a conversation
  -- preview at all, only "last active".
  last_message_preview TEXT,
  last_message_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bot_users_bot ON bot_users(bot_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- BOT ANALYTICS (write-time cache, "today" row per bot)
-- PHASE 13 — this table is no longer what the per-bot analytics screens
-- read (GET /bots/:id/analytics and /analytics/daily now compute directly
-- from bot_messages/bot_users — see worker/src/lib/botAnalytics.ts). It
-- remains solely as a cheap "today" cache for the cross-bot GET
-- /stats/summary dashboard, and is now refreshed by recomputing today's
-- row from the real bot_messages rows on every inbound AND outbound
-- message (refreshBotAnalyticsForToday) rather than incremented blindly —
-- a prior version incremented `active_users` by 1 on every single inbound
-- message, making it an exact duplicate of message_count instead of a
-- real distinct-sender count.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_analytics (
  bot_id        TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  date          TEXT NOT NULL,   -- YYYY-MM-DD
  message_count INTEGER NOT NULL DEFAULT 0,
  active_users  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(bot_id, date)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- BOT MESSAGES (webhook inbound messages queue → stored for history)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_messages (
  id              TEXT PRIMARY KEY,
  bot_id          TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  -- PHASE 12 — was `REFERENCES bot_users(id)` with no ON DELETE action,
  -- i.e. SQLite's default NO ACTION/RESTRICT: with foreign_keys enforced,
  -- DELETE /bots/:id/users/:userId (app/bot/[id]/users.jsx's "Remove
  -- user") would fail with a FOREIGN KEY constraint error for any user
  -- who had ever exchanged a message, even though that screen's own
  -- confirm-dialog copy promises "Their message history is kept, but
  -- they'll no longer appear in this list." SET NULL is what actually
  -- delivers that promise: the bot_user row goes away, its messages stay
  -- (already-nullable bot_user_id for anonymous 'in' messages made this
  -- the natural fit), and the delete no longer errors.
  bot_user_id     TEXT REFERENCES bot_users(id) ON DELETE SET NULL,
  direction       TEXT NOT NULL DEFAULT 'in',  -- 'in' | 'out'
  text            TEXT,
  attachment_url  TEXT,
  attachment_type TEXT,
  -- PHASE 14 — Bot Message Flow: End-to-End Pipeline.
  -- Backs the diagram's "STORE OUTBOUND MESSAGE" -> "DELIVER RESPONSE" ->
  -- "UPDATE DELIVERY STATUS" steps. Same status/code shape the existing
  -- `webhook_deliveries` table already uses for the unrelated developer-
  -- webhook system, reused here for consistency rather than inventing a
  -- second vocabulary.
  --   status: inbound rows are always 'received' (set once, at insert).
  --     Outbound rows start 'pending', then become exactly one of:
  --     'delivered' (bot.webhook_url returned 2xx), 'failed' (non-2xx,
  --     network error, or timeout), or 'sent' (stored successfully but
  --     the bot has no webhook_url configured, so there is no external
  --     channel to report delivery for — an honest "nowhere to deliver
  --     to", not a fabricated "delivered").
  --   delivery_code: the real HTTP status code from that delivery
  --     attempt, or NULL if none was made / the request never completed.
  --   delivered_at: when the delivery attempt finished, or NULL.
  --   source: how an outbound row was generated — 'command' (a
  --     bot_commands row matched), 'webhook' (bot.webhook_url's response
  --     supplied the reply text), or 'admin' (a human sent it from the
  --     owner-facing API/UI). NULL for inbound rows. Purely descriptive,
  --     always set from the real code path taken — never guessed.
  status          TEXT NOT NULL DEFAULT 'received',
  delivery_code   INTEGER,
  delivered_at    INTEGER,
  source          TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bot_messages_bot ON bot_messages(bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_messages_user ON bot_messages(bot_user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- CONVERSATIONS (the inbox — DMs, groups, server previews)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,   -- 'bot' | 'direct' | 'group' | 'relay'
  name            TEXT NOT NULL,
  avatar_color    TEXT NOT NULL DEFAULT '#2E4A3E',
  bio             TEXT NOT NULL DEFAULT '',
  pinned          INTEGER NOT NULL DEFAULT 0,
  muted           INTEGER NOT NULL DEFAULT 0,
  unread_count    INTEGER NOT NULL DEFAULT 0,
  last_message    TEXT,
  last_message_at INTEGER,
  online          INTEGER NOT NULL DEFAULT 0,
  ref_id          TEXT,            -- bot_id | other_user_id | server_id
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, last_message_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- MESSAGES (per conversation)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       TEXT,            -- null = bot/system message
  sender_name     TEXT,
  text            TEXT,
  kind            TEXT NOT NULL DEFAULT 'text',
  attachment_url  TEXT,
  attachment_type TEXT,
  attachment_name TEXT,
  attachment_size INTEGER,
  duration_sec    INTEGER,
  reply_to_id     TEXT,
  reactions       TEXT NOT NULL DEFAULT '{}',
  read            INTEGER NOT NULL DEFAULT 0,
  delivered       INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- SERVERS (relay groups with channels + members)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS servers (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id),
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  icon_color    TEXT NOT NULL DEFAULT '#3D6E8A',
  icon_url      TEXT,
  privacy       TEXT NOT NULL DEFAULT 'private',
  invite_code   TEXT UNIQUE NOT NULL,
  unread_count  INTEGER NOT NULL DEFAULT 0,
  muted         INTEGER NOT NULL DEFAULT 0,
  last_activity_at INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS server_categories (
  id        TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  position  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_server_cats ON server_categories(server_id, position);

CREATE TABLE IF NOT EXISTS channels (
  id            TEXT PRIMARY KEY,
  server_id     TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  category_id   TEXT REFERENCES server_categories(id),
  name          TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'text',
  topic         TEXT NOT NULL DEFAULT '',
  private       INTEGER NOT NULL DEFAULT 0,
  post_access   TEXT NOT NULL DEFAULT 'everyone',
  notifications TEXT NOT NULL DEFAULT 'all',
  unread_count  INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_channels_server ON channels(server_id);

-- Explicit per-channel membership. Only meaningful for channels with
-- private = 1: server membership alone is no longer sufficient to read
-- (or, in servers.ts, post into) a private channel — the requesting user
-- must also have a row here. For non-private channels this table is
-- simply not consulted (server membership continues to be the whole
-- gate), so it stays empty for the common case and only grows as private
-- channels are actually used. See worker/src/lib/channelMembers.ts and
-- worker/src/lib/relayAccess.ts.
CREATE TABLE IF NOT EXISTS channel_members (
  id          TEXT PRIMARY KEY,
  channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  added_at    INTEGER NOT NULL,
  UNIQUE(channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_members ON channel_members(channel_id);

CREATE TABLE IF NOT EXISTS channel_messages (
  id          TEXT PRIMARY KEY,
  channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  sender_id   TEXT REFERENCES users(id),
  sender_name TEXT,
  text        TEXT,
  kind        TEXT NOT NULL DEFAULT 'text',
  attachment_url  TEXT,
  reactions       TEXT NOT NULL DEFAULT '{}',
  reply_to_id TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chan_msgs ON channel_messages(channel_id, created_at DESC);

CREATE TABLE IF NOT EXISTS server_members (
  id          TEXT PRIMARY KEY,
  server_id   TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  username    TEXT NOT NULL,
  avatar_color TEXT NOT NULL DEFAULT '#3D6E8A',
  role        TEXT NOT NULL DEFAULT 'member',
  online      INTEGER NOT NULL DEFAULT 0,
  joined_at   INTEGER NOT NULL,
  permissions TEXT NOT NULL DEFAULT '{}',
  UNIQUE(server_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_server_members ON server_members(server_id);



-- ─────────────────────────────────────────────────────────────────────────────
-- CALLS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS call_logs (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id   TEXT NOT NULL,
  direction    TEXT NOT NULL,     -- 'incoming' | 'outgoing'
  type         TEXT NOT NULL DEFAULT 'voice',
  status       TEXT NOT NULL DEFAULT 'answered',
  duration_sec INTEGER NOT NULL DEFAULT 0,
  at           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calls_user ON call_logs(user_id, at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- PRIVACY
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blocked_users (
  id               TEXT PRIMARY KEY,
  blocker_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id       TEXT NOT NULL,
  blocked_name     TEXT NOT NULL,
  blocked_username TEXT NOT NULL,
  blocked_at       INTEGER NOT NULL,
  UNIQUE(blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS privacy_settings (
  user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone_number   TEXT NOT NULL DEFAULT 'contacts',
  last_seen      TEXT NOT NULL DEFAULT 'everybody',
  profile_photo  TEXT NOT NULL DEFAULT 'everybody',
  calls          TEXT NOT NULL DEFAULT 'everybody',
  forwarded_msgs TEXT NOT NULL DEFAULT 'everybody',
  groups         TEXT NOT NULL DEFAULT 'everybody',
  voice_messages TEXT NOT NULL DEFAULT 'everybody',
  alert_new_login     INTEGER NOT NULL DEFAULT 1,
  alert_new_device    INTEGER NOT NULL DEFAULT 1,
  alert_failed_attempts INTEGER NOT NULL DEFAULT 1,
  alert_api_key_usage INTEGER NOT NULL DEFAULT 1,
  alert_email         INTEGER NOT NULL DEFAULT 1,
  alert_push          INTEGER NOT NULL DEFAULT 1
);

-- ─────────────────────────────────────────────────────────────────────────────
-- BOT WEBHOOKS (PHASE 16 — per-bot outbound event delivery)
--
-- Distinct from the "WEBHOOKS (dev platform)" tables just below: those are
-- account-level, `user_id`-scoped, and fire on developer/API-platform
-- events (settings-webhooks.jsx / devPlatformStore.js). These are
-- bot-level, `bot_id`-scoped (one row per bot — a bot has at most one
-- configured webhook, matching the single "Webhook" field that already
-- existed on the bot-settings screen, `bots.webhook_url`), and fire on
-- real bot events (message received / message sent). Never merged with
-- the dev-platform tables or with each other — separate secret, separate
-- delivery history, separate routes (worker/src/routes/bots.ts,
-- `/bots/:id/webhook*`).
--
-- `bots.webhook_url` (Phase 11) is left in the schema unchanged and keeps
-- backing the synchronous "call the bot's own logic for a reply" leg of
-- the inbound pipeline (lib/botMessagePipeline.ts) — a live request that
-- needs an immediate reply body back, which a queued/retried delivery
-- can't provide. `bot_webhooks.url` is kept mirrored to that same column
-- by the routes below so both call sites always agree on one real URL;
-- `bot_webhooks` additionally carries what `webhook_url` never had: a
-- signing secret, an enabled flag independent of the bot itself, and a
-- real delivery history.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_webhooks (
  id            TEXT PRIMARY KEY,
  bot_id        TEXT UNIQUE NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  secret_hash   TEXT NOT NULL,
  secret_prefix TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  last_delivery_at     INTEGER,
  last_delivery_code   INTEGER,
  last_delivery_status TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bot_webhooks_bot ON bot_webhooks(bot_id);

CREATE TABLE IF NOT EXISTS bot_webhook_deliveries (
  id             TEXT PRIMARY KEY,
  webhook_id     TEXT NOT NULL REFERENCES bot_webhooks(id) ON DELETE CASCADE,
  -- Stable per-EVENT id (Phase 16 spec: "Stable update/event IDs"). Every
  -- attempt at delivering the same event shares this value — it's how a
  -- receiver is told to dedupe retries of one real occurrence, and how
  -- `attempt` below is counted per event rather than globally.
  event_id       TEXT NOT NULL,
  event_type     TEXT NOT NULL,   -- e.g. 'bot.message.received', 'bot.message.sent', 'bot.webhook.test'
  attempt        INTEGER NOT NULL DEFAULT 1,
  status         TEXT NOT NULL,   -- 'delivered' | 'failed' | 'exhausted'
  response_code  INTEGER,
  latency_ms     INTEGER,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bot_webhook_deliveries ON bot_webhook_deliveries(webhook_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_webhook_deliveries_event ON bot_webhook_deliveries(webhook_id, event_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- WEBHOOKS (dev platform)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhooks (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description         TEXT NOT NULL DEFAULT '',
  url                 TEXT NOT NULL,
  secret_hash         TEXT,
  secret_prefix       TEXT,
  events              TEXT NOT NULL DEFAULT '[]',
  enabled             INTEGER NOT NULL DEFAULT 1,
  last_delivery_at    INTEGER,
  last_delivery_code  INTEGER,
  last_delivery_status TEXT,
  created_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webhooks_user ON webhooks(user_id);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id          TEXT PRIMARY KEY,
  webhook_id  TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event       TEXT NOT NULL,
  status      TEXT NOT NULL, -- 'success' | 'failed'
  code        INTEGER,
  latency_ms  INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries ON webhook_deliveries(webhook_id, created_at DESC);

CREATE TABLE IF NOT EXISTS dev_settings (
  user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ip_allowlist    TEXT NOT NULL DEFAULT '[]',
  require_signing INTEGER NOT NULL DEFAULT 1,
  sandbox_mode    INTEGER NOT NULL DEFAULT 0,
  verbose_logging INTEGER NOT NULL DEFAULT 0,
  beta_access     INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- RELAY GROUPS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS relay_groups (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'online',
  member_count INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);

-- PHASE 18: one durable conversation summary per bot user.
CREATE TABLE IF NOT EXISTS bot_conversations (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  bot_user_id TEXT NOT NULL REFERENCES bot_users(id) ON DELETE CASCADE,
  last_message_id TEXT REFERENCES bot_messages(id) ON DELETE SET NULL,
  last_message_at INTEGER,
  unread_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(bot_id, bot_user_id)
);
CREATE INDEX IF NOT EXISTS idx_bot_conversations_bot_updated ON bot_conversations(bot_id, updated_at DESC);

-- PHASE 19: private metadata for objects held in the existing R2 bucket.
CREATE TABLE IF NOT EXISTS bot_files (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  bot_user_id TEXT REFERENCES bot_users(id) ON DELETE SET NULL,
  object_key TEXT UNIQUE NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bot_files_bot_created ON bot_files(bot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_files_user ON bot_files(bot_id, bot_user_id, created_at DESC);
