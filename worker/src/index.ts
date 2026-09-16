import { Hono } from "hono";
import { cors } from "hono/cors";
import authRoutes from "./routes/auth";
import accountRoutes from "./routes/accounts";
import botRoutes from "./routes/bots";
import botRuntimeRoutes from "./routes/botRuntime";
import messageRoutes from "./routes/messages";
import serverRoutes from "./routes/servers";
import relayRoutes from "./routes/relay";
import callRoutes from "./routes/calls";
import { privacy, dev, stats, files, webhook } from "./routes/other";
import { AGENT_API_DISCOVERY } from "./lib/agentAccess";
import { classifyServiceError, readiness } from "./lib/resilience";
import { requireUserSession } from "./middleware/auth";

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  KV: KVNamespace;
  JWT_SECRET: string;
  FCM_SERVER_KEY: string;
  CORS_ORIGIN: string;
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
}

const app = new Hono<{ Bindings: Env }>();

// ─── Global middleware ────────────────────────────────────────────────────────
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
    maxAge: 86400,
  }),
);
// PHASE 8 — Bot Token Security: the raw bot token travels in the URL path
// of `POST /webhook/:token` (a public, unauthenticated route — see
// routes/other.ts). Hono's built-in `logger()` would print the full
// request path on every call, which means every inbound webhook delivery
// would put a bot's live raw token in plaintext into Cloudflare's console
// logs. This redacting logger is a drop-in replacement that behaves the
// same for every other route, but never lets the `:token` segment through.
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const path = c.req.path.startsWith("/webhook/")
    ? "/webhook/[redacted]"
    : c.req.path;
  console.log(
    `${c.req.method} ${path} ${c.res.status} ${Date.now() - start}ms`,
  );
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.route("/auth", authRoutes);
app.route("/accounts", accountRoutes);
app.route("/bots", botRoutes); // BotManager USER identity — session JWT (requireAuth/requireUserSession)
app.route("/bot-runtime", botRuntimeRoutes); // BOT's own identity — bot token only (requireBotToken), see Phase 9
app.route("/conversations", messageRoutes);
app.route("/servers", serverRoutes);
app.route("/relay", relayRoutes);
app.route("/calls", callRoutes); // Server Relay — READ ONLY, see routes/relay.ts
app.route("/privacy", privacy);
app.route("/dev", dev);
app.route("/stats", stats);
app.route("/files", files);
app.route("/webhook", webhook); // public — token auth in URL

app.get("/agent-api", (c) =>
  c.json({ ...AGENT_API_DISCOVERY, host: new URL(c.req.url).origin }),
);
// ─── Health + catch-all ───────────────────────────────────────────────────────
app.get("/health", (c) => c.json({ ok: true, version: "1.0.0", ts: Date.now() }));
app.get("/ready", requireUserSession, async (c) => {
  const state = await readiness(c.env);
  return c.json(state, state.ok ? 200 : 503);
});
app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((err, c) => {
  const failure = classifyServiceError(err);
  console.error(JSON.stringify({ event: "request_failed", code: failure.code, retryable: failure.retryable, requestId: c.req.header("cf-ray") || null }));
  if (failure.retryable) c.header("Retry-After", "1");
  return c.json({ error: failure.code, message: failure.message, retryable: failure.retryable }, failure.status);
});

export default app;
