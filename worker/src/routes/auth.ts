import { Hono } from 'hono';
import { uid, hashPassword, verifyPassword, hashToken } from '../lib/keys';
import { signJWT } from '../lib/jwt';
import { requireAuth, UserSession } from '../middleware/auth';

// There is no self-service sign-up. Every user row is created directly in
// the Cloudflare D1 database by the app owner — this route only issues
// sessions for credentials that already exist.

const auth = new Hono<{ Bindings: any; Variables: { user: UserSession } }>();

// ── POST /auth/login ─────────────────────────────────────────────────────────
auth.post('/login', async (c) => {
  const { identifier, password, deviceName, platform } = await c.req.json<{
    identifier: string; password: string; deviceName?: string; platform?: string;
  }>();

  if (!identifier?.trim() || !password) return c.json({ error: 'credentials_required' }, 400);

  const db: D1Database = c.env.DB;
  const isEmail = identifier.includes('@');
  const user = await db.prepare(
    isEmail
      ? 'SELECT * FROM users WHERE email = ?'
      : 'SELECT * FROM users WHERE username = ?'
  ).bind(identifier.toLowerCase()).first<{
    id: string; email: string; username: string; name: string; bio: string | null; photo_url: string | null;
    password_hash: string;
  }>();

  if (!user) return c.json({ error: 'invalid_credentials', message: 'Incorrect email/username or password.' }, 401);

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return c.json({ error: 'invalid_credentials', message: 'Incorrect email/username or password.' }, 401);

  const sessionToken = await issueSession(c, db, user.id, user, deviceName, platform);
  return c.json({ sessionToken, name: user.name, username: user.username, email: user.email, bio: user.bio ?? "", photoUrl: user.photo_url ?? null });
});

// ── POST /auth/logout ────────────────────────────────────────────────────────
auth.post('/logout', async (c) => {
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (token) {
    const tokenHash = await hashToken(token);
    await (c.env.DB as D1Database).prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
  }
  return c.json({ ok: true });
});

// ── POST /auth/rotate — invalidate the current session token and issue a
// fresh one (the app's "regenerate API key" action). The old token stops
// working immediately since its session row is deleted.
auth.post('/rotate', requireAuth, async (c) => {
  const { userId, sessionId } = c.get('user') as UserSession;
  const db: D1Database = c.env.DB;

  const [user, oldSession] = await Promise.all([
    db.prepare('SELECT email, username, name FROM users WHERE id = ?').bind(userId).first<any>(),
    db.prepare('SELECT device_name, platform FROM sessions WHERE id = ?').bind(sessionId).first<any>(),
  ]);
  if (!user) return c.json({ error: 'not_found' }, 404);

  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
  const sessionToken = await issueSession(c, db, userId, user, oldSession?.device_name, oldSession?.platform);
  return c.json({ sessionToken, apiKey: sessionToken });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function issueSession(
  c: any,
  db: D1Database,
  userId: string,
  user: { email: string; username: string; name: string },
  deviceName?: string,
  platform?: string
): Promise<string> {
  const sessionId = uid();
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const now = Date.now();

  const token = await signJWT(
    { sub: userId, sid: sessionId, email: user.email, username: user.username, name: user.name },
    c.env.JWT_SECRET
  );
  const tokenHash = await hashToken(token);

  await db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, device_name, device_ip, platform, last_active_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(sessionId, userId, tokenHash, deviceName ?? 'Unknown Device', ip, platform ?? 'unknown', now, now).run();

  return token;
}

export default auth;
