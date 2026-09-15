// worker/src/lib/relayCursor.ts
//
// PHASE 4 — ported concept: "Monotonic message IDs / Message ordering /
// Cursor-based polling / Cursor manipulation prevention" from the second
// ZIP's relay reference.
//
// Cursors here are still opaque (the client never sees a raw offset), but
// they are now HMAC-signed with a key derived from JWT_SECRET (via
// relaySigning.hmacSign) instead of being plain base64. That closes the
// gap Phase 5 explicitly calls out ("Cursor manipulation" in the list of
// things to prevent): before this change, a client could hand-edit a
// base64 "ts:id" string to an arbitrary value and the server would
// happily page from it; now any edited cursor fails signature
// verification and is rejected as `invalid_cursor`, the same error shape
// as a malformed one, so it leaks no information about why it failed.
//
// Ordering itself comes from the existing D1 columns (`created_at`, `id`)
// on channel_messages, which is already a durable, monotonic-enough
// ordering key for this app's write pattern (server-assigned
// created_at + ULID-ish id) — no new sequence column was needed.

import { hmacSign, hmacVerify } from './relaySigning';

const CURSOR_PURPOSE = 'channel-cursor';

export interface DecodedCursor {
  ts: number;
  id: string;
}

/** Build a signed, opaque cursor from a message row's ordering key. */
export async function encodeCursor(row: { created_at: number; id: string }, secret: string): Promise<string> {
  const raw = `${row.created_at}:${row.id}`;
  const sig = await hmacSign(raw, secret, CURSOR_PURPOSE);
  return base64url(`${raw}:${sig}`);
}

/**
 * Decode + verify a cursor. Returns null for anything malformed OR
 * tampered with — callers should treat both the same way (400
 * `invalid_cursor`) so a bad signature doesn't reveal that the format was
 * otherwise well-formed.
 */
export async function decodeCursor(cursor: string, secret: string): Promise<DecodedCursor | null> {
  try {
    const decoded = base64urlDecode(cursor);
    const parts = decoded.split(':');
    if (parts.length !== 3) return null;
    const [tsStr, id, sig] = parts;
    const ts = Number(tsStr);
    if (!id || Number.isNaN(ts)) return null;

    const valid = await hmacVerify(`${tsStr}:${id}`, sig, secret, CURSOR_PURPOSE);
    if (!valid) return null;

    return { ts, id };
  } catch {
    return null;
  }
}

function base64url(s: string): string {
  return btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function base64urlDecode(s: string): string {
  return atob(s.replace(/-/g, '+').replace(/_/g, '/'));
}
