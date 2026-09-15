// worker/src/lib/relayPagination.ts
//
// PHASE 4 — ported concept: "Pagination / Message size limits" from the
// second ZIP's relay reference, generalized into one shape reused across
// every relay list endpoint (servers, members, channels, messages) rather
// than the message-list-only pagination Phase 3 shipped with.

export interface RelayPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export const DEFAULT_RELAY_PAGE_SIZE = 50;
export const MAX_RELAY_PAGE_SIZE = 100;

/** Clamp a client-supplied `limit` query param into a safe range. */
export function clampLimit(raw: string | undefined, fallback = DEFAULT_RELAY_PAGE_SIZE): number {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_RELAY_PAGE_SIZE);
}

export function buildPage<T>(items: T[], limit: number, nextCursor: string | null): RelayPage<T> {
  return { items, nextCursor, hasMore: !!nextCursor && items.length === limit };
}

// Relay is read-only, so this doesn't gate writes — it caps how much
// text the relay will ever echo back for one message field in a single
// response, so one oversized row can't blow out a page's response size.
// Existing rows longer than this are truncated defensively at read time,
// with a flag so the UI can indicate truncation; the underlying stored
// text (written by the ordinary chat-send path in servers.ts, out of
// scope for this read-only relay) is left untouched.
export const MAX_RELAY_MESSAGE_TEXT_CHARS = 8000;

export function guardMessageText(text: string | null | undefined): { text: string | null; truncated: boolean } {
  if (!text) return { text: text ?? null, truncated: false };
  if (text.length <= MAX_RELAY_MESSAGE_TEXT_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_RELAY_MESSAGE_TEXT_CHARS), truncated: true };
}
