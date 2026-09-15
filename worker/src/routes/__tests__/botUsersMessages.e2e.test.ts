// PHASE 12 — Bot API: Users & Messages Endpoints, end to end.
//
// Same real-HTTP, real-D1 approach as the other e2e files in this folder:
// real requests through the actual exported Worker (`SELF.fetch`), a real
// login and real JWT, against the real D1 database with the real schema
// applied. Nothing here is mocked.
//
// Covers, directly against the spec:
//   - Users: list, get (dedicated), generic PATCH, block/unblock/mute/
//     unmute as dedicated actions, delete (message history kept)
//   - cross-bot isolation on every one of the above
//   - Messages: outbound send + shape, per-user history + shape/ordering,
//     bot-wide activity log
//   - inbound messages via the public per-bot webhook (already-existing
//     Phase 8 surface) land in the same history
//   - the enforcement this phase adds: a blocked bot-user's inbound
//     messages are dropped entirely (not stored, not counted, not
//     forwarded); a muted bot-user's messages are unaffected (mute is a
//     notification preference, not a block)

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

async function createBot(token: string, body: Record<string, unknown>) {
  const res = await SELF.fetch('https://worker.test/bots', authed(token, {
    method: 'POST',
    body: JSON.stringify(body),
  }));
  expect(res.status).toBe(201);
  return res.json<any>();
}

// Inserts a bot_users row directly — this phase's routes never create bot
// users themselves (that only happens via the inbound webhook, tested
// separately below), so every "users" test seeds one straight into D1,
// exactly the way a real inbound message would have created it.
async function seedBotUser(botId: string, id: string, overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  await db().prepare(
    `INSERT INTO bot_users (id, bot_id, name, username, joined_at, last_active_at, message_count, blocked, muted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, botId,
    (overrides.name as string) ?? 'Ann Example',
    (overrides.username as string) ?? 'ann_example',
    (overrides.joinedAt as number) ?? now,
    (overrides.lastActiveAt as number) ?? now,
    (overrides.messageCount as number) ?? 0,
    overrides.blocked ? 1 : 0,
    overrides.muted ? 1 : 0,
  ).run();
}

async function hitWebhook(token: string, body: Record<string, unknown>) {
  return SELF.fetch(`https://worker.test/webhook/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  // This pool does not reset storage between individual `it()` blocks
  // (same note as the other e2e files in this folder).
  await db().exec('DELETE FROM bot_messages');
  await db().exec('DELETE FROM bot_users');
  await db().exec('DELETE FROM bot_analytics');
  await db().exec('DELETE FROM bot_commands');
  await db().exec('DELETE FROM bots');
  await db().exec('DELETE FROM sessions');
  await db().exec('DELETE FROM users');
});

describe('bot users — real HTTP end to end', () => {
  it('list and dedicated get, with a clean 404 for an unknown user', async () => {
    await seedUser('bu_owner_1', 'owner-password-123');
    const token = await login('bu_owner_1', 'owner-password-123');
    const bot = await createBot(token, { name: 'Users Bot', username: 'users_bot_1' });
    await seedBotUser(bot.id, 'bu1', { name: 'Ann', username: 'ann' });
    await seedBotUser(bot.id, 'bu2', { name: 'Ben', username: 'ben' });

    const listRes = await SELF.fetch(`https://worker.test/bots/${bot.id}/users`, authed(token));
    expect(listRes.status).toBe(200);
    const list = await listRes.json<any[]>();
    expect(list.map((u) => u.id).sort()).toEqual(['bu1', 'bu2']);
    // camelCase shape — matches botUserShape in worker/src/routes/bots.ts
    expect(list[0].lastActiveAt).toBeDefined();
    expect((list[0] as any).last_active_at).toBeUndefined();

    const getRes = await SELF.fetch(`https://worker.test/bots/${bot.id}/users/bu1`, authed(token));
    expect(getRes.status).toBe(200);
    const fetched = await getRes.json<any>();
    expect(fetched.id).toBe('bu1');
    expect(fetched.name).toBe('Ann');
    expect(fetched.blocked).toBe(false);
    expect(fetched.muted).toBe(false);

    const missingRes = await SELF.fetch(`https://worker.test/bots/${bot.id}/users/does-not-exist`, authed(token));
    expect(missingRes.status).toBe(404);
  });

  it('generic PATCH updates blocked/muted', async () => {
    await seedUser('bu_owner_2', 'owner-password-123');
    const token = await login('bu_owner_2', 'owner-password-123');
    const bot = await createBot(token, { name: 'Patch Bot', username: 'patch_bot_1' });
    await seedBotUser(bot.id, 'bu1');

    const res = await SELF.fetch(`https://worker.test/bots/${bot.id}/users/bu1`, authed(token, {
      method: 'PATCH', body: JSON.stringify({ blocked: true, muted: true }),
    }));
    expect(res.status).toBe(200);
    const updated = await res.json<any>();
    expect(updated.blocked).toBe(true);
    expect(updated.muted).toBe(true);
  });

  it('dedicated block/unblock/mute/unmute set the target state directly, independent of each other', async () => {
    await seedUser('bu_owner_3', 'owner-password-123');
    const token = await login('bu_owner_3', 'owner-password-123');
    const bot = await createBot(token, { name: 'Toggle Bot', username: 'toggle_users_bot_1' });
    await seedBotUser(bot.id, 'bu1');

    const block = await SELF.fetch(`https://worker.test/bots/${bot.id}/users/bu1/block`, authed(token, { method: 'POST' }));
    expect(block.status).toBe(200);
    expect((await block.json<any>()).blocked).toBe(true);

    const mute = await SELF.fetch(`https://worker.test/bots/${bot.id}/users/bu1/mute`, authed(token, { method: 'POST' }));
    expect(mute.status).toBe(200);
    const afterMute = await mute.json<any>();
    expect(afterMute.muted).toBe(true);
    expect(afterMute.blocked).toBe(true); // muting doesn't touch the independent blocked flag

    const unblock = await SELF.fetch(`https://worker.test/bots/${bot.id}/users/bu1/unblock`, authed(token, { method: 'POST' }));
    expect(unblock.status).toBe(200);
    const afterUnblock = await unblock.json<any>();
    expect(afterUnblock.blocked).toBe(false);
    expect(afterUnblock.muted).toBe(true); // unblocking doesn't touch the independent muted flag

    const unmute = await SELF.fetch(`https://worker.test/bots/${bot.id}/users/bu1/unmute`, authed(token, { method: 'POST' }));
    expect(unmute.status).toBe(200);
    expect((await unmute.json<any>()).muted).toBe(false);

    // Calling block twice in a row is idempotent, not a toggle.
    await SELF.fetch(`https://worker.test/bots/${bot.id}/users/bu1/block`, authed(token, { method: 'POST' }));
    const secondBlock = await SELF.fetch(`https://worker.test/bots/${bot.id}/users/bu1/block`, authed(token, { method: 'POST' }));
    expect((await secondBlock.json<any>()).blocked).toBe(true);
  });

  it('delete removes the user from the list but keeps their message history', async () => {
    await seedUser('bu_owner_4', 'owner-password-123');
    const token = await login('bu_owner_4', 'owner-password-123');
    const bot = await createBot(token, { name: 'Delete Bot', username: 'delete_users_bot_1' });
    await seedBotUser(bot.id, 'bu1');

    await SELF.fetch(`https://worker.test/bots/${bot.id}/users/bu1/messages`, authed(token, {
      method: 'POST', body: JSON.stringify({ text: 'a reply worth keeping' }),
    }));

    const deleteRes = await SELF.fetch(`https://worker.test/bots/${bot.id}/users/bu1`, authed(token, { method: 'DELETE' }));
    expect(deleteRes.status).toBe(204);

    const listRes = await SELF.fetch(`https://worker.test/bots/${bot.id}/users`, authed(token));
    expect(await listRes.json<any[]>()).toEqual([]);

    const activityRes = await SELF.fetch(`https://worker.test/bots/${bot.id}/activity`, authed(token));
    const activity = await activityRes.json<any[]>();
    expect(activity.length).toBe(1);
    expect(activity[0].text).toBe('a reply worth keeping');
    // ON DELETE SET NULL (schema.sql) — the message survives its sender's removal.
    expect(activity[0].botUserId).toBeNull();
  });

  it('cross-bot isolation: cannot read, patch, block, mute, or delete another bot\'s user', async () => {
    await seedUser('bu_owner_5', 'owner-password-123');
    await seedUser('bu_intruder_5', 'intruder-password-123');
    const ownerToken = await login('bu_owner_5', 'owner-password-123');
    const intruderToken = await login('bu_intruder_5', 'intruder-password-123');

    const ownerBot = await createBot(ownerToken, { name: 'Owner Bot', username: 'owner_users_bot_1' });
    const intruderBot = await createBot(intruderToken, { name: 'Intruder Bot', username: 'intruder_users_bot_1' });
    await seedBotUser(ownerBot.id, 'secret_user', { name: 'Secret Person' });

    const crossGet = await SELF.fetch(`https://worker.test/bots/${intruderBot.id}/users/secret_user`, authed(intruderToken));
    expect(crossGet.status).toBe(404);

    const crossPatch = await SELF.fetch(`https://worker.test/bots/${intruderBot.id}/users/secret_user`, authed(intruderToken, {
      method: 'PATCH', body: JSON.stringify({ blocked: true }),
    }));
    expect(crossPatch.status).toBe(404);

    const crossBlock = await SELF.fetch(`https://worker.test/bots/${intruderBot.id}/users/secret_user/block`, authed(intruderToken, { method: 'POST' }));
    expect(crossBlock.status).toBe(404);

    const crossMute = await SELF.fetch(`https://worker.test/bots/${intruderBot.id}/users/secret_user/mute`, authed(intruderToken, { method: 'POST' }));
    expect(crossMute.status).toBe(404);

    const crossDelete = await SELF.fetch(`https://worker.test/bots/${intruderBot.id}/users/secret_user`, authed(intruderToken, { method: 'DELETE' }));
    expect(crossDelete.status).toBe(404);

    const crossSend = await SELF.fetch(`https://worker.test/bots/${intruderBot.id}/users/secret_user/messages`, authed(intruderToken, {
      method: 'POST', body: JSON.stringify({ text: 'hijacked' }),
    }));
    expect(crossSend.status).toBe(404);

    // Confirm it was never touched.
    const stillThere = await SELF.fetch(`https://worker.test/bots/${ownerBot.id}/users/secret_user`, authed(ownerToken));
    const stillThereBody = await stillThere.json<any>();
    expect(stillThereBody.name).toBe('Secret Person');
    expect(stillThereBody.blocked).toBe(false);
  });
});

describe('bot messages — real HTTP end to end', () => {
  it('outbound send: correct shape, persisted, and visible in both history and activity', async () => {
    await seedUser('bm_owner_1', 'owner-password-123');
    const token = await login('bm_owner_1', 'owner-password-123');
    const bot = await createBot(token, { name: 'Send Bot', username: 'send_bot_1' });
    await seedBotUser(bot.id, 'bu1', { name: 'Ann' });

    const sendRes = await SELF.fetch(`https://worker.test/bots/${bot.id}/users/bu1/messages`, authed(token, {
      method: 'POST', body: JSON.stringify({ text: 'Hello from the owner' }),
    }));
    expect(sendRes.status).toBe(201);
    const sent = await sendRes.json<any>();
    expect(sent.dir).toBe('out');
    expect(sent.text).toBe('Hello from the owner');
    expect(sent.createdAt).toBeTypeOf('number');

    const emptyRes = await SELF.fetch(`https://worker.test/bots/${bot.id}/users/bu1/messages`, authed(token, {
      method: 'POST', body: JSON.stringify({}),
    }));
    expect(emptyRes.status).toBe(400);

    const historyRes = await SELF.fetch(`https://worker.test/bots/${bot.id}/users/bu1/messages`, authed(token));
    const history = await historyRes.json<any[]>();
    expect(history.length).toBe(1);
    expect(history[0].text).toBe('Hello from the owner');
    expect(history[0].dir).toBe('out');

    const activityRes = await SELF.fetch(`https://worker.test/bots/${bot.id}/activity`, authed(token));
    const activity = await activityRes.json<any[]>();
    expect(activity.length).toBe(1);
    expect(activity[0].id).toBe(sent.id);

    // Sending updates the bot user's own counters too.
    const userRes = await SELF.fetch(`https://worker.test/bots/${bot.id}/users/bu1`, authed(token));
    expect((await userRes.json<any>()).messageCount).toBe(1);
  });

  it('history 404s for a user id that does not belong to the bot (not an empty list)', async () => {
    await seedUser('bm_owner_2', 'owner-password-123');
    const token = await login('bm_owner_2', 'owner-password-123');
    const bot = await createBot(token, { name: 'History Bot', username: 'history_bot_1' });

    const res = await SELF.fetch(`https://worker.test/bots/${bot.id}/users/never-existed/messages`, authed(token));
    expect(res.status).toBe(404);
  });

  it('inbound messages via the per-bot webhook create the sender and land in their history, in order', async () => {
    await seedUser('bm_owner_3', 'owner-password-123');
    const token = await login('bm_owner_3', 'owner-password-123');
    const bot = await createBot(token, { name: 'Inbound Bot', username: 'inbound_bot_1' });

    const from = { id: 'ext_1', first_name: 'Cara', username: 'cara' };
    await hitWebhook(bot.token, { message: { text: 'first', from } });
    await hitWebhook(bot.token, { message: { text: 'second', from } });

    const botUserId = `${bot.id}:ext_1`;
    const historyRes = await SELF.fetch(`https://worker.test/bots/${bot.id}/users/${botUserId}/messages`, authed(token));
    expect(historyRes.status).toBe(200);
    const history = await historyRes.json<any[]>();
    expect(history.map((m: any) => m.text)).toEqual(['first', 'second']);
    expect(history.every((m: any) => m.dir === 'in')).toBe(true);

    const userRes = await SELF.fetch(`https://worker.test/bots/${bot.id}/users/${botUserId}`, authed(token));
    const user = await userRes.json<any>();
    expect(user.name).toBe('Cara');
    expect(user.messageCount).toBe(2);
  });
});

describe('bot user block/mute enforcement on inbound messages — real HTTP end to end', () => {
  it('a blocked user\'s inbound messages are dropped entirely: not stored, not counted', async () => {
    await seedUser('be_owner_1', 'owner-password-123');
    const token = await login('be_owner_1', 'owner-password-123');
    const bot = await createBot(token, { name: 'Enforce Bot', username: 'enforce_bot_1' });

    const from = { id: 'ext_2', first_name: 'Drew', username: 'drew' };
    await hitWebhook(bot.token, { message: { text: 'before block', from } });

    const botUserId = `${bot.id}:ext_2`;
    const blockRes = await SELF.fetch(`https://worker.test/bots/${bot.id}/users/${botUserId}/block`, authed(token, { method: 'POST' }));
    expect(blockRes.status).toBe(200);
    expect((await blockRes.json<any>()).blocked).toBe(true);

    const webhookRes = await hitWebhook(bot.token, { message: { text: 'while blocked', from } });
    // The caller still gets a clean 200 — blocking is never revealed to
    // whatever is sending the webhook, only enforced on the receiving side.
    expect(webhookRes.status).toBe(200);

    const historyRes = await SELF.fetch(`https://worker.test/bots/${bot.id}/users/${botUserId}/messages`, authed(token));
    const history = await historyRes.json<any[]>();
    expect(history.map((m: any) => m.text)).toEqual(['before block']); // the second message never landed

    const userRes = await SELF.fetch(`https://worker.test/bots/${bot.id}/users/${botUserId}`, authed(token));
    const user = await userRes.json<any>();
    expect(user.messageCount).toBe(1); // not incremented by the dropped message

    const today = new Date().toISOString().slice(0, 10);
    const analytics = await db().prepare('SELECT message_count FROM bot_analytics WHERE bot_id = ? AND date = ?')
      .bind(bot.id, today).first<{ message_count: number }>();
    expect(analytics?.message_count).toBe(1); // only the pre-block message counted

    // Unblocking restores normal delivery.
    await SELF.fetch(`https://worker.test/bots/${bot.id}/users/${botUserId}/unblock`, authed(token, { method: 'POST' }));
    await hitWebhook(bot.token, { message: { text: 'after unblock', from } });
    const historyAfter = await (await SELF.fetch(`https://worker.test/bots/${bot.id}/users/${botUserId}/messages`, authed(token))).json<any[]>();
    expect(historyAfter.map((m: any) => m.text)).toEqual(['before block', 'after unblock']);
  });

  it('a muted user is not blocked — their messages are still received, stored, and counted normally', async () => {
    await seedUser('be_owner_2', 'owner-password-123');
    const token = await login('be_owner_2', 'owner-password-123');
    const bot = await createBot(token, { name: 'Mute Bot', username: 'mute_bot_1' });

    const from = { id: 'ext_3', first_name: 'Ely', username: 'ely' };
    await hitWebhook(bot.token, { message: { text: 'before mute', from } });

    const botUserId = `${bot.id}:ext_3`;
    await SELF.fetch(`https://worker.test/bots/${bot.id}/users/${botUserId}/mute`, authed(token, { method: 'POST' }));

    await hitWebhook(bot.token, { message: { text: 'while muted', from } });

    const historyRes = await SELF.fetch(`https://worker.test/bots/${bot.id}/users/${botUserId}/messages`, authed(token));
    const history = await historyRes.json<any[]>();
    // Unlike blocking, muting never drops the message — it's a
    // notification preference, not a block.
    expect(history.map((m: any) => m.text)).toEqual(['before mute', 'while muted']);

    const userRes = await SELF.fetch(`https://worker.test/bots/${bot.id}/users/${botUserId}`, authed(token));
    const user = await userRes.json<any>();
    expect(user.messageCount).toBe(2);
    expect(user.muted).toBe(true);
  });

  it('a message from an anonymous sender (no from.id) is still stored, and block/mute never apply to it', async () => {
    await seedUser('be_owner_3', 'owner-password-123');
    const token = await login('be_owner_3', 'owner-password-123');
    const bot = await createBot(token, { name: 'Anon Bot', username: 'anon_bot_1' });

    const res = await hitWebhook(bot.token, { text: 'no sender identity attached' });
    expect(res.status).toBe(200);

    const activityRes = await SELF.fetch(`https://worker.test/bots/${bot.id}/activity`, authed(token));
    const activity = await activityRes.json<any[]>();
    expect(activity.length).toBe(1);
    expect(activity[0].text).toBe('no sender identity attached');
    expect(activity[0].botUserId).toBeNull();

    const usersRes = await SELF.fetch(`https://worker.test/bots/${bot.id}/users`, authed(token));
    expect(await usersRes.json<any[]>()).toEqual([]); // no bot_users row was ever created
  });
});
