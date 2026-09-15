import { Hono } from 'hono';
import { requireAuth, UserSession } from '../middleware/auth';

const accounts = new Hono<{ Bindings: any; Variables: { user: UserSession } }>();
accounts.use('*', requireAuth);

// GET /accounts/me
accounts.get('/me', async (c) => {
  const { userId } = c.get('user') as UserSession;
  const db: D1Database = c.env.DB;
  const user = await db.prepare(
    'SELECT id, email, username, name, bio, photo_url, two_step_enabled, created_at FROM users WHERE id = ?'
  ).bind(userId).first<any>();
  if (!user) return c.json({ error: 'not_found' }, 404);
  return c.json({ ...user, photoUrl: user.photo_url });
});

// PATCH /accounts/me — update profile
accounts.patch('/me', async (c) => {
  const { userId } = c.get('user') as UserSession;
  const body = await c.req.json<{ name?: string; bio?: string; username?: string }>();
  const db: D1Database = c.env.DB;

  const updates: string[] = [];
  const vals: unknown[] = [];
  if (body.name !== undefined) { updates.push('name = ?'); vals.push(body.name); }
  if (body.bio !== undefined) { updates.push('bio = ?'); vals.push(body.bio); }
  if (body.username !== undefined) {
    const exists = await db.prepare('SELECT id FROM users WHERE username = ? AND id != ?')
      .bind(body.username.toLowerCase(), userId).first();
    if (exists) return c.json({ error: 'username_taken', message: 'That username is taken.' }, 409);
    updates.push('username = ?');
    vals.push(body.username.toLowerCase());
  }
  if (!updates.length) return c.json({ error: 'nothing_to_update' }, 400);

  updates.push('updated_at = ?');
  vals.push(Date.now(), userId);

  await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...vals).run();
  const user = await db.prepare('SELECT id, email, username, name, bio, photo_url FROM users WHERE id = ?').bind(userId).first<any>();
  return c.json({ ...user, photoUrl: user?.photo_url });
});

// POST /accounts/me/photo — upload profile photo via R2
accounts.post('/me/photo', async (c) => {
  const { userId } = c.get('user') as UserSession;
  const formData = await c.req.formData();
  const file = formData.get('photo') as File | null;
  if (!file) return c.json({ error: 'photo_required' }, 400);

  const key = `avatars/${userId}/${Date.now()}.jpg`;
  await (c.env.BUCKET as R2Bucket).put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || 'image/jpeg' },
  });

  const photoUrl = new URL(`/files/${key}`, c.req.url).toString();
  await (c.env.DB as D1Database).prepare('UPDATE users SET photo_url = ?, updated_at = ? WHERE id = ?')
    .bind(photoUrl, Date.now(), userId).run();

  return c.json({ photoUrl });
});

// POST /accounts/me/push-token — register FCM device token
accounts.post('/me/push-token', async (c) => {
  const { sessionId } = c.get('user') as UserSession;
  const { token } = await c.req.json<{ token: string }>();
  if (!token) return c.json({ error: 'token_required' }, 400);

  await (c.env.DB as D1Database).prepare('UPDATE sessions SET fcm_token = ? WHERE id = ?')
    .bind(token, sessionId).run();

  return c.json({ ok: true });
});

// GET /accounts/me/sessions — list all active sessions
accounts.get('/me/sessions', async (c) => {
  const { userId, sessionId } = c.get('user') as UserSession;
  const rows = await (c.env.DB as D1Database).prepare(
    'SELECT id, device_name, device_ip, platform, app_version, push_enabled, last_active_at, created_at FROM sessions WHERE user_id = ? ORDER BY last_active_at DESC'
  ).bind(userId).all<any>();
  return c.json((rows.results ?? []).map(s => ({ ...s, current: s.id === sessionId })));
});

// PATCH /accounts/me/sessions/:sid — update a session (currently: push_enabled)
accounts.patch('/me/sessions/:sid', async (c) => {
  const { userId } = c.get('user') as UserSession;
  const body = await c.req.json<{ pushEnabled?: boolean }>();
  if (body.pushEnabled === undefined) return c.json({ error: 'nothing_to_update' }, 400);
  await (c.env.DB as D1Database)
    .prepare('UPDATE sessions SET push_enabled = ? WHERE id = ? AND user_id = ?')
    .bind(body.pushEnabled ? 1 : 0, c.req.param('sid'), userId).run();
  return c.json({ ok: true });
});

// DELETE /accounts/me/sessions/everywhere — revoke every session, including this one
accounts.delete('/me/sessions/everywhere', async (c) => {
  const { userId } = c.get('user') as UserSession;
  await (c.env.DB as D1Database).prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
  return c.json({ ok: true });
});

// DELETE /accounts/me/sessions/:sessionId — revoke a session
accounts.delete('/me/sessions/:sid', async (c) => {
  const { userId } = c.get('user') as UserSession;
  const sid = c.req.param('sid');
  await (c.env.DB as D1Database).prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').bind(sid, userId).run();
  return c.json({ ok: true });
});

// DELETE /accounts/me/sessions — revoke all other sessions
accounts.delete('/me/sessions', async (c) => {
  const { userId, sessionId } = c.get('user') as UserSession;
  await (c.env.DB as D1Database).prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').bind(userId, sessionId).run();
  return c.json({ ok: true });
});

export default accounts;
