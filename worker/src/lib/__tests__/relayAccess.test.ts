// PHASE 5 — Test relay read authorization.
// PHASE 6 — private-channel enforcement (channel_members).
// PHASE 7 — runs against the REAL D1 binding (`cloudflare:test`'s
// `env.DB`, the actual SQLite-backed D1 implementation via Miniflare, with
// the project's real schema.sql applied — see vitest.config.mts /
// src/test/applySchema.ts), not a hand-rolled fake. Every row below is a
// genuine INSERT against real tables with real foreign keys; every read
// goes through the exact SQL `assertRelayAccess` issues in production.
//
// Covers the spec's prevent-list directly:
//   IDOR / unauthorized server access / unauthorized channel access /
//   cross-user data leakage / cross-server data leakage /
//   cross-channel data leakage / unauthorized member enumeration
// via the shared `assertRelayAccess` gate every relay route now calls.

import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { assertRelayAccess, isRelayMember } from '../relayAccess';

const db = () => env.DB as D1Database;

async function seedUser(id: string) {
  await db().prepare(
    'INSERT INTO users (id, email, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, `${id}@example.com`, id, 'irrelevant-hash', Date.now(), Date.now()).run();
}

async function seedServer(id: string, ownerId: string) {
  await db().prepare(
    `INSERT INTO servers (id, owner_id, name, invite_code, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, ownerId, id, `invite_${id}`, Date.now(), Date.now()).run();
}

async function seedChannel(id: string, serverId: string, opts: { private?: boolean } = {}) {
  await db().prepare(
    'INSERT INTO channels (id, server_id, name, private, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, serverId, id, opts.private ? 1 : 0, Date.now()).run();
}

async function seedMembership(serverId: string, userId: string) {
  await db().prepare(
    `INSERT INTO server_members (id, server_id, user_id, name, username, joined_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(`${serverId}_${userId}`, serverId, userId, userId, userId, Date.now()).run();
}

async function seedChannelMember(channelId: string, userId: string) {
  await db().prepare(
    'INSERT INTO channel_members (id, channel_id, user_id, added_at) VALUES (?, ?, ?, ?)'
  ).bind(`${channelId}_${userId}`, channelId, userId, Date.now()).run();
}

// A fresh, fully-linked fixture: three real users, two real servers (each
// owned by its respective user), a general channel in each, and
// server_members rows making user_1 a member of srv_a only and user_2 a
// member of srv_b only — set up before every test so each test starts
// from the same known-good real data, not a shared mutable fixture.
//
// D1 does not implicitly reset storage between individual `it()` blocks
// in this pool configuration — clear out anything a previous test left
// behind before seeding, rather than assuming isolation. Deleting
// `servers` cascades to `channels` / `server_members` / (via `channels`)
// `channel_members` per their `ON DELETE CASCADE` foreign keys, so this
// is enough to get back to an empty, schema-only database each time.
beforeEach(async () => {
  await db().exec('DELETE FROM servers');
  await db().exec('DELETE FROM users');

  await seedUser('user_1');
  await seedUser('user_2');
  await seedUser('user_3');
  await seedServer('srv_a', 'user_1');
  await seedServer('srv_b', 'user_2');
  await seedChannel('ch_a1', 'srv_a');
  await seedChannel('ch_b1', 'srv_b');
  await seedMembership('srv_a', 'user_1');
  await seedMembership('srv_b', 'user_2');
});

describe('assertRelayAccess — server', () => {
  it('returns the server row for a member of that server', async () => {
    const row = await assertRelayAccess(db(), 'user_1', { kind: 'server', serverId: 'srv_a' });
    expect(row?.id).toBe('srv_a');
  });

  it('IDOR: returns null when the user is not a member of the requested server', async () => {
    // user_1 knows srv_b's id but is not a member of it.
    const row = await assertRelayAccess(db(), 'user_1', { kind: 'server', serverId: 'srv_b' });
    expect(row).toBeNull();
  });

  it('cross-user leakage: a valid member of one server cannot read another user\'s server', async () => {
    const row = await assertRelayAccess(db(), 'user_2', { kind: 'server', serverId: 'srv_a' });
    expect(row).toBeNull();
  });

  it('enumeration: a nonexistent server id returns the same null as an unauthorized one', async () => {
    const unauthorized = await assertRelayAccess(db(), 'user_1', { kind: 'server', serverId: 'srv_b' });
    const nonexistent = await assertRelayAccess(db(), 'user_1', { kind: 'server', serverId: 'srv_does_not_exist' });
    expect(unauthorized).toBeNull();
    expect(nonexistent).toBeNull();
    // Both collapse to the identical route response (`relayError(c, 'not_found')`)
    // — there is no distinguishing signal a client could use to enumerate ids.
  });
});

describe('assertRelayAccess — channel', () => {
  it('returns the channel row when the user is a member of its parent server', async () => {
    const row = await assertRelayAccess(db(), 'user_1', { kind: 'channel', channelId: 'ch_a1' });
    expect(row?.id).toBe('ch_a1');
  });

  it('cross-channel / cross-server leakage: member of server A cannot read a channel in server B', async () => {
    const row = await assertRelayAccess(db(), 'user_1', { kind: 'channel', channelId: 'ch_b1' });
    expect(row).toBeNull();
  });

  it('unauthorized channel access for a user with no membership anywhere', async () => {
    const row = await assertRelayAccess(db(), 'ghost_user', { kind: 'channel', channelId: 'ch_a1' });
    expect(row).toBeNull();
  });
});

describe('assertRelayAccess — private channel (Phase 6)', () => {
  beforeEach(async () => {
    await seedMembership('srv_a', 'user_3'); // user_3 joins srv_a, same server as the private channel
    await seedChannel('ch_a_priv', 'srv_a', { private: true });
    await seedChannelMember('ch_a_priv', 'user_1'); // only user_1 is actually in the private channel
  });

  it('a channel_members row grants a private channel read even though private = 1', async () => {
    const row = await assertRelayAccess(db(), 'user_1', { kind: 'channel', channelId: 'ch_a_priv' });
    expect(row?.id).toBe('ch_a_priv');
  });

  it('server membership alone is NOT enough for a private channel', async () => {
    // user_3 is a real member of srv_a (same server as the private channel,
    // verified via a real server_members row) but has no channel_members
    // row for ch_a_priv.
    const row = await assertRelayAccess(db(), 'user_3', { kind: 'channel', channelId: 'ch_a_priv' });
    expect(row).toBeNull();
  });

  it('a non-private channel in the same server is unaffected by the private gate', async () => {
    const row = await assertRelayAccess(db(), 'user_3', { kind: 'channel', channelId: 'ch_a1' });
    expect(row?.id).toBe('ch_a1');
  });

  it('enumeration: "not a server member" and "private channel, no channel_members row" collapse to the same null', async () => {
    const notServerMember = await assertRelayAccess(db(), 'user_2', { kind: 'channel', channelId: 'ch_a_priv' });
    const serverMemberOnly = await assertRelayAccess(db(), 'user_3', { kind: 'channel', channelId: 'ch_a_priv' });
    expect(notServerMember).toBeNull();
    expect(serverMemberOnly).toBeNull();
  });
});

describe('isRelayMember', () => {
  it('confirms membership', async () => {
    expect(await isRelayMember(db(), 'user_1', 'srv_a')).toBe(true);
  });

  it('unauthorized member enumeration: denies for a user not in that server', async () => {
    expect(await isRelayMember(db(), 'user_1', 'srv_b')).toBe(false);
  });
});
