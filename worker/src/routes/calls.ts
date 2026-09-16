import { Hono } from "hono";
import { requireUserSession, UserSession } from "../middleware/auth";
import { uid } from "../lib/keys";
import { sendFCMToTokens, callPayload } from "../lib/fcm";
import { checkBotLimits, requestIp } from "../lib/botRateLimit";
import {
  cloudflareIceServers,
  opaqueTurnUser,
  TURN_TTL_SECONDS,
} from "../lib/turn";
const calls = new Hono<{ Bindings: any; Variables: { user: UserSession } }>();
calls.use("*", requireUserSession);
calls.use("*", async (c, next) => {
  const cutoff = Date.now() - 60_000;
  const now = Date.now(),
    db = c.env.DB as D1Database;
  const expired = await db
    .prepare("SELECT * FROM calls WHERE state='ringing' AND started_at<?")
    .bind(cutoff)
    .all<any>();
  for (const call of expired.results ?? []) {
    await db
      .prepare(
        "UPDATE calls SET state='ended',ended_at=?,end_reason='no_answer',updated_at=? WHERE id=? AND state='ringing'",
      )
      .bind(now, now, call.id)
      .run();
    await persistOutcome(db, call, now, "no_answer");
  }
  await next();
});
const shape = (r: any, userId: string) => ({
  id: r.id,
  state: r.state,
  direction: r.caller_id === userId ? "outgoing" : "incoming",
  callerId: r.caller_id,
  calleeId: r.callee_id,
  peerId: r.caller_id === userId ? r.callee_id : r.caller_id,
  offer: r.offer_sdp ? JSON.parse(r.offer_sdp) : null,
  answer: r.answer_sdp ? JSON.parse(r.answer_sdp) : null,
  startedAt: r.started_at,
  answeredAt: r.answered_at,
  endedAt: r.ended_at,
  endReason: r.end_reason,
});
async function persistOutcome(
  db: D1Database,
  r: any,
  now: number,
  reason: string,
) {
  const status =
    reason === "rejected"
      ? "declined"
      : reason === "no_answer"
        ? "missed"
        : ["failed", "ice_failed"].includes(reason)
          ? "failed"
          : r.answered_at
            ? "completed"
            : "missed";
  const duration = r.answered_at
    ? Math.max(0, Math.floor((now - r.answered_at) / 1000))
    : 0;
  await db
    .prepare(
      "INSERT OR IGNORE INTO call_logs(id,user_id,contact_id,direction,type,status,duration_sec,at)VALUES(?,?,?,?,?,?,?,?), (?,?,?,?,?,?,?,?)",
    )
    .bind(
      `call:${r.id}:caller`,
      r.caller_id,
      r.callee_id,
      "outgoing",
      "voice",
      status,
      duration,
      r.started_at,
      `call:${r.id}:callee`,
      r.callee_id,
      r.caller_id,
      "incoming",
      "voice",
      status,
      duration,
      r.started_at,
    )
    .run();
}
async function owned(c: any, id: string, userId: string) {
  return c.env.DB.prepare(
    "SELECT * FROM calls WHERE id=? AND (caller_id=? OR callee_id=?)",
  )
    .bind(id, userId, userId)
    .first();
}
calls.get("/ice-servers", async (c) => {
  const { userId } = c.get("user");
  if (!c.env.TURN_KEY_ID || !c.env.TURN_KEY_API_TOKEN)
    return c.json({ error: "turn_not_configured" }, 503);
  const limited = await checkBotLimits(c.env.KV, {
    surface: "turn-credentials",
    botUserId: userId,
    ip: requestIp(c.req.raw),
    limit: 10,
    windowSec: 60,
  });
  if (!limited.allowed) {
    c.header("Retry-After", String(limited.retryAfter));
    return c.json({ error: "rate_limited" }, 429);
  }
  try {
    const iceServers = await cloudflareIceServers({
      keyId: c.env.TURN_KEY_ID,
      apiToken: c.env.TURN_KEY_API_TOKEN,
      customIdentifier: await opaqueTurnUser(userId),
    });
    c.header("Cache-Control", "no-store");
    return c.json({ iceServers, ttl: TURN_TTL_SECONDS });
  } catch (error) {
    console.error("TURN credential generation failed", error);
    return c.json({ error: "turn_credentials_unavailable" }, 502);
  }
});
calls.get("/", async (c) => {
  const { userId } = c.get("user");
  const rows = await c.env.DB.prepare(
    "SELECT * FROM calls WHERE caller_id=? OR callee_id=? ORDER BY updated_at DESC LIMIT 100",
  )
    .bind(userId, userId)
    .all();
  return c.json((rows.results ?? []).map((x: any) => shape(x, userId)));
});
calls.get("/active", async (c) => {
  const { userId } = c.get("user");
  const r = await c.env.DB.prepare(
    "SELECT * FROM calls WHERE (caller_id=? OR callee_id=?) AND state IN ('ringing','connecting','active') ORDER BY updated_at DESC LIMIT 1",
  )
    .bind(userId, userId)
    .first();
  return c.json(r ? shape(r, userId) : null);
});
calls.post("/", async (c) => {
  const { userId, name } = c.get("user");
  const b = await c.req.json<{ calleeId?: string; offer?: any }>();
  if (!b.calleeId || !b.offer)
    return c.json({ error: "callee_and_offer_required" }, 400);
  if (b.calleeId === userId) return c.json({ error: "cannot_call_self" }, 400);
  const callee = await c.env.DB.prepare("SELECT id FROM users WHERE id=?")
    .bind(b.calleeId)
    .first();
  if (!callee) return c.json({ error: "callee_not_found" }, 404);
  const busy = await c.env.DB.prepare(
    "SELECT id FROM calls WHERE (caller_id=? OR callee_id=? OR caller_id=? OR callee_id=?) AND state IN ('ringing','connecting','active')",
  )
    .bind(userId, userId, b.calleeId, b.calleeId)
    .first();
  if (busy) return c.json({ error: "participant_busy" }, 409);
  const id = uid(),
    now = Date.now();
  await c.env.DB.prepare(
    "INSERT INTO calls(id,caller_id,callee_id,state,offer_sdp,started_at,updated_at)VALUES(?,?,?,'ringing',?,?,?)",
  )
    .bind(id, userId, b.calleeId, JSON.stringify(b.offer), now, now)
    .run();
  const t = await c.env.DB.prepare(
    "SELECT fcm_token FROM sessions WHERE user_id=? AND fcm_token IS NOT NULL AND push_enabled=1",
  )
    .bind(b.calleeId)
    .all();
  c.executionCtx.waitUntil(
    sendFCMToTokens(
      c.env.FCM_SERVER_KEY,
      (t.results ?? []).map((x: any) => x.fcm_token),
      callPayload(name, "voice", userId, id),
    ),
  );
  return c.json({ id, state: "ringing" }, 201);
});
calls.post("/:id/answer", async (c) => {
  const { userId } = c.get("user");
  const r = await owned(c, c.req.param("id"), userId);
  if (!r) return c.json({ error: "not_found" }, 404);
  if (r.callee_id !== userId || r.state !== "ringing")
    return c.json({ error: "invalid_call_state" }, 409);
  const { answer } = await c.req.json<{ answer?: any }>();
  if (!answer) return c.json({ error: "answer_required" }, 400);
  const now = Date.now();
  await c.env.DB.prepare(
    "UPDATE calls SET answer_sdp=?,state='active',answered_at=?,updated_at=? WHERE id=?",
  )
    .bind(JSON.stringify(answer), now, now, r.id)
    .run();
  return c.json({ ok: true });
});
calls.post("/:id/ice", async (c) => {
  const { userId } = c.get("user");
  const r = await owned(c, c.req.param("id"), userId);
  if (!r || r.ended_at) return c.json({ error: "not_found" }, 404);
  const { candidate } = await c.req.json<{ candidate?: any }>();
  if (!candidate) return c.json({ error: "candidate_required" }, 400);
  await c.env.DB.prepare(
    "INSERT INTO call_ice_candidates(id,call_id,sender_id,candidate,created_at)VALUES(?,?,?,?,?)",
  )
    .bind(uid(), r.id, userId, JSON.stringify(candidate), Date.now())
    .run();
  return c.json({ ok: true }, 201);
});
calls.get("/:id/ice", async (c) => {
  const { userId } = c.get("user");
  const r = await owned(c, c.req.param("id"), userId);
  if (!r) return c.json({ error: "not_found" }, 404);
  const after = Number(c.req.query("after") ?? 0);
  const rows = await c.env.DB.prepare(
    "SELECT id,candidate,created_at FROM call_ice_candidates WHERE call_id=? AND sender_id!=? AND created_at>? ORDER BY created_at",
  )
    .bind(r.id, userId, after)
    .all();
  return c.json(
    (rows.results ?? []).map((x: any) => ({
      id: x.id,
      candidate: JSON.parse(x.candidate),
      createdAt: x.created_at,
    })),
  );
});
calls.get("/:id", async (c) => {
  const { userId } = c.get("user");
  const r = await owned(c, c.req.param("id"), userId);
  return r ? c.json(shape(r, userId)) : c.json({ error: "not_found" }, 404);
});
calls.post("/:id/end", async (c) => {
  const { userId } = c.get("user");
  const r = await owned(c, c.req.param("id"), userId);
  if (!r) return c.json({ error: "not_found" }, 404);
  if (!r.ended_at) {
    const { reason = "ended" } = await c.req
      .json<{ reason?: string }>()
      .catch(() => ({ reason: "ended" }));
    const now = Date.now();
    await c.env.DB.prepare(
      "UPDATE calls SET state='ended',ended_at=?,ended_by=?,end_reason=?,updated_at=? WHERE id=?",
    )
      .bind(now, userId, reason, now, r.id)
      .run();
    await persistOutcome(c.env.DB, r, now, reason);
  }
  return c.json({ ok: true });
});
export default calls;
