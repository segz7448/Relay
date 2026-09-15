// PHASE 10 — Bot API: Management & Profile Endpoints, end to end.
//
// Same real-HTTP, real-D1 approach as botTokenSecurity.e2e.test.ts: real
// requests through the actual exported Worker (`SELF.fetch`), a real login
// and real JWT, against the real D1 database with the real schema applied.
// Nothing here is mocked.
//
// Covers the spec directly:
//   - create / list / get / patch / delete bot
//   - enable / disable as their own dedicated actions (not just PATCH)
//   - profile fields: name, username, description, profile image,
//     category, welcome message, status
//   - the profile_image_url column-mapping bug (profileImage was being
//     silently dropped by PATCH before this phase)
//   - username uniqueness + format validation on both create and patch
//   - one owner can't read/patch/enable/disable/delete another owner's bot

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
  return res;
}

beforeEach(async () => {
  // This pool does not reset storage between individual `it()` blocks
  // (same note as the Phase 8/7 e2e files).
  await db().exec('DELETE FROM bot_messages');
  await db().exec('DELETE FROM bot_users');
  await db().exec('DELETE FROM bot_commands');
  await db().exec('DELETE FROM bots');
  await db().exec('DELETE FROM sessions');
  await db().exec('DELETE FROM users');
});

describe('bot management & profile — real HTTP end to end', () => {
  it('create / list / get / patch / delete round-trip, scoped to the owner', async () => {
    await seedUser('mgmt_owner_1', 'owner-password-123');
    const token = await login('mgmt_owner_1', 'owner-password-123');

    const createRes = await createBot(token, { name: 'Support Router', username: 'support_router_1' });
    expect(createRes.status).toBe(201);
    const created = await createRes.json<any>();
    expect(created.name).toBe('Support Router');
    expect(created.username).toBe('support_router_1');
    expect(created.enabled).toBe(true);

    const listRes = await SELF.fetch('https://worker.test/bots', authed(token));
    const list = await listRes.json<any[]>();
    expect(list.map((b) => b.id)).toContain(created.id);

    const getRes = await SELF.fetch(`https://worker.test/bots/${created.id}`, authed(token));
    expect(getRes.status).toBe(200);
    const fetched = await getRes.json<any>();
    expect(fetched.id).toBe(created.id);
    expect(Array.isArray(fetched.commands)).toBe(true);
    expect(Array.isArray(fetched.users)).toBe(true);

    const patchRes = await SELF.fetch(`https://worker.test/bots/${created.id}`, authed(token, {
      method: 'PATCH',
      body: JSON.stringify({ description: 'Routes support tickets.' }),
    }));
    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json<any>();
    expect(patched.description).toBe('Routes support tickets.');

    const deleteRes = await SELF.fetch(`https://worker.test/bots/${created.id}`, authed(token, { method: 'DELETE' }));
    expect(deleteRes.status).toBe(204);

    const getAfterDelete = await SELF.fetch(`https://worker.test/bots/${created.id}`, authed(token));
    expect(getAfterDelete.status).toBe(404);
  });

  it('PATCH persists every documented profile field, including profileImage → profile_image_url', async () => {
    await seedUser('mgmt_owner_2', 'owner-password-123');
    const token = await login('mgmt_owner_2', 'owner-password-123');

    const createRes = await createBot(token, { name: 'Profile Bot', username: 'profile_bot_1' });
    const created = await createRes.json<any>();
    expect(created.profileImage).toBeNull();

    const patchRes = await SELF.fetch(`https://worker.test/bots/${created.id}`, authed(token, {
      method: 'PATCH',
      body: JSON.stringify({
        name: 'Renamed Bot',
        description: 'New description',
        category: 'Finance',
        welcomeMessage: 'Hi there!',
        status: 'online',
        profileImage: 'https://files.botmanager.dev/uploads/mgmt_owner_2/avatar.jpg',
      }),
    }));
    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json<any>();
    expect(patched.name).toBe('Renamed Bot');
    expect(patched.description).toBe('New description');
    expect(patched.category).toBe('Finance');
    expect(patched.welcomeMessage).toBe('Hi there!');
    expect(patched.status).toBe('online');
    // The regression this test guards: before Phase 10's explicit
    // PROFILE_FIELD_MAP, `profileImage` mapped to the non-existent column
    // `profile_image` and was silently dropped by the update loop.
    expect(patched.profileImage).toBe('https://files.botmanager.dev/uploads/mgmt_owner_2/avatar.jpg');

    // Confirm it actually landed in the DB column, not just the response.
    const row = await db().prepare('SELECT profile_image_url FROM bots WHERE id = ?').bind(created.id).first<any>();
    expect(row.profile_image_url).toBe('https://files.botmanager.dev/uploads/mgmt_owner_2/avatar.jpg');
  });

  it('PATCH can rename the bot username, with format validation and uniqueness enforced', async () => {
    await seedUser('mgmt_owner_3', 'owner-password-123');
    const token = await login('mgmt_owner_3', 'owner-password-123');

    const botA = await (await createBot(token, { name: 'Bot A', username: 'bot_username_a' })).json<any>();
    const botB = await (await createBot(token, { name: 'Bot B', username: 'bot_username_b' })).json<any>();

    // Too short / bad format is rejected.
    const badRes = await SELF.fetch(`https://worker.test/bots/${botA.id}`, authed(token, {
      method: 'PATCH', body: JSON.stringify({ username: 'ab' }),
    }));
    expect(badRes.status).toBe(400);

    // Colliding with another bot's username is rejected.
    const collideRes = await SELF.fetch(`https://worker.test/bots/${botA.id}`, authed(token, {
      method: 'PATCH', body: JSON.stringify({ username: 'bot_username_b' }),
    }));
    expect(collideRes.status).toBe(409);

    // A valid, free username succeeds and is normalized to lowercase.
    const okRes = await SELF.fetch(`https://worker.test/bots/${botA.id}`, authed(token, {
      method: 'PATCH', body: JSON.stringify({ username: '@Bot_Username_Renamed' }),
    }));
    expect(okRes.status).toBe(200);
    const renamed = await okRes.json<any>();
    expect(renamed.username).toBe('bot_username_renamed');

    // Renaming to the same username you already have is a no-op success,
    // not a false "taken" collision against yourself.
    const sameRes = await SELF.fetch(`https://worker.test/bots/${botA.id}`, authed(token, {
      method: 'PATCH', body: JSON.stringify({ username: 'bot_username_renamed' }),
    }));
    expect(sameRes.status).toBe(200);

    void botB;
  });

  it('create rejects a malformed username and a duplicate username', async () => {
    await seedUser('mgmt_owner_4', 'owner-password-123');
    const token = await login('mgmt_owner_4', 'owner-password-123');

    const badRes = await createBot(token, { name: 'Bad Bot', username: 'ab' });
    expect(badRes.status).toBe(400);

    const firstRes = await createBot(token, { name: 'First Bot', username: 'dup_username_1' });
    expect(firstRes.status).toBe(201);

    const dupRes = await createBot(token, { name: 'Second Bot', username: 'dup_username_1' });
    expect(dupRes.status).toBe(409);
  });

  it('create respects explicit false settings instead of silently defaulting to enabled/allowed', async () => {
    await seedUser('mgmt_owner_5', 'owner-password-123');
    const token = await login('mgmt_owner_5', 'owner-password-123');

    const res = await createBot(token, {
      name: 'Locked Down Bot', username: 'locked_down_bot_1',
      enableBot: false, allowMessages: false, allowFiles: false,
      allowCommands: false, enableNotifications: false,
    });
    expect(res.status).toBe(201);
    const bot = await res.json<any>();
    expect(bot.enabled).toBe(false);
    expect(bot.allowMessages).toBe(false);
    expect(bot.allowFiles).toBe(false);
    expect(bot.allowCommands).toBe(false);
    expect(bot.enableNotifications).toBe(false);
  });

  it('POST /:id/enable and /:id/disable are dedicated actions, and disable clears status', async () => {
    await seedUser('mgmt_owner_6', 'owner-password-123');
    const token = await login('mgmt_owner_6', 'owner-password-123');

    const created = await (await createBot(token, { name: 'Toggle Bot', username: 'toggle_bot_1' })).json<any>();
    expect(created.enabled).toBe(true);
    expect(created.status).toBe('offline');

    const disableRes = await SELF.fetch(`https://worker.test/bots/${created.id}/disable`, authed(token, { method: 'POST' }));
    expect(disableRes.status).toBe(200);
    const disabled = await disableRes.json<any>();
    expect(disabled.enabled).toBe(false);
    expect(disabled.status).toBe('disabled');

    const enableRes = await SELF.fetch(`https://worker.test/bots/${created.id}/enable`, authed(token, { method: 'POST' }));
    expect(enableRes.status).toBe(200);
    const enabled = await enableRes.json<any>();
    expect(enabled.enabled).toBe(true);
    // Coming out of 'disabled' resets to 'offline', not a fabricated 'online'.
    expect(enabled.status).toBe('offline');
  });

  it('re-enabling a bot that was never disabled does not clobber its existing status', async () => {
    await seedUser('mgmt_owner_7', 'owner-password-123');
    const token = await login('mgmt_owner_7', 'owner-password-123');

    const created = await (await createBot(token, { name: 'Status Bot', username: 'status_bot_1' })).json<any>();
    await SELF.fetch(`https://worker.test/bots/${created.id}`, authed(token, {
      method: 'PATCH', body: JSON.stringify({ status: 'online' }),
    }));

    const enableRes = await SELF.fetch(`https://worker.test/bots/${created.id}/enable`, authed(token, { method: 'POST' }));
    const enabled = await enableRes.json<any>();
    expect(enabled.status).toBe('online');
  });

  it('one owner cannot read, patch, enable, disable, or delete another owner\'s bot', async () => {
    await seedUser('mgmt_owner_8', 'owner-password-123');
    await seedUser('mgmt_intruder_8', 'intruder-password-123');
    const ownerToken = await login('mgmt_owner_8', 'owner-password-123');
    const intruderToken = await login('mgmt_intruder_8', 'intruder-password-123');

    const created = await (await createBot(ownerToken, { name: 'Owned Bot', username: 'owned_mgmt_bot_1' })).json<any>();

    const getAttempt = await SELF.fetch(`https://worker.test/bots/${created.id}`, authed(intruderToken));
    expect(getAttempt.status).toBe(404);

    const patchAttempt = await SELF.fetch(`https://worker.test/bots/${created.id}`, authed(intruderToken, {
      method: 'PATCH', body: JSON.stringify({ name: 'Hijacked' }),
    }));
    expect(patchAttempt.status).toBe(404);

    const enableAttempt = await SELF.fetch(`https://worker.test/bots/${created.id}/enable`, authed(intruderToken, { method: 'POST' }));
    expect(enableAttempt.status).toBe(404);

    const disableAttempt = await SELF.fetch(`https://worker.test/bots/${created.id}/disable`, authed(intruderToken, { method: 'POST' }));
    expect(disableAttempt.status).toBe(404);

    const deleteAttempt = await SELF.fetch(`https://worker.test/bots/${created.id}`, authed(intruderToken, { method: 'DELETE' }));
    expect(deleteAttempt.status).toBe(404);

    // Untouched by any of the intruder's failed attempts.
    const stillThereRes = await SELF.fetch(`https://worker.test/bots/${created.id}`, authed(ownerToken));
    expect(stillThereRes.status).toBe(200);
    const stillThere = await stillThereRes.json<any>();
    expect(stillThere.name).toBe('Owned Bot');
    expect(stillThere.enabled).toBe(true);
  });

  it('PATCH with no recognized fields returns 400 rather than a silent no-op success', async () => {
    await seedUser('mgmt_owner_9', 'owner-password-123');
    const token = await login('mgmt_owner_9', 'owner-password-123');
    const created = await (await createBot(token, { name: 'Noop Bot', username: 'noop_bot_1' })).json<any>();

    const res = await SELF.fetch(`https://worker.test/bots/${created.id}`, authed(token, {
      method: 'PATCH', body: JSON.stringify({ tokenHash: 'hacked', ownerId: 'someone-else' }),
    }));
    expect(res.status).toBe(400);
  });
});
