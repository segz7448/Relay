// PHASE 5 — Test relay polling rate limiting ("Unauthorized polling" /
// abuse prevention in the spec's prevent-list).
// PHASE 7 — runs against the REAL KV binding (`cloudflare:test`'s `env.KV`,
// backed by the actual Workers runtime via Miniflare), not a fake. This
// pool does not reset KV storage between individual `it()` blocks, so
// each test below uses its own userId (rather than a shared 'user_1') to
// avoid reading another test's leftover bucket state.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkRelayPollRateLimit, checkRelayRateLimit } from '../relayRateLimit';
import { env } from 'cloudflare:test';

afterEach(() => {
  vi.useRealTimers();
});

describe('checkRelayPollRateLimit — token bucket keyed by userId', () => {
  it('allows requests up to capacity, then blocks', async () => {
    const kv = env.KV;
    const capacity = 5;
    for (let i = 0; i < capacity; i++) {
      const r = await checkRelayPollRateLimit(kv, 'poll_burst_user', capacity, 0 /* no refill during burst */);
      expect(r.allowed).toBe(true);
    }
    const blocked = await checkRelayPollRateLimit(kv, 'poll_burst_user', capacity, 0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('buckets are independent per userId — one user cannot exhaust another\'s allowance', async () => {
    const kv = env.KV;
    const capacity = 2;
    await checkRelayPollRateLimit(kv, 'poll_indep_a', capacity, 0);
    await checkRelayPollRateLimit(kv, 'poll_indep_a', capacity, 0);
    const user1Blocked = await checkRelayPollRateLimit(kv, 'poll_indep_a', capacity, 0);
    expect(user1Blocked.allowed).toBe(false);

    const user2 = await checkRelayPollRateLimit(kv, 'poll_indep_b', capacity, 0);
    expect(user2.allowed).toBe(true);
  });

  it('refills over time at the configured rate', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const kv = env.KV;
    const capacity = 3;
    const refillPerSec = 1;
    const userId = 'poll_refill_user';

    for (let i = 0; i < capacity; i++) {
      expect((await checkRelayPollRateLimit(kv, userId, capacity, refillPerSec)).allowed).toBe(true);
    }
    expect((await checkRelayPollRateLimit(kv, userId, capacity, refillPerSec)).allowed).toBe(false);

    // Advance 2 seconds -> ~2 tokens refilled.
    vi.setSystemTime(2000);
    expect((await checkRelayPollRateLimit(kv, userId, capacity, refillPerSec)).allowed).toBe(true);
    expect((await checkRelayPollRateLimit(kv, userId, capacity, refillPerSec)).allowed).toBe(true);
    expect((await checkRelayPollRateLimit(kv, userId, capacity, refillPerSec)).allowed).toBe(false);
  });
});

describe('checkRelayRateLimit — general per-surface limiter (regression guard)', () => {
  it('still enforces the fixed-window limit unchanged by Phase 5', async () => {
    const kv = env.KV;
    const limit = 3;
    const userId = 'fixed_window_user';
    for (let i = 0; i < limit; i++) {
      expect((await checkRelayRateLimit(kv, userId, limit, 10)).allowed).toBe(true);
    }
    expect((await checkRelayRateLimit(kv, userId, limit, 10)).allowed).toBe(false);
  });

  it('PHASE 7 regression guard: a real KV `expirationTtl` under 60s (e.g. a small windowSec) does not throw — this is the exact bug real KV caught that the old fake KV test double missed entirely', async () => {
    const kv = env.KV;
    // windowSec=10 -> naive `windowSec * 2` = 20, which real Cloudflare KV
    // rejects outright (`Invalid expiration_ttl ... must be at least 60`).
    // This is also the DEFAULT windowSec `relay.ts`'s global rate-limit
    // middleware calls with on every single /relay/* request — before this
    // fix, every relay request would have thrown in production.
    await expect(checkRelayRateLimit(kv, 'ttl_guard_user', 20, 10)).resolves.toEqual(
      expect.objectContaining({ allowed: true })
    );
  });
});
