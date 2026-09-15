// PHASE 13 — Bot API: Analytics Endpoints.
//
// Single source of truth for every number the analytics screens display.
// Per the phase plan: "Prefer computing analytics from the real
// bot_messages/bot_users tables via aggregate SQL (COUNT, GROUP BY date)
// rather than a separately maintained counter table, to guarantee it
// reflects real data." Both functions below do exactly that — nothing here
// reads `bot_analytics` (that table is now purely a write-time convenience
// cache for the unrelated cross-bot `GET /stats/summary` dashboard; see the
// comment above its upsert in routes/other.ts and routes/bots.ts).
//
// Every field returned is a real COUNT/SUM/COUNT(DISTINCT) over rows that
// actually exist for this bot. There is no placeholder, no fixed/sample
// value, and no field that isn't backed by a column already in the schema
// (in particular: no "uptime" figure — nothing in this schema tracks bot
// process uptime or heartbeats, so a prior phase's hardcoded `uptimePct:
// 99.2` has been removed rather than left in as a fake number).

const DAY_MS = 24 * 60 * 60 * 1000;

// Deliberately epoch-math rather than `new Date().setHours(0,0,0,0)`: the
// latter uses the JS engine's configured local timezone, and while
// Cloudflare's Workers runtime is documented as UTC-only, nothing here
// should depend on that being true in every environment this code might
// run in (including the Miniflare-backed test pool). Unix epoch
// (1970-01-01T00:00:00Z) is itself a UTC midnight, so flooring to the
// nearest DAY_MS always lands exactly on a UTC day boundary regardless of
// any local timezone setting — matching SQLite's `date(x, 'unixepoch')`,
// which is always UTC, exactly.
function startOfTodayMs(): number {
  return Math.floor(Date.now() / DAY_MS) * DAY_MS;
}

// SQLite `date(created_at/1000, 'unixepoch')` gives a YYYY-MM-DD string in
// UTC. Used consistently here (both for grouping and for the zero-fill
// below) so a message stored at a UTC-day boundary is never double-counted
// or dropped between the two.
function toUtcDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export interface BotAnalyticsSummary {
  totalMessages: number;
  inboundMessages: number;
  outboundMessages: number;
  totalUsers: number;
  activeUsers: number;      // distinct bot_users with an inbound message in the last 7 days
  messagesToday: number;
  activeUsersToday: number; // distinct bot_users with an inbound message since local midnight
}

export async function getBotAnalyticsSummary(db: D1Database, botId: string): Promise<BotAnalyticsSummary> {
  const sevenDaysAgo = Date.now() - 7 * DAY_MS;
  const todayStart = startOfTodayMs();

  const [totals, totalUsersRow, activeUsersRow, todayRow, activeTodayRow] = await Promise.all([
    db.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN direction = 'in' THEN 1 ELSE 0 END) AS inbound,
         SUM(CASE WHEN direction = 'out' THEN 1 ELSE 0 END) AS outbound
       FROM bot_messages WHERE bot_id = ?`
    ).bind(botId).first<{ total: number; inbound: number | null; outbound: number | null }>(),
    db.prepare('SELECT COUNT(*) AS c FROM bot_users WHERE bot_id = ?').bind(botId).first<{ c: number }>(),
    // "Active users" = real end-users who actually messaged the bot recently
    // (bot_users.last_active_at is bumped only on a genuine inbound message,
    // see routes/other.ts webhook handler) — not a fabricated ratio of totalUsers.
    db.prepare('SELECT COUNT(*) AS c FROM bot_users WHERE bot_id = ? AND last_active_at >= ?')
      .bind(botId, sevenDaysAgo).first<{ c: number }>(),
    db.prepare('SELECT COUNT(*) AS c FROM bot_messages WHERE bot_id = ? AND created_at >= ?')
      .bind(botId, todayStart).first<{ c: number }>(),
    db.prepare(
      `SELECT COUNT(DISTINCT bot_user_id) AS c FROM bot_messages
       WHERE bot_id = ? AND direction = 'in' AND bot_user_id IS NOT NULL AND created_at >= ?`
    ).bind(botId, todayStart).first<{ c: number }>(),
  ]);

  return {
    totalMessages: totals?.total ?? 0,
    inboundMessages: totals?.inbound ?? 0,
    outboundMessages: totals?.outbound ?? 0,
    totalUsers: totalUsersRow?.c ?? 0,
    activeUsers: activeUsersRow?.c ?? 0,
    messagesToday: todayRow?.c ?? 0,
    activeUsersToday: activeTodayRow?.c ?? 0,
  };
}

export interface BotAnalyticsDay {
  date: string;   // YYYY-MM-DD, UTC
  messages: number;
  inbound: number;
  outbound: number;
  activeUsers: number; // distinct senders that day
}

// Returns exactly `days` entries, oldest first, ending today (UTC) —
// including days with zero activity (a real, correct zero, not a gap and
// not a fabricated interpolation).
export async function getBotAnalyticsDaily(db: D1Database, botId: string, days: number): Promise<BotAnalyticsDay[]> {
  const clampedDays = Math.max(1, Math.min(days, 90));
  const rangeStart = startOfTodayMs() - (clampedDays - 1) * DAY_MS;

  const rows = await db.prepare(
    `SELECT
       date(created_at / 1000, 'unixepoch') AS day,
       COUNT(*) AS messages,
       SUM(CASE WHEN direction = 'in' THEN 1 ELSE 0 END) AS inbound,
       SUM(CASE WHEN direction = 'out' THEN 1 ELSE 0 END) AS outbound,
       COUNT(DISTINCT bot_user_id) AS activeUsers
     FROM bot_messages
     WHERE bot_id = ? AND created_at >= ?
     GROUP BY day
     ORDER BY day ASC`
  ).bind(botId, rangeStart).all<any>();

  const byDay = new Map<string, any>();
  for (const r of rows.results ?? []) byDay.set(r.day, r);

  const out: BotAnalyticsDay[] = [];
  for (let i = 0; i < clampedDays; i++) {
    const key = toUtcDateKey(rangeStart + i * DAY_MS);
    const r = byDay.get(key);
    out.push({
      date: key,
      messages: r?.messages ?? 0,
      inbound: r?.inbound ?? 0,
      outbound: r?.outbound ?? 0,
      activeUsers: r?.activeUsers ?? 0,
    });
  }
  return out;
}

// PHASE 13 — used by both the inbound webhook handler (routes/other.ts) and
// the outbound send route (routes/bots.ts) to keep the `bot_analytics`
// write-time cache (consumed only by the cross-bot GET /stats/summary
// dashboard) exactly correct, instead of the blind
// `active_users = active_users + 1`-per-message increment a prior phase
// left in place — that increment made `active_users` an exact duplicate of
// `message_count` (wrong for any user who sent more than one message in a
// day) rather than a real distinct-sender count. Recomputing both columns
// from the real rows on every write is race-safe (each write reflects the
// true state at the time it runs) and — critically — never fabricates a
// number: same principle as the two functions above, just applied at
// write time for a cache table instead of read time for the live endpoints.
export async function refreshBotAnalyticsForToday(db: D1Database, botId: string): Promise<void> {
  const todayStart = startOfTodayMs();
  const todayKey = toUtcDateKey(todayStart);
  const row = await db.prepare(
    `SELECT
       COUNT(*) AS message_count,
       COUNT(DISTINCT CASE WHEN direction = 'in' THEN bot_user_id END) AS active_users
     FROM bot_messages WHERE bot_id = ? AND created_at >= ?`
  ).bind(botId, todayStart).first<{ message_count: number; active_users: number }>();

  await db.prepare(
    `INSERT INTO bot_analytics (bot_id, date, message_count, active_users) VALUES (?, ?, ?, ?)
     ON CONFLICT(bot_id, date) DO UPDATE SET
       message_count = excluded.message_count,
       active_users = excluded.active_users`
  ).bind(botId, todayKey, row?.message_count ?? 0, row?.active_users ?? 0).run();
}
