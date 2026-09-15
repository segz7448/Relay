// PHASE 8 — Bot Token Security, end to end.
//
// Same real-HTTP, real-D1 approach as privateChannels.e2e.test.ts: real
// requests through the actual exported Worker (`SELF.fetch`), a real
// login and real JWT, against the real D1 database with the real schema
// applied. Nothing here is mocked.
//
// Covers the spec directly:
//   - raw token is never returned from a normal GET
//   - rotation invalidates the old token immediately (no overlap window)
//   - revocation invalidates the token immediately, without issuing a
//     replacement
//   - rotating a revoked bot's token brings it back to life
//   - one owner can't rotate/revoke another owner's bot

import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { hashPassword } from '../../lib/keys';

const db = () => env.DB as D1Database;

async function seedUser(id: string, password: string) {
  const passwordHash = await hashPassword(password);
  await db().prepare(
    'INSERT INTO users (id, email, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, `${id}@example.com`, id, passwordHash, Date.now(), Date.now()).run();
}

async function login(username: string, password: string): Promise<string> {
  const res = await SELF.fetch('https://worker.test/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: username, password }),
  });
  expect(res.status).toBe(200);
  const body = await res.json<{ sessionToken: string }>();
  return body.sessionToken;
}

function authed(token: string, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  };
}

async function hitWebhook(token: string) {
  return SELF.fetch(`https://worker.test/webhook/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'ping' }),
  });
}

beforeEach(async () => {
  // This pool does not reset storage between individual `it()` blocks
  // (same note as the other Phase 7 e2e file).
  await db().exec('DELETE FROM bot_messages');
  await db().exec('DELETE FROM bot_users');
  await db().exec('DELETE FROM bots');
  await db().exec('DELETE FROM sessions');
  await db().exec('DELETE FROM users');
});

describe('bot token security — real HTTP end to end', () => {
  it('GET /bots/:id and the create response never leak token_hash; only tokenPrefix is present after creation', async () => {
    await seedUser('bot_owner_1', 'owner-password-123');
    const ownerToken = await login('bot_owner_1', 'owner-password-123');

    const createRes = await SELF.fetch('https://worker.test/bots', authed(ownerToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'Test Bot', username: 'test_bot_1' }),
    }));
    expect(createRes.status).toBe(201);
    const created = await createRes.json<any>();
    expect(created.token).toMatch(/^\d+:[0-9a-f]{40}$/); // shown once, on creation only
    expect(created.token_hash).toBeUndefined();

    const getRes = await SELF.fetch(`https://worker.test/bots/${created.id}`, authed(ownerToken));
    const fetched = await getRes.json<any>();
    expect(fetched.token).toBeUndefined();
    expect(fetched.token_hash).toBeUndefined();
    expect(fetched.tokenPrefix).toBe(created.tokenPrefix);
  });

  it('the freshly created token authenticates against the webhook route', async () => {
    await seedUser('bot_owner_2', 'owner-password-123');
    const ownerToken = await login('bot_owner_2', 'owner-password-123');

    const createRes = await SELF.fetch('https://worker.test/bots', authed(ownerToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'Webhook Bot', username: 'webhook_bot_1' }),
    }));
    const created = await createRes.json<{ token: string }>();

    const webhookRes = await hitWebhook(created.token);
    expect(webhookRes.status).toBe(200);
  });

  it('rotating the token invalidates the old one immediately — no window where both work', async () => {
    await seedUser('bot_owner_3', 'owner-password-123');
    const ownerToken = await login('bot_owner_3', 'owner-password-123');

    const createRes = await SELF.fetch('https://worker.test/bots', authed(ownerToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'Rotate Bot', username: 'rotate_bot_1' }),
    }));
    const created = await createRes.json<{ id: string; token: string }>();

    const rotateRes = await SELF.fetch(`https://worker.test/bots/${created.id}/rotate-token`, authed(ownerToken, { method: 'POST' }));
    expect(rotateRes.status).toBe(200);
    const rotated = await rotateRes.json<{ token: string }>();
    expect(rotated.token).not.toBe(created.token);

    // Old token is dead.
    const oldTokenRes = await hitWebhook(created.token);
    expect(oldTokenRes.status).toBe(404);

    // New token works.
    const newTokenRes = await hitWebhook(rotated.token);
    expect(newTokenRes.status).toBe(200);
  });

  it('revoking the token invalidates it immediately without issuing a replacement, and is reflected on the bot record', async () => {
    await seedUser('bot_owner_4', 'owner-password-123');
    const ownerToken = await login('bot_owner_4', 'owner-password-123');

    const createRes = await SELF.fetch('https://worker.test/bots', authed(ownerToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'Revoke Bot', username: 'revoke_bot_1' }),
    }));
    const created = await createRes.json<{ id: string; token: string }>();

    // Works before revocation.
    expect((await hitWebhook(created.token)).status).toBe(200);

    const revokeRes = await SELF.fetch(`https://worker.test/bots/${created.id}/revoke-token`, authed(ownerToken, { method: 'POST' }));
    expect(revokeRes.status).toBe(200);
    const revokeBody = await revokeRes.json<{ revoked: boolean }>();
    expect(revokeBody.revoked).toBe(true);

    // Dead immediately after.
    expect((await hitWebhook(created.token)).status).toBe(404);

    const getRes = await SELF.fetch(`https://worker.test/bots/${created.id}`, authed(ownerToken));
    const fetched = await getRes.json<{ tokenRevoked: boolean }>();
    expect(fetched.tokenRevoked).toBe(true);
  });

  it('rotating a revoked bot brings it back to life with a fresh, working token', async () => {
    await seedUser('bot_owner_5', 'owner-password-123');
    const ownerToken = await login('bot_owner_5', 'owner-password-123');

    const createRes = await SELF.fetch('https://worker.test/bots', authed(ownerToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'Revive Bot', username: 'revive_bot_1' }),
    }));
    const created = await createRes.json<{ id: string; token: string }>();

    await SELF.fetch(`https://worker.test/bots/${created.id}/revoke-token`, authed(ownerToken, { method: 'POST' }));
    expect((await hitWebhook(created.token)).status).toBe(404);

    const rotateRes = await SELF.fetch(`https://worker.test/bots/${created.id}/rotate-token`, authed(ownerToken, { method: 'POST' }));
    const rotated = await rotateRes.json<{ token: string }>();
    expect((await hitWebhook(rotated.token)).status).toBe(200);

    const getRes = await SELF.fetch(`https://worker.test/bots/${created.id}`, authed(ownerToken));
    const fetched = await getRes.json<{ tokenRevoked: boolean }>();
    expect(fetched.tokenRevoked).toBe(false);
  });

  it('one owner cannot rotate or revoke another owner\'s bot', async () => {
    await seedUser('bot_owner_6', 'owner-password-123');
    await seedUser('bot_intruder_6', 'intruder-password-123');
    const ownerToken = await login('bot_owner_6', 'owner-password-123');
    const intruderToken = await login('bot_intruder_6', 'intruder-password-123');

    const createRes = await SELF.fetch('https://worker.test/bots', authed(ownerToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'Owned Bot', username: 'owned_bot_1' }),
    }));
    const created = await createRes.json<{ id: string; token: string }>();

    const rotateAttempt = await SELF.fetch(`https://worker.test/bots/${created.id}/rotate-token`, authed(intruderToken, { method: 'POST' }));
    expect(rotateAttempt.status).toBe(404);

    const revokeAttempt = await SELF.fetch(`https://worker.test/bots/${created.id}/revoke-token`, authed(intruderToken, { method: 'POST' }));
    expect(revokeAttempt.status).toBe(404);

    // Original token still works — the intruder's failed attempts changed nothing.
    expect((await hitWebhook(created.token)).status).toBe(200);
  });
});
