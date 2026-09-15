// worker/src/lib/relayRateLimit.ts
//
// PHASE 4 — ported concept: "Rate limiting" from the second ZIP's relay
// reference, applied per-user (not per-bot — the existing `rate:{botId}:
// {bucket}` counter in routes/other.ts is a different, Bot-section
// concern and is left untouched).
//
// Fixed-window counter in KV, same style as the existing webhook rate
// counter: one key per (userId, 1-second bucket), short TTL so old
// buckets fall out on their own. This is deliberately simple (a token
// bucket needs read-modify-write with no atomic increment available on
// KV) — good enough to stop accidental hot-polling loops and casual
// abuse across the whole /relay/* surface.
//
// PHASE 5 addition: `checkRelayPollRateLimit` below is the KV token
// bucket the spec calls for specifically on the polling endpoints
// ("Add a rate limiter (KV token bucket) keyed by userId on the polling
// endpoints"), layered on top of this general limiter rather than
// replacing it. Polling is the one relay operation clients are expected
// to call repeatedly and quickly (that's the point of polling), so it
// gets its own, more generous but still bounded, bucket instead of
// sharing the flat per-10s counter every other relay read uses — a
// legitimate fast-polling client shouldn't get throttled off /servers or
// /messages just because it's also polling a channel.

const DEFAULT_LIMIT_PER_WINDOW = 20; // requests
const WINDOW_SEC = 10;
// Cloudflare KV rejects any `expirationTtl` under 60 seconds (a real
// platform constraint the previous fake KV test double didn't model, so
// this went undetected — see notes/07-real-test-harness.md). The bucket
// key itself already rotates every `windowSec` seconds regardless of
// this TTL; the TTL only needs to be at least long enough for the key to
// still exist through that rotation, floored at what KV will actually
// accept.
const MIN_KV_TTL_SEC = 60;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
}

export async function checkRelayRateLimit(
  kv: KVNamespace,
  userId: string,
  limit = DEFAULT_LIMIT_PER_WINDOW,
  windowSec = WINDOW_SEC,
): Promise<RateLimitResult> {
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  const key = `relay_rate:${userId}:${bucket}`;

  const current = Number((await kv.get(key)) ?? '0');
  if (current >= limit) {
    return { allowed: false, remaining: 0, limit };
  }

  // Best-effort increment — KV has no atomic counter, so under heavy
  // concurrent load this can under-count slightly. That failure mode
  // (a few extra requests slip through) is the safe direction for a
  // read-only endpoint; it never blocks a legitimate request outright.
  await kv.put(key, String(current + 1), { expirationTtl: Math.max(windowSec * 2, MIN_KV_TTL_SEC) });
  return { allowed: true, remaining: limit - current - 1, limit };
}

// ── Token bucket, keyed by userId, for polling endpoints (Phase 5) ────────────

export interface TokenBucketResult {
  allowed: boolean;
  remaining: number;
  capacity: number;
}

const POLL_BUCKET_CAPACITY = 30; // burst allowance (e.g. reconnect fan-out across several open channels)
const POLL_REFILL_PER_SEC = 1;   // steady-state: ~1 poll/sec/user, refilled continuously
const POLL_BUCKET_TTL_SEC = 3600;

/**
 * Lazy-refill token bucket stored as one small JSON value per userId in
 * KV. "Lazy" because KV has no server-side timer/cron primitive to drain
 * tokens on a schedule — instead, every call computes how many tokens
 * would have refilled since the bucket's last-seen timestamp, applies
 * that, then spends one token. This is the standard way to implement a
 * token bucket on a plain read/write KV store.
 *
 * Concurrency note: like `checkRelayRateLimit` above, this is
 * read-modify-write, not atomic — under heavy concurrent polling from
 * the same user (e.g. many tabs) a few extra requests can slip through
 * a race window. That failure mode (occasionally under-throttling) is
 * the safe direction for a read-only endpoint that never mutates state;
 * it never wrongly locks a legitimate user out.
 */
export async function checkRelayPollRateLimit(
  kv: KVNamespace,
  userId: string,
  capacity = POLL_BUCKET_CAPACITY,
  refillPerSec = POLL_REFILL_PER_SEC,
): Promise<TokenBucketResult> {
  const key = `relay_poll_bucket:${userId}`;
  const now = Date.now();

  let tokens = capacity;
  const raw = await kv.get(key);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { tokens: number; last: number };
      const elapsedSec = Math.max(0, (now - parsed.last) / 1000);
      tokens = Math.min(capacity, parsed.tokens + elapsedSec * refillPerSec);
    } catch {
      // Corrupt/unexpected bucket value — reset to a full bucket rather
      // than failing the request; a read-only polling endpoint should
      // fail open toward availability here, not lock the user out.
      tokens = capacity;
    }
  }

  if (tokens < 1) {
    await kv.put(key, JSON.stringify({ tokens, last: now }), { expirationTtl: POLL_BUCKET_TTL_SEC });
    return { allowed: false, remaining: 0, capacity };
  }

  tokens -= 1;
  await kv.put(key, JSON.stringify({ tokens, last: now }), { expirationTtl: POLL_BUCKET_TTL_SEC });
  return { allowed: true, remaining: Math.floor(tokens), capacity };
}
