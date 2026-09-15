// PHASE 13 — Bot API: Analytics Endpoints, end to end.
//
// Same real-HTTP, real-D1 approach as every other `*.e2e.test.ts` file in
// this folder (`SELF.fetch` against the actual exported Worker, real JWT
// login, real schema applied to a real D1 instance). Nothing here is
// mocked, and nothing asserted is a hardcoded/expected "sample" number —
// every expectation is derived from exactly the rows this test itself
// seeded.
//
// Covers, directly against the spec ("Total messages, Inbound messages,
// Outbound messages, Active users, Daily activity, Message statistics,
// Bot activity"):
//   - GET /bots/:id/analytics: aggregate totals for a bot with zero
//     activity (all real zeros, not undefined/NaN/a placeholder), then
//     with a real mix of inbound/outbound messages and multiple bot users
//   - the bug this phase fixes: a single bot_user sending several inbound
//     messages counts as ONE active user, not one per message (the prior
//     `active_users = active_users + 1`-per-message logic would have
//     inflated this)
//   - outbound sends are reflected in totals (a prior gap: outbound never
//     touched the `bot_analytics` write-time cache at all)
//   - GET /bots/:id/analytics/daily: real per-day buckets from seeded
//     `created_at` timestamps, correct inbound/outbound/activeUsers split
//     per day, zero-filled gap days (a real zero for a day with no
//     messages, not a missing entry), oldest-first ordering, and the
//     `days` query param (default 7, capped at 90)
//   - cross-bot isolation on both endpoints
//   - 404 for another owner's bot / an unknown bot id

import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { hashPassword } from '../../lib/keys';

const db = () => env.DB as D1Database;
const DAY_MS = 24 * 60 * 60 * 1000;

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

// Directly seeds a bot_messages row with a caller-controlled `created_at`,
// so daily-bucket tests can place messages on specific real calendar days
// without waiting for real time to pass — same rationale as
// `seedBotUser` above (this phase's own routes don't create messages with
// arbitrary backdated timestamps, so seeding straight into D1 is the only
// way to test the day-bucketing logic deterministically).
async function seedMessage(botId: string, botUserId: string | null, direction: 'in' | 'out', createdAt: number, text = 'msg') {
  await db().prepare(
    `INSERT INTO bot_messages (id, bot_id, bot_user_id, direction, text, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(`${botId}:${direction}:${createdAt}:${Math.random().toString(36).slice(2)}`, botId, botUserId, direction, text, createdAt).run();
}

async function hitWebhook(token: string, body: Record<string, unknown>) {
  return SELF.fetch(`https://worker.test/webhook/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function todayStartMs(): number {
  // Matches lib/botAnalytics.ts's `startOfTodayMs()` exactly (UTC epoch-day
  // floor) — deliberately not `new Date().setHours(0,0,0,0)`, which would
  // use the test runner's local timezone and could disagree with the UTC
  // day boundary the implementation and SQLite's `date(x,'unixepoch')`
  // both use.
  return Math.floor(Date.now() / DAY_MS) * DAY_MS;
}

beforeEach(async () => {
  await db().exec('DELETE FROM bot_messages');
  await db().exec('DELETE FROM bot_users');
  await db().exec('DELETE FROM bot_analytics');
  await db().exec('DELETE FROM bot_commands');
  await db().exec('DELETE FROM bots');
  await db().exec('DELETE FROM sessions');
  await db().exec('DELETE FROM users');
});

describe('bot analytics (aggregate) — real HTTP end to end', () => {
  it('a brand-new bot with zero activity reports real zeros, not placeholders', async () => {
    await seedUser('an_owner_1', 'owner-password-123');
    const token = await login('an_owner_1', 'owner-password-123');
    const bot = await createBot(token, { name: 'Empty Bot', username: 'empty_analytics_bot_1' });

    const res = await SELF.fetch(`https://worker.test/bots/${bot.id}/analytics`, authed(token));
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body).toEqual({
      totalMessages: 0,
      inboundMessages: 0,
      outboundMessages: 0,
      totalUsers: 0,
      activeUsers: 0,
      messagesToday: 0,
      activeUsersToday: 0,
    });
    // No `uptimePct` or any other fabricated field — nothing in this
    // schema tracks bot process uptime, so it must not appear at all.
    expect(body.uptimePct).toBeUndefined();
  });

  it('aggregates real inbound/outbound counts and distinct users correctly', async () => {
    await seedUser('an_owner_2', 'owner-password-123');
    const token = await login('an_owner_2', 'owner-password-123');
    const bot = await createBot(token, { name: 'Busy Bot', username: 'busy_analytics_bot_1' });
    await seedBotUser(bot.id, 'bu1', { lastActiveAt: Date.now() });
    await seedBotUser(bot.id, 'bu2', { lastActiveAt: Date.now() - 8 * DAY_MS }); // stale — outside the 7-day active window

    await seedMessage(bot.id, 'bu1', 'in', Date.now(), 'hi');
    await seedMessage(bot.id, 'bu1', 'in', Date.now(), 'hi again');
    await seedMessage(bot.id, 'bu2', 'in', Date.now(), 'hello');
    await seedMessage(bot.id, 'bu1', 'out', Date.now(), 'reply');

    const res = await SELF.fetch(`https://worker.test/bots/${bot.id}/analytics`, authed(token));
    const body = await res.json<any>();
    expect(body.totalMessages).toBe(4);
    expect(body.inboundMessages).toBe(3);
    expect(body.outboundMessages).toBe(1);
    expect(body.totalUsers).toBe(2);
    // bu2's last_active_at is 8 days stale — only bu1 counts as "active".
    expect(body.activeUsers).toBe(1);
    expect(body.messagesToday).toBe(4);
    // Two distinct inbound senders today (bu1, bu2), regardless of bu1
    // sending twice — this is exactly the bug this phase fixes.
    expect(body.activeUsersToday).toBe(2);
  });

  it('a bot user sending multiple inbound messages via the real webhook counts once, not once per message', async () => {
    await seedUser('an_owner_3', 'owner-password-123');
    const token = await login('an_owner_3', 'owner-password-123');
    const bot = await createBot(token, { name: 'Repeat Sender Bot', username: 'repeat_sender_bot_1' });
    const from = { id: 'tg_555', first_name: 'Rae', username: 'rae' };

    await hitWebhook(bot.token, { message: { text: 'one', from } });
    await hitWebhook(bot.token, { message: { text: 'two', from } });
    await hitWebhook(bot.token, { message: { text: 'three', from } });

    const res = await SELF.fetch(`https://worker.test/bots/${bot.id}/analytics`, authed(token));
    const body = await res.json<any>();
    expect(body.totalMessages).toBe(3);
    expect(body.inboundMessages).toBe(3);
    expect(body.activeUsersToday).toBe(1); // one real sender, not three

    // The write-time bot_analytics cache (used by GET /stats/summary) is
    // the thing this phase's bug actually lived in — assert its stored
    // row directly, not just the live aggregate endpoint above.
    const today = new Date().toISOString().slice(0, 10);
    const cacheRow = await db().prepare(
      'SELECT message_count, active_users FROM bot_analytics WHERE bot_id = ? AND date = ?'
    ).bind(bot.id, today).first<{ message_count: number; active_users: number }>();
    expect(cacheRow?.message_count).toBe(3);
    expect(cacheRow?.active_users).toBe(1);
  });

  it('outbound sends are reflected in totals and in the write-time cache (previously a gap)', async () => {
    await seedUser('an_owner_4', 'owner-password-123');
    const token = await login('an_owner_4', 'owner-password-123');
    const bot = await createBot(token, { name: 'Outbound Bot', username: 'outbound_analytics_bot_1' });
    await seedBotUser(bot.id, 'bu1');

    await SELF.fetch(`https://worker.test/bots/${bot.id}/users/bu1/messages`, authed(token, {
      method: 'POST', body: JSON.stringify({ text: 'hello from the owner' }),
    }));

    const res = await SELF.fetch(`https://worker.test/bots/${bot.id}/analytics`, authed(token));
    const body = await res.json<any>();
    expect(body.totalMessages).toBe(1);
    expect(body.outboundMessages).toBe(1);
    expect(body.messagesToday).toBe(1);

    const today = new Date().toISOString().slice(0, 10);
    const cacheRow = await db().prepare(
      'SELECT message_count FROM bot_analytics WHERE bot_id = ? AND date = ?'
    ).bind(bot.id, today).first<{ message_count: number }>();
    expect(cacheRow?.message_count).toBe(1);
  });

  it('cross-bot isolation: another user\'s bot never contributes to these totals', async () => {
    await seedUser('an_owner_5', 'owner-password-123');
    await seedUser('an_intruder_5', 'intruder-password-123');
    const ownerToken = await login('an_owner_5', 'owner-password-123');
    const intruderToken = await login('an_intruder_5', 'intruder-password-123');

    const ownerBot = await createBot(ownerToken, { name: 'Owner Bot', username: 'owner_analytics_bot_1' });
    const intruderBot = await createBot(intruderToken, { name: 'Intruder Bot', username: 'intruder_analytics_bot_1' });
    await seedBotUser(ownerBot.id, 'bu1');
    await seedMessage(ownerBot.id, 'bu1', 'in', Date.now(), 'private to owner');

    const crossRes = await SELF.fetch(`https://worker.test/bots/${ownerBot.id}/analytics`, authed(intruderToken));
    expect(crossRes.status).toBe(404);

    const intruderRes = await SELF.fetch(`https://worker.test/bots/${intruderBot.id}/analytics`, authed(intruderToken));
    const intruderBody = await intruderRes.json<any>();
    expect(intruderBody.totalMessages).toBe(0);
  });

  it('404s for an unknown bot id', async () => {
    await seedUser('an_owner_6', 'owner-password-123');
    const token = await login('an_owner_6', 'owner-password-123');
    const res = await SELF.fetch('https://worker.test/bots/does-not-exist/analytics', authed(token));
    expect(res.status).toBe(404);
  });
});

describe('bot analytics (daily time series) — real HTTP end to end', () => {
  it('buckets seeded messages by real UTC day, zero-fills gaps, oldest first', async () => {
    await seedUser('ad_owner_1', 'owner-password-123');
    const token = await login('ad_owner_1', 'owner-password-123');
    const bot = await createBot(token, { name: 'Daily Bot', username: 'daily_analytics_bot_1' });
    await seedBotUser(bot.id, 'bu1');
    await seedBotUser(bot.id, 'bu2');

    const today = todayStartMs();
    const twoDaysAgo = today - 2 * DAY_MS;
    // Day -2: two inbound (two distinct senders) + one outbound. Day -1:
    // deliberately left empty to verify zero-fill. Day 0 (today): one inbound.
    await seedMessage(bot.id, 'bu1', 'in', twoDaysAgo + 1000, 'a');
    await seedMessage(bot.id, 'bu2', 'in', twoDaysAgo + 2000, 'b');
    await seedMessage(bot.id, 'bu1', 'out', twoDaysAgo + 3000, 'c');
    await seedMessage(bot.id, 'bu1', 'in', today + 1000, 'd');

    const res = await SELF.fetch(`https://worker.test/bots/${bot.id}/analytics/daily?days=3`, authed(token));
    expect(res.status).toBe(200);
    const days = await res.json<any[]>();
    expect(days.length).toBe(3);

    const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    expect(days.map((d) => d.date)).toEqual([fmt(twoDaysAgo), fmt(today - DAY_MS), fmt(today)]);

    expect(days[0]).toEqual({ date: fmt(twoDaysAgo), messages: 3, inbound: 2, outbound: 1, activeUsers: 2 });
    // The gap day: a real, correct zero — not a missing entry, not interpolated.
    expect(days[1]).toEqual({ date: fmt(today - DAY_MS), messages: 0, inbound: 0, outbound: 0, activeUsers: 0 });
    expect(days[2]).toEqual({ date: fmt(today), messages: 1, inbound: 1, outbound: 0, activeUsers: 1 });
  });

  it('defaults to 7 days and caps an excessive `days` request at 90', async () => {
    await seedUser('ad_owner_2', 'owner-password-123');
    const token = await login('ad_owner_2', 'owner-password-123');
    const bot = await createBot(token, { name: 'Default Days Bot', username: 'default_days_bot_1' });

    const defaultRes = await SELF.fetch(`https://worker.test/bots/${bot.id}/analytics/daily`, authed(token));
    expect((await defaultRes.json<any[]>()).length).toBe(7);

    const cappedRes = await SELF.fetch(`https://worker.test/bots/${bot.id}/analytics/daily?days=99999`, authed(token));
    expect((await cappedRes.json<any[]>()).length).toBe(90);
  });

  it('cross-bot isolation and 404 for an unknown bot id', async () => {
    await seedUser('ad_owner_3', 'owner-password-123');
    await seedUser('ad_intruder_3', 'intruder-password-123');
    const ownerToken = await login('ad_owner_3', 'owner-password-123');
    const intruderToken = await login('ad_intruder_3', 'intruder-password-123');

    const ownerBot = await createBot(ownerToken, { name: 'Owner Bot', username: 'owner_daily_bot_1' });
    await seedMessage(ownerBot.id, null, 'in', Date.now(), 'private');

    const crossRes = await SELF.fetch(`https://worker.test/bots/${ownerBot.id}/analytics/daily`, authed(intruderToken));
    expect(crossRes.status).toBe(404);

    const missingRes = await SELF.fetch('https://worker.test/bots/does-not-exist/analytics/daily', authed(ownerToken));
    expect(missingRes.status).toBe(404);
  });
});

describe('GET /bots/:id embeds the same real analytics summary', () => {
  it('embeds real totals, not the removed fake uptimePct/messagesByDay shape', async () => {
    await seedUser('ag_owner_1', 'owner-password-123');
    const token = await login('ag_owner_1', 'owner-password-123');
    const bot = await createBot(token, { name: 'Detail Bot', username: 'detail_analytics_bot_1' });
    await seedBotUser(bot.id, 'bu1', { lastActiveAt: Date.now() });
    await seedMessage(bot.id, 'bu1', 'in', Date.now(), 'hi');

    const res = await SELF.fetch(`https://worker.test/bots/${bot.id}`, authed(token));
    const body = await res.json<any>();
    expect(body.analytics.totalMessages).toBe(1);
    expect(body.analytics.inboundMessages).toBe(1);
    expect(body.analytics.uptimePct).toBeUndefined();
    expect(body.analytics.messagesByDay).toBeUndefined();
  });
});
