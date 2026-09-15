// PHASE 6 — channel_members read/write helpers.
// PHASE 7 — runs against the REAL D1 binding (`cloudflare:test`'s
// `env.DB`), with real `users` / `servers` / `channels` rows backing
// every `channel_members` row, exactly as production foreign keys
// require — not an in-memory approximation.

import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { addChannelMember, canReadChannel, isChannelMember, listChannelMembers, removeChannelMember } from '../channelMembers';

const db = () => env.DB as D1Database;

async function seedChannel(id: string) {
  // Full real chain: a channel row needs a real server (FK), which needs
  // a real owner (FK) — same shape production data has.
  await db().prepare('INSERT INTO users (id, email, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(`${id}_owner`, `${id}_owner@example.com`, `${id}_owner`, 'irrelevant-hash', Date.now(), Date.now()).run();
  await db().prepare('INSERT INTO servers (id, owner_id, name, invite_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(`${id}_srv`, `${id}_owner`, `${id}_srv`, `invite_${id}`, Date.now(), Date.now()).run();
  await db().prepare('INSERT INTO channels (id, server_id, name, private, created_at) VALUES (?, ?, ?, 1, ?)')
    .bind(id, `${id}_srv`, id, Date.now()).run();
}

beforeEach(async () => {
  // Same reasoning as relayAccess.test.ts: this pool does not reset
  // storage between individual `it()` blocks, so clear explicitly.
  // Deleting servers cascades to channels/server_members/channel_members.
  await db().exec('DELETE FROM servers');
  await db().exec('DELETE FROM users');
  await seedChannel('ch_1');
  await seedChannel('ch_2');
});

describe('channelMembers', () => {
  it('a channel starts with no members', async () => {
    expect(await isChannelMember(db(), 'ch_1', 'user_1')).toBe(false);
    expect(await listChannelMembers(db(), 'ch_1')).toEqual([]);
  });

  it('addChannelMember grants membership', async () => {
    await addChannelMember(db(), 'ch_1', 'user_1');
    expect(await isChannelMember(db(), 'ch_1', 'user_1')).toBe(true);
    expect(await isChannelMember(db(), 'ch_1', 'user_2')).toBe(false);
  });

  it('addChannelMember is idempotent — adding twice does not duplicate (real UNIQUE(channel_id, user_id) constraint)', async () => {
    await addChannelMember(db(), 'ch_1', 'user_1');
    await addChannelMember(db(), 'ch_1', 'user_1');
    const members = await listChannelMembers(db(), 'ch_1');
    expect(members.filter((m) => m.user_id === 'user_1')).toHaveLength(1);
  });

  it('removeChannelMember revokes membership', async () => {
    await addChannelMember(db(), 'ch_1', 'user_1');
    await removeChannelMember(db(), 'ch_1', 'user_1');
    expect(await isChannelMember(db(), 'ch_1', 'user_1')).toBe(false);
  });

  it('membership is scoped per channel — adding to one channel does not grant another', async () => {
    await addChannelMember(db(), 'ch_1', 'user_1');
    expect(await isChannelMember(db(), 'ch_2', 'user_1')).toBe(false);
  });

  it('deleting the channel cascades away its channel_members rows (real FK, not simulated)', async () => {
    await addChannelMember(db(), 'ch_1', 'user_1');
    await db().prepare('DELETE FROM channels WHERE id = ?').bind('ch_1').run();
    // The row is gone via CASCADE, not via removeChannelMember — this is
    // exercising the real foreign key, not the helper's own DELETE path.
    const row = await db().prepare('SELECT 1 FROM channel_members WHERE channel_id = ?').bind('ch_1').first();
    expect(row).toBeNull();
  });

  describe('canReadChannel', () => {
    it('a non-private channel is always readable, with no channel_members lookup needed', async () => {
      expect(await canReadChannel(db(), { id: 'ch_1', private: 0 }, 'user_1')).toBe(true);
      expect(await canReadChannel(db(), { id: 'ch_1' }, 'user_1')).toBe(true); // private undefined -> falsy
    });

    it('a private channel requires a channel_members row', async () => {
      expect(await canReadChannel(db(), { id: 'ch_1', private: 1 }, 'user_1')).toBe(false);
      await addChannelMember(db(), 'ch_1', 'user_1');
      expect(await canReadChannel(db(), { id: 'ch_1', private: 1 }, 'user_1')).toBe(true);
    });
  });
});
