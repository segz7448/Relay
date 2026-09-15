// PHASE 6 — private channel membership, end to end.
// PHASE 7 — genuine HTTP integration test: real requests dispatched
// through the actual exported Worker (`SELF.fetch`, from `cloudflare:test`
// — the real `src/index.ts` default export, running in the real Workers
// runtime), hitting real routes (`/auth/login`, `/servers/*`,
// `/relay/*`), with a real JWT issued by the real `/auth/login` endpoint
// (password hashed for real via `hashPassword`, verified for real by that
// endpoint), against the real D1 database with the real schema applied.
// Nothing here is mocked: no fake fetch, no fake auth, no stubbed D1/KV.
//
// This is exactly the class of test the project was previously missing —
// see the second remaining issue flagged since Phase 5: "No Miniflare/
// Workers test-pool harness exists in this project ... not full HTTP
// integration tests." It also happens to be the most direct possible
// proof that the Phase 6 fix actually works: a real HTTP client, with a
// real session, gets a real 404 from a real private channel it isn't in.

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

beforeEach(async () => {
  // Same reasoning as the other Phase 7 test files: this pool does not
  // reset storage between individual `it()` blocks.
  await db().exec('DELETE FROM sessions');
  await db().exec('DELETE FROM servers');
  await db().exec('DELETE FROM users');
});

describe('private channels — real HTTP end to end', () => {
  it('owner can read their own private channel; a server member who is not a channel member gets 404 on BOTH routers; adding them via the real endpoint grants access on BOTH routers', async () => {
    await seedUser('owner_e2e', 'owner-password-123');
    await seedUser('outsider_e2e', 'outsider-password-123');
    const ownerToken = await login('owner_e2e', 'owner-password-123');
    const outsiderToken = await login('outsider_e2e', 'outsider-password-123');

    // 1. Owner creates a real server via the real endpoint.
    const createServerRes = await SELF.fetch('https://worker.test/servers', authed(ownerToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'Phase 7 Test Server' }),
    }));
    expect(createServerRes.status).toBe(201);
    const server = await createServerRes.json<{ id: string }>();

    // 2. Owner creates a real private channel via the real endpoint.
    const createChannelRes = await SELF.fetch(`https://worker.test/servers/${server.id}/channels`, authed(ownerToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'mods-only', private: true }),
    }));
    expect(createChannelRes.status).toBe(201);
    const channel = await createChannelRes.json<{ id: string; private: boolean }>();
    expect(channel.private).toBe(true);

    // 3. Owner (grandfathered in on creation) can read its messages via
    // the native servers.ts router.
    const ownerReadsNative = await SELF.fetch(
      `https://worker.test/servers/${server.id}/channels/${channel.id}/messages`,
      authed(ownerToken)
    );
    expect(ownerReadsNative.status).toBe(200);

    // 4. Owner can also read it via the read-only relay router — same
    // gate, same table, different router.
    const ownerReadsRelay = await SELF.fetch(
      `https://worker.test/relay/channels/${channel.id}`,
      authed(ownerToken)
    );
    expect(ownerReadsRelay.status).toBe(200);

    // 5. Make the outsider a real SERVER member (there's no self-serve
    // join flow in this app yet — see servers.ts's own "single-owner"
    // note — so this row is what a future join-by-invite flow would
    // produce; everything downstream of it is exercised for real).
    await db().prepare(
      `INSERT INTO server_members (id, server_id, user_id, name, username, joined_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind('outsider_membership', server.id, 'outsider_e2e', 'outsider_e2e', 'outsider_e2e', Date.now()).run();

    // 6. THE CORE REGRESSION TEST: a real server member, with a real
    // session, hitting the real route, gets a real 404 for the private
    // channel they haven't been added to — on both routers. Before the
    // Phase 6 fix this would have been 200 on both.
    const outsiderBlockedNative = await SELF.fetch(
      `https://worker.test/servers/${server.id}/channels/${channel.id}/messages`,
      authed(outsiderToken)
    );
    expect(outsiderBlockedNative.status).toBe(404);

    const outsiderBlockedRelay = await SELF.fetch(
      `https://worker.test/relay/channels/${channel.id}`,
      authed(outsiderToken)
    );
    expect(outsiderBlockedRelay.status).toBe(404);

    // 7. Owner adds the outsider via the real membership-management
    // endpoint added in Phase 6.
    const addMemberRes = await SELF.fetch(
      `https://worker.test/servers/${server.id}/channels/${channel.id}/members`,
      authed(ownerToken, { method: 'POST', body: JSON.stringify({ userId: 'outsider_e2e' }) })
    );
    expect(addMemberRes.status).toBe(201);

    // 8. Now the same requests, from the same session token, succeed —
    // on both routers, with no new login and no other state change.
    const outsiderNowAllowedNative = await SELF.fetch(
      `https://worker.test/servers/${server.id}/channels/${channel.id}/messages`,
      authed(outsiderToken)
    );
    expect(outsiderNowAllowedNative.status).toBe(200);

    const outsiderNowAllowedRelay = await SELF.fetch(
      `https://worker.test/relay/channels/${channel.id}`,
      authed(outsiderToken)
    );
    expect(outsiderNowAllowedRelay.status).toBe(200);
  });

  it('a non-private channel is unaffected: a plain server member can read it with no membership grant needed', async () => {
    await seedUser('owner_e2e2', 'owner-password-123');
    await seedUser('member_e2e2', 'member-password-123');
    const ownerToken = await login('owner_e2e2', 'owner-password-123');
    const memberToken = await login('member_e2e2', 'member-password-123');

    const createServerRes = await SELF.fetch('https://worker.test/servers', authed(ownerToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'Phase 7 Test Server 2' }),
    }));
    const server = await createServerRes.json<{ id: string; channels?: Array<{ id: string; name: string }> }>();

    await db().prepare(
      `INSERT INTO server_members (id, server_id, user_id, name, username, joined_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind('member_e2e2_membership', server.id, 'member_e2e2', 'member_e2e2', 'member_e2e2', Date.now()).run();

    // Every new server gets a default, non-private "general" channel
    // (see servers.ts's POST / handler) — fetch it for real rather than
    // assuming its id.
    const generalChannel = await db().prepare(
      'SELECT id FROM channels WHERE server_id = ? AND private = 0'
    ).bind(server.id).first<{ id: string }>();
    expect(generalChannel).toBeTruthy();

    const memberReads = await SELF.fetch(
      `https://worker.test/servers/${server.id}/channels/${generalChannel!.id}/messages`,
      authed(memberToken)
    );
    expect(memberReads.status).toBe(200);
  });
});
