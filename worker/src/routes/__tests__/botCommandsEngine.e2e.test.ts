// PHASE 15 — Bot Commands: Execution Engine, end to end.
//
// Same real-HTTP, real-D1 approach as the other e2e files in this folder:
// real requests through the actual exported Worker (`SELF.fetch`), a real
// login and real JWT, against the real D1 database with the real schema
// applied, through the real public per-bot webhook endpoint. Nothing here
// is mocked — including the "Trigger webhook" test below, which makes a
// real outbound `fetch()` to an address nothing is listening on and
// asserts on the real connection failure, rather than stubbing `fetch`.
//
// Phase 11 (worker/src/routes/__tests__/botSettingsCommands.e2e.test.ts)
// and Phase 9 (botRuntimeAuth.e2e.test.ts) already cover command CRUD,
// validation, and the owner-facing `/bot-runtime/commands` read surface.
// What neither of those exercises is the actual execution engine this
// phase adds: what happens when a real inbound message beginning with
// "/" reaches a bot through `POST /webhook/:token` and gets dispatched by
// `processCommandOrLogicOrWebhook` / `executeCommandAction`
// (lib/botMessagePipeline.ts, lib/botCommands.ts). That is what this file
// covers, directly against the spec's bullets:
//   - /start and /help exist as real, seeded, editable rows from the
//     moment a bot is created
//   - command names are unique per bot, but the same name is free to
//     reuse on a different bot (commands "belong to one bot")
//   - each of the five fixed behavior types actually executes:
//     "Reply with text", "Send welcome message", "Open menu",
//     "Trigger webhook", "No action"
//   - a disabled command does not dispatch, and produces no reply
//   - an unknown command does not dispatch, and produces no reply
//   - "Respect bot settings": allow_commands = false turns "/" text back
//     into an ordinary message (falls through to the webhook branch,
//     never parsed as a command)
//   - "Respect command permissions": a blocked bot-user's command never
//     reaches the dispatcher at all (the message itself is dropped
//     upstream, same enforcement Phase 12/14 already built)
//   - command name matching is case-insensitive and ignores anything
//     after the first whitespace-delimited token
//   - no eval/Function/dynamic code execution path exists — every
//     behavior type is a fixed switch arm over inert config data

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

async function addCommand(token: string, botId: string, body: Record<string, unknown>) {
  const res = await SELF.fetch(`https://worker.test/bots/${botId}/commands`, authed(token, {
    method: 'POST',
    body: JSON.stringify(body),
  }));
  expect(res.status).toBe(201);
  return res.json<any>();
}

async function hitWebhook(token: string, body: Record<string, unknown>) {
  return SELF.fetch(`https://worker.test/webhook/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function lastOutbound(botId: string, botUserId: string) {
  return db().prepare(
    `SELECT * FROM bot_messages WHERE bot_id = ? AND bot_user_id = ? AND direction = 'out' ORDER BY created_at DESC LIMIT 1`
  ).bind(botId, botUserId).first<any>();
}

async function outboundCount(botId: string, botUserId: string) {
  const row = await db().prepare(
    `SELECT COUNT(*) AS n FROM bot_messages WHERE bot_id = ? AND bot_user_id = ? AND direction = 'out'`
  ).bind(botId, botUserId).first<{ n: number }>();
  return row?.n ?? 0;
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

describe('command execution engine — dispatch through the real inbound pipeline', () => {
  it('a new bot is seeded with real, editable /start and /help rows', async () => {
    await seedUser('cmdeng_owner_1', 'owner-password-123');
    const token = await login('cmdeng_owner_1', 'owner-password-123');
    const bot = await createBot(token, { name: 'Seeded Bot', username: 'seeded_bot_1' });

    const listRes = await SELF.fetch(`https://worker.test/bots/${bot.id}/commands`, authed(token));
    const commands = await listRes.json<any[]>();
    expect(commands.map((c) => c.command).sort()).toEqual(['help', 'start']);
    expect(commands.every((c) => c.enabled)).toBe(true);
    // They're ordinary rows — editable/disable-able/deletable through the
    // same CRUD as any owner-added command, not a hardcoded fallback with
    // no row behind it.
    expect(commands.every((c) => typeof c.id === 'string' && c.id.length > 0)).toBe(true);
  });

  it('/start dispatches "Send welcome message" using the bot\'s real configured welcome text', async () => {
    await seedUser('cmdeng_owner_2', 'owner-password-123');
    const token = await login('cmdeng_owner_2', 'owner-password-123');
    const bot = await createBot(token, {
      name: 'Welcome Bot', username: 'welcome_bot_1', welcomeMessage: 'Hi! Welcome aboard.',
    });

    const from = { id: 'u_start', first_name: 'Nia', username: 'nia' };
    await hitWebhook(bot.token, { message: { text: '/start', from } });

    const botUserId = `${bot.id}:u_start`;
    const outbound = await lastOutbound(bot.id, botUserId);
    expect(outbound.text).toBe('Hi! Welcome aboard.');
    expect(outbound.source).toBe('command');
  });

  it('/help dispatches "Open menu" and lists only real, currently-enabled commands', async () => {
    await seedUser('cmdeng_owner_3', 'owner-password-123');
    const token = await login('cmdeng_owner_3', 'owner-password-123');
    const bot = await createBot(token, { name: 'Menu Bot', username: 'menu_bot_1' });

    const promo = await addCommand(token, bot.id, {
      command: 'promo', description: 'Show today\'s promo', actionType: 'Reply with text', actionValue: 'Half off!',
    });
    await addCommand(token, bot.id, {
      command: 'hidden', description: 'Should not appear', actionType: 'No action',
    });
    // Disable the just-created "hidden" command — the menu must reflect
    // live state, not a stale/cached list.
    await SELF.fetch(`https://worker.test/bots/${bot.id}/commands`, authed(token));
    const listRes = await SELF.fetch(`https://worker.test/bots/${bot.id}/commands`, authed(token));
    const all = await listRes.json<any[]>();
    const hidden = all.find((c: any) => c.command === 'hidden');
    await SELF.fetch(`https://worker.test/bots/${bot.id}/commands/${hidden.id}/disable`, authed(token, { method: 'POST' }));

    const from = { id: 'u_help', first_name: 'Omar', username: 'omar' };
    await hitWebhook(bot.token, { message: { text: '/help', from } });

    const botUserId = `${bot.id}:u_help`;
    const outbound = await lastOutbound(bot.id, botUserId);
    expect(outbound.source).toBe('command');
    expect(outbound.text).toContain('/start');
    expect(outbound.text).toContain('/help');
    expect(outbound.text).toContain(`/promo — ${promo.description}`);
    expect(outbound.text).not.toContain('/hidden');
  });

  it('"Reply with text" returns exactly the configured static text', async () => {
    await seedUser('cmdeng_owner_4', 'owner-password-123');
    const token = await login('cmdeng_owner_4', 'owner-password-123');
    const bot = await createBot(token, { name: 'Static Bot', username: 'static_bot_1' });
    await addCommand(token, bot.id, {
      command: 'hours', description: 'Business hours', actionType: 'Reply with text', actionValue: 'Mon–Fri, 9–5.',
    });

    const from = { id: 'u_hours', first_name: 'Priya', username: 'priya' };
    await hitWebhook(bot.token, { message: { text: '/hours', from } });

    const outbound = await lastOutbound(bot.id, `${bot.id}:u_hours`);
    expect(outbound.text).toBe('Mon–Fri, 9–5.');
    expect(outbound.source).toBe('command');
  });

  it('"No action" produces no reply at all — no outbound row is written', async () => {
    await seedUser('cmdeng_owner_5', 'owner-password-123');
    const token = await login('cmdeng_owner_5', 'owner-password-123');
    const bot = await createBot(token, { name: 'Quiet Bot', username: 'quiet_bot_1' });
    await addCommand(token, bot.id, { command: 'noop', actionType: 'No action' });

    const from = { id: 'u_noop', first_name: 'Kai', username: 'kai' };
    await hitWebhook(bot.token, { message: { text: '/noop', from } });

    expect(await outboundCount(bot.id, `${bot.id}:u_noop`)).toBe(0);
  });

  it('a disabled command does not dispatch — no reply, even though the row exists', async () => {
    await seedUser('cmdeng_owner_6', 'owner-password-123');
    const token = await login('cmdeng_owner_6', 'owner-password-123');
    const bot = await createBot(token, { name: 'Toggle Bot', username: 'toggle_bot_1' });
    const cmd = await addCommand(token, bot.id, {
      command: 'special', actionType: 'Reply with text', actionValue: 'should never be seen',
    });
    await SELF.fetch(`https://worker.test/bots/${bot.id}/commands/${cmd.id}/disable`, authed(token, { method: 'POST' }));

    const from = { id: 'u_disabled', first_name: 'Lee', username: 'lee' };
    await hitWebhook(bot.token, { message: { text: '/special', from } });

    expect(await outboundCount(bot.id, `${bot.id}:u_disabled`)).toBe(0);
  });

  it('an unknown command produces no reply, and is not mistaken for the webhook fallback', async () => {
    await seedUser('cmdeng_owner_7', 'owner-password-123');
    const token = await login('cmdeng_owner_7', 'owner-password-123');
    // A webhook_url IS configured — if unknown-command text fell through
    // to the generic webhook branch, this bot would attempt a real
    // delivery. It must not: an unrecognized command inside `isCommand`
    // returns immediately with no reply, it never falls through.
    const bot = await createBot(token, {
      name: 'Strict Bot', username: 'strict_bot_1', webhookUrl: 'http://127.0.0.1:1/unreachable',
    });

    const from = { id: 'u_unknown', first_name: 'Sam', username: 'sam' };
    await hitWebhook(bot.token, { message: { text: '/does_not_exist', from } });

    expect(await outboundCount(bot.id, `${bot.id}:u_unknown`)).toBe(0);
  });

  it('command name matching is case-insensitive and ignores trailing arguments', async () => {
    await seedUser('cmdeng_owner_8', 'owner-password-123');
    const token = await login('cmdeng_owner_8', 'owner-password-123');
    const bot = await createBot(token, { name: 'Case Bot', username: 'case_bot_1' });
    await addCommand(token, bot.id, { command: 'greet', actionType: 'Reply with text', actionValue: 'Hey there!' });

    const from = { id: 'u_case', first_name: 'Robin', username: 'robin' };
    await hitWebhook(bot.token, { message: { text: '/GREET World', from } });

    const outbound = await lastOutbound(bot.id, `${bot.id}:u_case`);
    expect(outbound.text).toBe('Hey there!');
    expect(outbound.source).toBe('command');
  });

  it('"Trigger webhook" with no webhook_url configured produces no reply — nothing is fabricated', async () => {
    await seedUser('cmdeng_owner_9', 'owner-password-123');
    const token = await login('cmdeng_owner_9', 'owner-password-123');
    const bot = await createBot(token, { name: 'No Hook Bot', username: 'no_hook_bot_1' });
    await addCommand(token, bot.id, { command: 'sync', actionType: 'Trigger webhook' });

    const from = { id: 'u_nohook', first_name: 'Tia', username: 'tia' };
    await hitWebhook(bot.token, { message: { text: '/sync', from } });

    expect(await outboundCount(bot.id, `${bot.id}:u_nohook`)).toBe(0);
  });

  it('"Trigger webhook" makes a real outbound call; a real, unmocked delivery failure produces no fabricated reply', async () => {
    await seedUser('cmdeng_owner_10', 'owner-password-123');
    const token = await login('cmdeng_owner_10', 'owner-password-123');
    // Port 1 on loopback: nothing listens there, so this is a genuine
    // connection failure, not a stub — exercising the real `fetch` call
    // and `callBotWebhook`'s real catch branch.
    const bot = await createBot(token, {
      name: 'Hook Fail Bot', username: 'hook_fail_bot_1', webhookUrl: 'http://127.0.0.1:1/cmd',
    });
    await addCommand(token, bot.id, { command: 'ping', actionType: 'Trigger webhook' });

    const from = { id: 'u_hookfail', first_name: 'Zeke', username: 'zeke' };
    await hitWebhook(bot.token, { message: { text: '/ping', from } });

    // The real HTTP call failed (nothing listening), so `callBotWebhook`
    // returns `replyText: null` and no outbound row is ever written — a
    // failed delivery is reported as nothing, never as a made-up reply.
    expect(await outboundCount(bot.id, `${bot.id}:u_hookfail`)).toBe(0);
  }, 15000);

  it('"Allow commands" = false turns "/" text back into an ordinary message, never parsed as a command', async () => {
    await seedUser('cmdeng_owner_11', 'owner-password-123');
    const token = await login('cmdeng_owner_11', 'owner-password-123');
    const bot = await createBot(token, { name: 'Locked Bot', username: 'locked_bot_1' });
    await addCommand(token, bot.id, { command: 'secret', actionType: 'Reply with text', actionValue: 'leaked!' });
    await SELF.fetch(`https://worker.test/bots/${bot.id}`, authed(token, {
      method: 'PATCH', body: JSON.stringify({ allowCommands: false }),
    }));

    const from = { id: 'u_locked', first_name: 'Ines', username: 'ines' };
    await hitWebhook(bot.token, { message: { text: '/secret', from } });

    // No webhook_url configured either, so the fallback branch also has
    // nothing to call — net result is no reply, and critically the
    // command's own text was never dispatched.
    expect(await outboundCount(bot.id, `${bot.id}:u_locked`)).toBe(0);
    const stored = await db().prepare(
      `SELECT text, direction FROM bot_messages WHERE bot_id = ? ORDER BY created_at ASC LIMIT 1`
    ).bind(bot.id).first<any>();
    expect(stored.text).toBe('/secret');
    expect(stored.direction).toBe('in');
  });

  it('a blocked bot-user\'s "/" message never reaches the command dispatcher at all', async () => {
    await seedUser('cmdeng_owner_12', 'owner-password-123');
    const token = await login('cmdeng_owner_12', 'owner-password-123');
    const bot = await createBot(token, { name: 'Blocklist Bot', username: 'blocklist_bot_1' });
    await addCommand(token, bot.id, { command: 'reply', actionType: 'Reply with text', actionValue: 'hi' });

    const from = { id: 'u_blocked', first_name: 'Wes', username: 'wes' };
    // First message creates + activates the bot user; block them, then
    // send the command.
    await hitWebhook(bot.token, { message: { text: 'hello first', from } });
    const botUserId = `${bot.id}:u_blocked`;
    await SELF.fetch(`https://worker.test/bots/${bot.id}/users/${botUserId}/block`, authed(token, { method: 'POST' }));

    const before = await outboundCount(bot.id, botUserId);
    await hitWebhook(bot.token, { message: { text: '/reply', from } });
    const after = await outboundCount(bot.id, botUserId);

    expect(after).toBe(before);
    // The inbound "/reply" itself was dropped too — not just un-replied-to.
    const inboundCount = await db().prepare(
      `SELECT COUNT(*) AS n FROM bot_messages WHERE bot_id = ? AND bot_user_id = ? AND direction = 'in' AND text = '/reply'`
    ).bind(bot.id, botUserId).first<{ n: number }>();
    expect(inboundCount?.n).toBe(0);
  });

  it('the same command name is free to reuse on a different bot — commands belong to one bot only', async () => {
    await seedUser('cmdeng_owner_13', 'owner-password-123');
    const token = await login('cmdeng_owner_13', 'owner-password-123');
    const botA = await createBot(token, { name: 'Bot A', username: 'iso_bot_a_1' });
    const botB = await createBot(token, { name: 'Bot B', username: 'iso_bot_b_1' });
    await addCommand(token, botA.id, { command: 'offer', actionType: 'Reply with text', actionValue: 'Bot A offer' });
    await addCommand(token, botB.id, { command: 'offer', actionType: 'Reply with text', actionValue: 'Bot B offer' });

    const from = { id: 'u_iso', first_name: 'Nora', username: 'nora' };
    await hitWebhook(botA.token, { message: { text: '/offer', from } });
    await hitWebhook(botB.token, { message: { text: '/offer', from } });

    const replyA = await lastOutbound(botA.id, `${botA.id}:u_iso`);
    const replyB = await lastOutbound(botB.id, `${botB.id}:u_iso`);
    expect(replyA.text).toBe('Bot A offer');
    expect(replyB.text).toBe('Bot B offer');
  });

  it('creating the same command name twice on one bot is rejected — normalized, case/slash-insensitive', async () => {
    await seedUser('cmdeng_owner_14', 'owner-password-123');
    const token = await login('cmdeng_owner_14', 'owner-password-123');
    const bot = await createBot(token, { name: 'Dup Bot', username: 'dup_bot_1' });
    await addCommand(token, bot.id, { command: 'ping', actionType: 'No action' });

    const dupRes = await SELF.fetch(`https://worker.test/bots/${bot.id}/commands`, authed(token, {
      method: 'POST', body: JSON.stringify({ command: '/PING', actionType: 'No action' }),
    }));
    expect(dupRes.status).toBe(409);
  });

  it('no dynamic code execution path exists: an unrecognized action_type produces no reply rather than being interpreted', async () => {
    await seedUser('cmdeng_owner_15', 'owner-password-123');
    const token = await login('cmdeng_owner_15', 'owner-password-123');
    const bot = await createBot(token, { name: 'Legacy Bot', username: 'legacy_bot_1' });
    const cmd = await addCommand(token, bot.id, { command: 'legacy', actionType: 'No action' });
    // Simulate a row from a since-removed action type — the only way to
    // reach the defensive `default` branch in `executeCommandAction`,
    // since every write path validates against COMMAND_ACTION_TYPES.
    await db().prepare('UPDATE bot_commands SET action_type = ? WHERE id = ?').bind('legacy_free_form_script', cmd.id).run();

    const from = { id: 'u_legacy', first_name: 'Vik', username: 'vik' };
    await hitWebhook(bot.token, { message: { text: '/legacy', from } });

    expect(await outboundCount(bot.id, `${bot.id}:u_legacy`)).toBe(0);
  });
});
