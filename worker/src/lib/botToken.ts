// worker/src/lib/botToken.ts
//
// PHASE 8 — Bot Token Security.
//
// Single shared entry point for validating a raw bot token against the
// database. Every bot-runtime route (currently: the inbound webhook
// endpoint) must go through this instead of hand-rolling its own
// hash-and-lookup, so the validity rules (enabled, not revoked) live in
// exactly one place.
//
// Why hashing the token before lookup is the "constant-time compare" here:
// the raw token is never compared directly against a stored secret in
// application code (which is where timing side-channels on a byte-by-byte
// compare matter). It's SHA-256 hashed first, and the hash is matched via
// an indexed D1 equality lookup. An attacker who doesn't already hold the
// raw token cannot use response-time differences on this query to recover
// it — they'd need a second-preimage of SHA-256. There is no raw-secret
// comparison anywhere on this path; the hash
// step is what removes that class of attack.

import { hashToken } from './keys';

export interface BotRow {
  id: string;
  user_id: string;
  name: string;
  username: string;
  enabled: number;
  token_revoked: number;
  webhook_url: string | null;
  [key: string]: unknown;
}

/**
 * Validate a raw bot token and return the owning bot row, or null if the
 * token is unknown, revoked, or the bot is disabled. Never throws on a bad
 * token — a missing/invalid token is an ordinary "not found" outcome, not
 * an error condition, so callers don't need to try/catch (and so nothing
 * ever ends up interpolating the raw token into an error/log path via a
 * caught exception).
 */
export async function verifyBotToken(db: D1Database, rawToken: string | null | undefined): Promise<BotRow | null> {
  if (!rawToken) return null;
  const tokenHash = await hashToken(rawToken);
  const bot = await db
    .prepare('SELECT * FROM bots WHERE token_hash = ? AND token_revoked = 0')
    .bind(tokenHash)
    .first<BotRow>();
  if (!bot) return null;
  if (!bot.enabled) return null;
  return bot;
}
