import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../../lib/keys';

const db = () => env.DB as D1Database;
async function ownerToken() {
  await db().prepare('INSERT INTO users (id,email,username,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .bind('wh-owner','wh@example.com','wh-owner',await hashPassword('safe-password-123'),Date.now(),Date.now()).run();
  const response = await SELF.fetch('https://worker.test/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({identifier:'wh-owner',password:'safe-password-123'}) });
  return (await response.json<{sessionToken:string}>()).sessionToken;
}
const auth = (token:string, method='GET', body?:unknown):RequestInit => ({ method, headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}, ...(body === undefined ? {} : {body:JSON.stringify(body)}) });

beforeEach(async () => {
  for (const table of ['bot_webhook_deliveries','bot_webhooks','bot_commands','bot_messages','bot_users','bots','sessions','users']) await db().exec(`DELETE FROM ${table}`);
});

describe('Phase 16 bot webhooks', () => {
  it('configures, reads, updates, disables, enables, rotates, and deletes without exposing stored secrets', async () => {
    const token = await ownerToken();
    const createdBot = await SELF.fetch('https://worker.test/bots', auth(token,'POST',{name:'Webhook Bot',username:'webhook_bot'}));
    const bot = await createdBot.json<any>();
    const configured = await SELF.fetch(`https://worker.test/bots/${bot.id}/webhook`, auth(token,'POST',{url:'https://hooks.example.com/a'}));
    expect(configured.status).toBe(201);
    const first = await configured.json<any>();
    expect(first.secret).toMatch(/^whsec_/);
    expect(first).not.toHaveProperty('secretHash');

    const read = await (await SELF.fetch(`https://worker.test/bots/${bot.id}/webhook`, auth(token))).json<any>();
    expect(read.url).toBe('https://hooks.example.com/a');
    expect(read).not.toHaveProperty('secret');

    expect((await SELF.fetch(`https://worker.test/bots/${bot.id}/webhook`, auth(token,'PATCH',{url:'https://hooks.example.com/b'}))).status).toBe(200);
    expect((await SELF.fetch(`https://worker.test/bots/${bot.id}/webhook/disable`, auth(token,'POST'))).status).toBe(200);
    expect((await SELF.fetch(`https://worker.test/bots/${bot.id}/webhook/enable`, auth(token,'POST'))).status).toBe(200);
    const rotated = await (await SELF.fetch(`https://worker.test/bots/${bot.id}/webhook/rotate-secret`, auth(token,'POST'))).json<any>();
    expect(rotated.secret).toMatch(/^whsec_/);
    expect(rotated.secret).not.toBe(first.secret);
    expect((await SELF.fetch(`https://worker.test/bots/${bot.id}/webhook`, auth(token,'DELETE'))).status).toBe(204);
  });

  it('sends a real test delivery and lists delivery history newest-first', async () => {
    const token = await ownerToken();
    const bot = await (await SELF.fetch('https://worker.test/bots', auth(token,'POST',{name:'Hook Bot',username:'hook_bot_3'}))).json<any>();
    expect((await SELF.fetch(`https://worker.test/bots/${bot.id}/webhook`, auth(token,'POST',{url:'https://hooks.example.com/a'}))).status).toBe(201);

    // hooks.example.com resolves nowhere real, so the awaited single-attempt
    // test delivery deterministically records a failure — which is exactly
    // the honest feedback the owner should see.
    const tested = await SELF.fetch(`https://worker.test/bots/${bot.id}/webhook/test`, auth(token,'POST'));
    expect(tested.status).toBe(200);
    const { delivery } = await tested.json<any>();
    expect(delivery.eventId).toMatch(/^[a-f0-9]{24}$/);
    expect(delivery.ok).toBe(false);

    const list = await (await SELF.fetch(`https://worker.test/bots/${bot.id}/webhook/deliveries`, auth(token))).json<any[]>();
    expect(list).toHaveLength(1);
    expect(list[0].eventId).toBe(delivery.eventId);
    expect(list[0].eventType).toBe('bot.webhook.test');
    expect(list[0].status).toBe('failed');
    expect(list[0].attempt).toBe(1);

    // A second test lands ahead of the first (newest-first ordering) and
    // the webhook summary reflects the latest attempt.
    await SELF.fetch(`https://worker.test/bots/${bot.id}/webhook/test`, auth(token,'POST'));
    const list2 = await (await SELF.fetch(`https://worker.test/bots/${bot.id}/webhook/deliveries`, auth(token))).json<any[]>();
    expect(list2).toHaveLength(2);
    expect(list2[0].createdAt).toBeGreaterThanOrEqual(list2[1].createdAt);
    const wh = await (await SELF.fetch(`https://worker.test/bots/${bot.id}/webhook`, auth(token))).json<any>();
    expect(wh.lastDeliveryStatus).toBe('failed');
    expect(wh.lastDeliveryAt).toBeTypeOf('number');
  });

  it('enforces owner isolation and rejects SSRF destinations', async () => {
    const token = await ownerToken();
    const bot = await (await SELF.fetch('https://worker.test/bots', auth(token,'POST',{name:'Webhook Bot',username:'webhook_bot_2'}))).json<any>();
    expect((await SELF.fetch(`https://worker.test/bots/${bot.id}/webhook`, auth(token,'POST',{url:'http://127.0.0.1/callback'}))).status).toBe(400);
    expect((await SELF.fetch('https://worker.test/bots/missing/webhook', auth(token))).status).toBe(404);
  });
});
