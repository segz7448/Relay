-- Phases 18-19 additions are idempotent and non-destructive.
CREATE TABLE IF NOT EXISTS bot_conversations (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, bot_user_id TEXT NOT NULL REFERENCES bot_users(id) ON DELETE CASCADE, last_message_id TEXT REFERENCES bot_messages(id) ON DELETE SET NULL, last_message_at INTEGER, unread_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(bot_id, bot_user_id));
CREATE INDEX IF NOT EXISTS idx_bot_conversations_bot_updated ON bot_conversations(bot_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS bot_files (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, bot_user_id TEXT REFERENCES bot_users(id) ON DELETE SET NULL, object_key TEXT UNIQUE NOT NULL, original_name TEXT NOT NULL, mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_bot_files_bot_created ON bot_files(bot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_files_user ON bot_files(bot_id, bot_user_id, created_at DESC);
