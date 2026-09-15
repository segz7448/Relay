// worker/src/lib/relayErrors.ts
//
// PHASE 4 — ported concept: "Error handling" from the second ZIP's relay
// reference. One consistent `{ error: code, message }` shape for every
// relay route, instead of the ad hoc `{ error: 'not_found' }` literals
// Phase 3 had scattered inline. Codes are stable identifiers a client can
// branch on; `message` is human-readable and safe to show/log — never
// includes secrets, tokens, or internal detail.

import { Context } from 'hono';

export type RelayErrorCode =
  | 'not_found'
  | 'invalid_cursor'
  | 'rate_limited'
  | 'unauthorized';

const STATUS_BY_CODE: Record<RelayErrorCode, number> = {
  not_found: 404,
  invalid_cursor: 400,
  rate_limited: 429,
  unauthorized: 403,
};

const MESSAGE_BY_CODE: Record<RelayErrorCode, string> = {
  not_found: 'not found or you do not have access',
  invalid_cursor: 'cursor is invalid or expired',
  rate_limited: 'too many relay requests, slow down',
  unauthorized: 'not authorized for this relay resource',
};

export function relayError(c: Context, code: RelayErrorCode) {
  return c.json({ error: code, message: MESSAGE_BY_CODE[code] }, STATUS_BY_CODE[code] as any);
}
