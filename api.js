// api.js — Cloudflare Worker client
// Worker URL lives in config.js — edit it there once after deploying your worker.
// No env var needed: the APK is built via GitHub Actions + Gradle (expo is used
// only for prebuild, not as a cloud build service), so there is no build-time
// env-var injection step to maintain.

import { API_URL } from "./config";
import { awaitHydration, getRuntimeSession, reportUnauthorized, setRuntimeToken } from "./sessionRuntime.mjs";

const BASE_URL = API_URL;

export function setSessionToken(token) { setRuntimeToken(token); }
export function getSessionToken() { return getRuntimeSession().token; }
export { setSessionToken as setApiKey };

export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.name = "ApiError"; this.status = status; this.code = code; }
}

async function request(path, options = {}) {
  const auth = options.auth !== false;
  if (auth) await awaitHydration();
  const observed = getRuntimeSession();
  const headers = { "Content-Type": "application/json", ...options.headers };
  if (auth && !observed.token) throw new ApiError("Sign in required", 401, "missing_session");
  if (auth && observed.token) headers.Authorization = `Bearer ${observed.token}`;
  const { auth: _auth, ...fetchOptions } = options;
  let res;
  const attempts = (fetchOptions.method == null || fetchOptions.method === "GET") ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { res = await fetch(`${BASE_URL}${path}`, { ...fetchOptions, headers }); }
    catch (error) {
      if (attempt + 1 < attempts) continue;
      throw new ApiError("Network unavailable", 0, "network_unavailable");
    }
    if (![502, 503, 504].includes(res.status) || attempt + 1 === attempts) break;
  }
  if (auth && observed.generation !== getRuntimeSession().generation) throw new ApiError("Account changed while loading", 409, "session_changed");
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) reportUnauthorized(observed.token);
    throw new ApiError(body.message || body.error || `request_failed_${res.status}`, res.status, body.error);
  }
  return body;
}

export async function authenticatedFetch(url, options = {}) {
  await awaitHydration();
  const observed = getRuntimeSession();
  if (!observed.token) throw new ApiError("Sign in required", 401, "missing_session");
  let res;
  try { res = await fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${observed.token}` } }); }
  catch { throw new ApiError("Network unavailable", 0, "network_unavailable"); }
  if (observed.generation !== getRuntimeSession().generation) throw new ApiError("Account changed while loading", 409, "session_changed");
  if (res.status === 401) reportUnauthorized(observed.token);
  return res;
}

async function upload(path, formData) {
  await awaitHydration();
  const observed = getRuntimeSession();
  if (!observed.token) throw new ApiError("Sign in required", 401, "missing_session");
  let res;
  try { res = await fetch(`${BASE_URL}${path}`, { method: "POST", headers: { Authorization: `Bearer ${observed.token}` }, body: formData }); }
  catch { throw new ApiError("Network unavailable", 0, "network_unavailable"); }
  if (observed.generation !== getRuntimeSession().generation) throw new ApiError("Account changed while loading", 409, "session_changed");
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) reportUnauthorized(observed.token);
    throw new ApiError(body.message || body.error || `upload_failed_${res.status}`, res.status, body.error);
  }
  return body;
}

export const api = {
  // ── Auth ──────────────────────────────────────────────────────────────────
  // No self-service sign-up — accounts are created directly in the
  // Cloudflare D1 database by the app owner.
  login: (body) =>
    request("/auth/login", { method: "POST", body: JSON.stringify(body), auth: false }),
  rotateApiKey: async () => {
    const result = await request("/auth/rotate", { method: "POST" });
    return { ...result, apiKey: result.apiKey || result.sessionToken };
  },
  logout: () => request("/auth/logout", { method: "POST" }),

  // ── Account / Profile ─────────────────────────────────────────────────────
  me: () => request("/accounts/me"),
  updateProfile: (body) =>
    request("/accounts/me", { method: "PATCH", body: JSON.stringify(body) }),
  uploadPhoto: (formData) => upload("/accounts/me/photo", formData),
  registerPushToken: (token) =>
    request("/accounts/me/push-token", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  listSessions: () => request("/accounts/me/sessions"),
  updateSession: (sid, body) =>
    request(`/accounts/me/sessions/${sid}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteSession: (sid) =>
    request(`/accounts/me/sessions/${sid}`, { method: "DELETE" }),
  deleteAllOtherSessions: () =>
    request("/accounts/me/sessions", { method: "DELETE" }),
  logoutAllDevices: () =>
    request("/accounts/me/sessions/everywhere", { method: "DELETE" }),

  // ── Bots ──────────────────────────────────────────────────────────────────
  listBots: () => request("/bots"),
  getBot: (id) => request(`/bots/${id}`),
  createBot: (body) =>
    request("/bots", { method: "POST", body: JSON.stringify(body) }),
  updateBot: (id, body) =>
    request(`/bots/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  enableBot: (id) => request(`/bots/${id}/enable`, { method: "POST" }),
  disableBot: (id) => request(`/bots/${id}/disable`, { method: "POST" }),
  deleteBot: (id) => request(`/bots/${id}`, { method: "DELETE" }),
  rotateBotToken: (id) =>
    request(`/bots/${id}/rotate-token`, { method: "POST" }),
  revokeBotToken: (id) =>
    request(`/bots/${id}/revoke-token`, { method: "POST" }),

  // Bot commands
  listCommands: (botId) => request(`/bots/${botId}/commands`),
  getCommand: (botId, cmdId) => request(`/bots/${botId}/commands/${cmdId}`),
  createCommand: (botId, body) =>
    request(`/bots/${botId}/commands`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateCommand: (botId, cmdId, body) =>
    request(`/bots/${botId}/commands/${cmdId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  enableCommand: (botId, cmdId) =>
    request(`/bots/${botId}/commands/${cmdId}/enable`, { method: "POST" }),
  disableCommand: (botId, cmdId) =>
    request(`/bots/${botId}/commands/${cmdId}/disable`, { method: "POST" }),
  deleteCommand: (botId, cmdId) =>
    request(`/bots/${botId}/commands/${cmdId}`, { method: "DELETE" }),

  // Bot users
  listBotUsers: (botId) => request(`/bots/${botId}/users`),
  // PHASE 12 — dedicated single-user fetch (the API's "Get bot user"),
  // mirrors getCommand's precedent from Phase 11. Added because nothing on
  // the client called the Worker's GET /bots/:id/users/:userId before this
  // — botsApi.js's fetchBotUser was pulling the *entire* user list and
  // filtering client-side to find one row.
  getBotUser: (botId, userId) => request(`/bots/${botId}/users/${userId}`),
  updateBotUser: (botId, userId, body) =>
    request(`/bots/${botId}/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  // PHASE 12 — dedicated block/unblock/mute/unmute actions. The Worker
  // routes for these (worker/src/routes/bots.ts) existed before this
  // change; nothing in this client called them — every screen was instead
  // doing a "fetch the user, PATCH the opposite of whatever it says" round
  // trip, which is exactly the race those dedicated routes exist to avoid.
  blockBotUser: (botId, userId) =>
    request(`/bots/${botId}/users/${userId}/block`, { method: "POST" }),
  unblockBotUser: (botId, userId) =>
    request(`/bots/${botId}/users/${userId}/unblock`, { method: "POST" }),
  muteBotUser: (botId, userId) =>
    request(`/bots/${botId}/users/${userId}/mute`, { method: "POST" }),
  unmuteBotUser: (botId, userId) =>
    request(`/bots/${botId}/users/${userId}/unmute`, { method: "POST" }),
  getBotUserMessages: (botId, userId) =>
    request(`/bots/${botId}/users/${userId}/messages`),
  sendBotUserMessage: (botId, userId, body) =>
    request(`/bots/${botId}/users/${userId}/messages`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteBotUser: (botId, userId) =>
    request(`/bots/${botId}/users/${userId}`, { method: "DELETE" }),

  // Bot analytics + activity
  getBotAnalytics: (botId) => request(`/bots/${botId}/analytics`),
  // PHASE 13 — dedicated time-series endpoint; `days` defaults to 7 server-side.
  getBotAnalyticsDaily: (botId, days) =>
    request(`/bots/${botId}/analytics/daily${days ? `?days=${days}` : ""}`),
  getBotActivity: (botId) => request(`/bots/${botId}/activity`),
  listBotConversations: (botId) => request(`/bots/${botId}/conversations`),
  getBotConversationMessages: (botId, userId) =>
    request(`/bots/${botId}/conversations/${userId}/messages`),
  listBotFiles: (botId) => request(`/bots/${botId}/files`),
  uploadBotFile: (botId, formData) => upload(`/bots/${botId}/files`, formData),
  deleteBotFile: (botId, fileId) =>
    request(`/bots/${botId}/files/${fileId}`, { method: "DELETE" }),
  getBotWebhook: (botId) => request(`/bots/${botId}/webhook`),
  configureBotWebhook: (botId, body) =>
    request(`/bots/${botId}/webhook`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateBotWebhook: (botId, body) =>
    request(`/bots/${botId}/webhook`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  enableBotWebhook: (botId) =>
    request(`/bots/${botId}/webhook/enable`, { method: "POST" }),
  disableBotWebhook: (botId) =>
    request(`/bots/${botId}/webhook/disable`, { method: "POST" }),
  rotateBotWebhookSecret: (botId) =>
    request(`/bots/${botId}/webhook/rotate-secret`, { method: "POST" }),
  testBotWebhook: (botId) =>
    request(`/bots/${botId}/webhook/test`, { method: "POST" }),
  listBotWebhookDeliveries: (botId) =>
    request(`/bots/${botId}/webhook/deliveries`),
  deleteBotWebhook: (botId) =>
    request(`/bots/${botId}/webhook`, { method: "DELETE" }),

  // People directory (session-authenticated, public profile fields only)
  searchUsers: (q) => request(`/accounts/directory?q=${encodeURIComponent(q ?? "")}`),
  getUser: (id) => request(`/accounts/directory/${encodeURIComponent(id)}`),

  // ── Conversations (Messages tab) ──────────────────────────────────────────
  listConversations: () => request("/conversations"),
  searchConversations: (q, kinds) =>
    request(
      `/conversations/search?${new URLSearchParams({ q: q ?? "", ...(kinds?.length ? { kinds: kinds.join(",") } : {}) })}`,
    ),
  createConversation: (body) =>
    request("/conversations", { method: "POST", body: JSON.stringify(body) }),
  startDirectConversation: (userId) =>
    request("/conversations/direct", { method: "POST", body: JSON.stringify({ userId }) }),
  getConversation: (id) => request(`/conversations/${id}`),
  updateConversation: (id, body) =>
    request(`/conversations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteConversation: (id) =>
    request(`/conversations/${id}`, { method: "DELETE" }),
  listMessages: (convId, params) =>
    request(
      `/conversations/${convId}/messages${params ? "?" + new URLSearchParams(params) : ""}`,
    ),
  sendMessage: (convId, body) =>
    request(`/conversations/${convId}/messages`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  reactToMessage: (convId, msgId, emoji) =>
    request(`/conversations/${convId}/messages/${msgId}/reactions`, {
      method: "POST",
      body: JSON.stringify({ emoji }),
    }),

  // ── Servers ───────────────────────────────────────────────────────────────
  listServers: () => request("/servers"),
  createServer: (body) =>
    request("/servers", { method: "POST", body: JSON.stringify(body) }),
  getServer: (id) => request(`/servers/${id}`),
  updateServer: (id, body) =>
    request(`/servers/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteServer: (id) => request(`/servers/${id}`, { method: "DELETE" }),

  // Channels
  createChannel: (serverId, body) =>
    request(`/servers/${serverId}/channels`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateChannel: (serverId, chId, body) =>
    request(`/servers/${serverId}/channels/${chId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteChannel: (serverId, chId) =>
    request(`/servers/${serverId}/channels/${chId}`, { method: "DELETE" }),
  listChannelMessages: (serverId, chId, limit) =>
    request(
      `/servers/${serverId}/channels/${chId}/messages${limit ? `?limit=${limit}` : ""}`,
    ),
  sendChannelMessage: (serverId, chId, body) =>
    request(`/servers/${serverId}/channels/${chId}/messages`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Members
  listMembers: (serverId) => request(`/servers/${serverId}/members`),
  updateMember: (serverId, memberId, body) =>
    request(`/servers/${serverId}/members/${memberId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  kickMember: (serverId, memberId) =>
    request(`/servers/${serverId}/members/${memberId}`, { method: "DELETE" }),

  // ── Privacy ───────────────────────────────────────────────────────────────
  listBlocked: () => request("/privacy/blocked"),
  blockUser: (body) =>
    request("/privacy/blocked", { method: "POST", body: JSON.stringify(body) }),
  unblockUser: (id) => request(`/privacy/blocked/${id}`, { method: "DELETE" }),
  getPrivacySettings: () => request("/privacy/settings"),
  updatePrivacySettings: (body) =>
    request("/privacy/settings", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  // ── Developer Platform ────────────────────────────────────────────────────
  listApiKeys: () => request("/dev/api-keys"),
  createApiKey: (body) =>
    request("/dev/api-keys", { method: "POST", body: JSON.stringify(body) }),
  revokeApiKey: (id) => request(`/dev/api-keys/${id}`, { method: "DELETE" }),
  rotateApiKeyAccess: (id) =>
    request(`/dev/api-keys/${id}/rotate`, { method: "POST" }),
  listApiKeyAudit: (id) => request(`/dev/api-keys/${id}/audit`),

  listWebhooks: () => request("/dev/webhooks"),
  getWebhook: (id) => request(`/dev/webhooks/${id}`),
  listWebhookDeliveries: (id) => request(`/dev/webhooks/${id}/deliveries`),
  createWebhook: (body) =>
    request("/dev/webhooks", { method: "POST", body: JSON.stringify(body) }),
  updateWebhook: (id, body) =>
    request(`/dev/webhooks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  toggleWebhook: (id) =>
    request(`/dev/webhooks/${id}/toggle`, { method: "POST" }),
  rotateWebhookSecret: (id) =>
    request(`/dev/webhooks/${id}/rotate-secret`, { method: "POST" }),
  sendWebhookTest: (id, event) =>
    request(`/dev/webhooks/${id}/test`, {
      method: "POST",
      body: JSON.stringify({ event }),
    }),
  deleteWebhook: (id) => request(`/dev/webhooks/${id}`, { method: "DELETE" }),
  getDevSettings: () => request("/dev/settings"),
  updateDevSettings: (patch) =>
    request("/dev/settings", { method: "PATCH", body: JSON.stringify(patch) }),

  // ── Server Relay (READ ONLY — see worker/src/routes/relay.ts) ────────────
  // PHASE 4: servers/members/channels list endpoints now take the same
  // optional cursor+limit params as messages/poll already did, and return
  // the shared { items, nextCursor, hasMore } page shape.
  listRelayServers: (cursor) =>
    request(
      `/relay/servers${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
  getRelayServer: (id) => request(`/relay/servers/${id}`),
  listRelayMembers: (serverId, cursor) =>
    request(
      `/relay/servers/${serverId}/members${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
  listRelayChannels: (serverId, cursor) =>
    request(
      `/relay/servers/${serverId}/channels${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
  getRelayChannel: (channelId) => request(`/relay/channels/${channelId}`),
  listRelayChannelMessages: (channelId, cursor) =>
    request(
      `/relay/channels/${channelId}/messages${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
  pollRelayChannel: (channelId, since) =>
    request(
      `/relay/channels/${channelId}/poll${since ? `?since=${encodeURIComponent(since)}` : ""}`,
    ),

  // ── Stats ─────────────────────────────────────────────────────────────────
  summary: () => request("/stats/summary"),
  botRate: (id) => request(`/stats/bots/${id}/rate`),

  // ── Files ─────────────────────────────────────────────────────────────────
  getCallIceServers: () => request("/calls/ice-servers"),
  listCalls: () => request("/calls"),
  getActiveCall: () => request("/calls/active"),
  getCall: (id) => request(`/calls/${id}`),
  startCall: (body) =>
    request("/calls", { method: "POST", body: JSON.stringify(body) }),
  answerCall: (id, answer) =>
    request(`/calls/${id}/answer`, {
      method: "POST",
      body: JSON.stringify({ answer }),
    }),
  addCallIce: (id, candidate) =>
    request(`/calls/${id}/ice`, {
      method: "POST",
      body: JSON.stringify({ candidate }),
    }),
  listCallIce: (id, after = 0) => request(`/calls/${id}/ice?after=${after}`),
  endCall: (id, reason = "ended") =>
    request(`/calls/${id}/end`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  uploadFile: (formData) => upload("/files/upload", formData),
};
