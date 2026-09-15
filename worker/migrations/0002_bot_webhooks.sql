-- Phase 16 additions are idempotent and non-destructive.
CREATE TABLE IF NOT EXISTS bot_webhooks (id TEXT PRIMARY KEY, bot_id TEXT UNIQUE NOT NULL REFERENCES bots(id) ON DELETE CASCADE, url TEXT NOT NULL, secret_hash TEXT NOT NULL, secret_prefix TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, last_delivery_at INTEGER, last_delivery_code INTEGER, last_delivery_status TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_bot_webhooks_bot ON bot_webhooks(bot_id);
CREATE TABLE IF NOT EXISTS bot_webhook_deliveries (id TEXT PRIMARY KEY, webhook_id TEXT NOT NULL REFERENCES bot_webhooks(id) ON DELETE CASCADE, event_id TEXT NOT NULL, event_type TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL, response_code INTEGER, latency_ms INTEGER, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_bot_webhook_deliveries ON bot_webhook_deliveries(webhook_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_webhook_deliveries_event ON bot_webhook_deliveries(webhook_id, event_id);
