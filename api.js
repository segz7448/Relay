// api.js — Cloudflare Worker client
// Worker URL lives in config.js — edit it there once after deploying your worker.
// No env var needed: the APK is built via GitHub Actions + Gradle (expo is used
// only for prebuild, not as a cloud build service), so there is no build-time
// env-var injection step to maintain.

import { API_URL } from './config';

const BASE_URL = API_URL;

let sessionToken = null;

export function setSessionToken(token) { sessionToken = token; }
export function getSessionToken() { return sessionToken; }
// Legacy alias used by auth.js / accountsStore
export { setSessionToken as setApiKey };

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`;

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || body.error || `request_failed_${res.status}`);
  return body;
}

async function upload(path, formData) {
  const headers = {};
  if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`;
  const res = await fetch(`${BASE_URL}${path}`, { method: 'POST', headers, body: formData });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || body.error || `upload_failed_${res.status}`);
  return body;
}

export const api = {
  // ── Auth ──────────────────────────────────────────────────────────────────
  // No self-service sign-up — accounts are created directly in the
  // Cloudflare D1 database by the app owner.
  login: (body) => request('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  rotateApiKey: () => request('/auth/rotate', { method: 'POST' }),
  logout: () => request('/auth/logout', { method: 'POST' }),

  // ── Account / Profile ─────────────────────────────────────────────────────
  me: () => request('/accounts/me'),
  updateProfile: (body) => request('/accounts/me', { method: 'PATCH', body: JSON.stringify(body) }),
  uploadPhoto: (formData) => upload('/accounts/me/photo', formData),
  registerPushToken: (token) => request('/accounts/me/push-token', { method: 'POST', body: JSON.stringify({ token }) }),
  listSessions: () => request('/accounts/me/sessions'),
  updateSession: (sid, body) => request(`/accounts/me/sessions/${sid}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteSession: (sid) => request(`/accounts/me/sessions/${sid}`, { method: 'DELETE' }),
  deleteAllOtherSessions: () => request('/accounts/me/sessions', { method: 'DELETE' }),
  logoutAllDevices: () => request('/accounts/me/sessions/everywhere', { method: 'DELETE' }),

  // ── Bots ──────────────────────────────────────────────────────────────────
  listBots: () => request('/bots'),
  getBot: (id) => request(`/bots/${id}`),
  createBot: (body) => request('/bots', { method: 'POST', body: JSON.stringify(body) }),
  updateBot: (id, body) => request(`/bots/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  enableBot: (id) => request(`/bots/${id}/enable`, { method: 'POST' }),
  disableBot: (id) => request(`/bots/${id}/disable`, { method: 'POST' }),
  deleteBot: (id) => request(`/bots/${id}`, { method: 'DELETE' }),
  rotateBotToken: (id) => request(`/bots/${id}/rotate-token`, { method: 'POST' }),
  revokeBotToken: (id) => request(`/bots/${id}/revoke-token`, { method: 'POST' }),

  // Bot commands
  listCommands: (botId) => request(`/bots/${botId}/commands`),
  getCommand: (botId, cmdId) => request(`/bots/${botId}/commands/${cmdId}`),
  createCommand: (botId, body) => request(`/bots/${botId}/commands`, { method: 'POST', body: JSON.stringify(body) }),
  updateCommand: (botId, cmdId, body) => request(`/bots/${botId}/commands/${cmdId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  enableCommand: (botId, cmdId) => request(`/bots/${botId}/commands/${cmdId}/enable`, { method: 'POST' }),
  disableCommand: (botId, cmdId) => request(`/bots/${botId}/commands/${cmdId}/disable`, { method: 'POST' }),
  deleteCommand: (botId, cmdId) => request(`/bots/${botId}/commands/${cmdId}`, { method: 'DELETE' }),

  // Bot users
  listBotUsers: (botId) => request(`/bots/${botId}/users`),
  // PHASE 12 — dedicated single-user fetch (the API's "Get bot user"),
  // mirrors getCommand's precedent from Phase 11. Added because nothing on
  // the client called the Worker's GET /bots/:id/users/:userId before this
  // — botsApi.js's fetchBotUser was pulling the *entire* user list and
  // filtering client-side to find one row.
  getBotUser: (botId, userId) => request(`/bots/${botId}/users/${userId}`),
  updateBotUser: (botId, userId, body) => request(`/bots/${botId}/users/${userId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  // PHASE 12 — dedicated block/unblock/mute/unmute actions. The Worker
  // routes for these (worker/src/routes/bots.ts) existed before this
  // change; nothing in this client called them — every screen was instead
  // doing a "fetch the user, PATCH the opposite of whatever it says" round
  // trip, which is exactly the race those dedicated routes exist to avoid.
  blockBotUser: (botId, userId) => request(`/bots/${botId}/users/${userId}/block`, { method: 'POST' }),
  unblockBotUser: (botId, userId) => request(`/bots/${botId}/users/${userId}/unblock`, { method: 'POST' }),
  muteBotUser: (botId, userId) => request(`/bots/${botId}/users/${userId}/mute`, { method: 'POST' }),
  unmuteBotUser: (botId, userId) => request(`/bots/${botId}/users/${userId}/unmute`, { method: 'POST' }),
  getBotUserMessages: (botId, userId) => request(`/bots/${botId}/users/${userId}/messages`),
  sendBotUserMessage: (botId, userId, body) => request(`/bots/${botId}/users/${userId}/messages`, { method: 'POST', body: JSON.stringify(body) }),
  deleteBotUser: (botId, userId) => request(`/bots/${botId}/users/${userId}`, { method: 'DELETE' }),

  // Bot analytics + activity
  getBotAnalytics: (botId) => request(`/bots/${botId}/analytics`),
  // PHASE 13 — dedicated time-series endpoint; `days` defaults to 7 server-side.
  getBotAnalyticsDaily: (botId, days) => request(`/bots/${botId}/analytics/daily${days ? `?days=${days}` : ''}`),
  getBotActivity: (botId) => request(`/bots/${botId}/activity`),
  listBotConversations: (botId) => request(`/bots/${botId}/conversations`),
  getBotConversationMessages: (botId, userId) => request(`/bots/${botId}/conversations/${userId}/messages`),
  listBotFiles: (botId) => request(`/bots/${botId}/files`),
  uploadBotFile: (botId, formData) => upload(`/bots/${botId}/files`, formData),
  deleteBotFile: (botId, fileId) => request(`/bots/${botId}/files/${fileId}`, { method: 'DELETE' }),
  getBotWebhook: (botId) => request(`/bots/${botId}/webhook`),
  configureBotWebhook: (botId, body) => request(`/bots/${botId}/webhook`, { method: 'POST', body: JSON.stringify(body) }),
  updateBotWebhook: (botId, body) => request(`/bots/${botId}/webhook`, { method: 'PATCH', body: JSON.stringify(body) }),
  enableBotWebhook: (botId) => request(`/bots/${botId}/webhook/enable`, { method: 'POST' }),
  disableBotWebhook: (botId) => request(`/bots/${botId}/webhook/disable`, { method: 'POST' }),
  rotateBotWebhookSecret: (botId) => request(`/bots/${botId}/webhook/rotate-secret`, { method: 'POST' }),
  testBotWebhook: (botId) => request(`/bots/${botId}/webhook/test`, { method: 'POST' }),
  listBotWebhookDeliveries: (botId) => request(`/bots/${botId}/webhook/deliveries`),
  deleteBotWebhook: (botId) => request(`/bots/${botId}/webhook`, { method: 'DELETE' }),

  // ── Conversations (Messages tab) ──────────────────────────────────────────
  listConversations: () => request('/conversations'),
  searchConversations: (q, kinds) => request(`/conversations/search?${new URLSearchParams({ q: q ?? '', ...(kinds?.length ? { kinds: kinds.join(',') } : {}) })}`),
  createConversation: (body) => request('/conversations', { method: 'POST', body: JSON.stringify(body) }),
  getConversation: (id) => request(`/conversations/${id}`),
  updateConversation: (id, body) => request(`/conversations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteConversation: (id) => request(`/conversations/${id}`, { method: 'DELETE' }),
  listMessages: (convId, params) => request(`/conversations/${convId}/messages${params ? '?' + new URLSearchParams(params) : ''}`),
  sendMessage: (convId, body) => request(`/conversations/${convId}/messages`, { method: 'POST', body: JSON.stringify(body) }),
  reactToMessage: (convId, msgId, emoji) => request(`/conversations/${convId}/messages/${msgId}/reactions`, { method: 'POST', body: JSON.stringify({ emoji }) }),

  // ── Servers ───────────────────────────────────────────────────────────────
  listServers: () => request('/servers'),
  createServer: (body) => request('/servers', { method: 'POST', body: JSON.stringify(body) }),
  getServer: (id) => request(`/servers/${id}`),
  updateServer: (id, body) => request(`/servers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteServer: (id) => request(`/servers/${id}`, { method: 'DELETE' }),

  // Channels
  createChannel: (serverId, body) => request(`/servers/${serverId}/channels`, { method: 'POST', body: JSON.stringify(body) }),
  updateChannel: (serverId, chId, body) => request(`/servers/${serverId}/channels/${chId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteChannel: (serverId, chId) => request(`/servers/${serverId}/channels/${chId}`, { method: 'DELETE' }),
  listChannelMessages: (serverId, chId, limit) => request(`/servers/${serverId}/channels/${chId}/messages${limit ? `?limit=${limit}` : ''}`),
  sendChannelMessage: (serverId, chId, body) => request(`/servers/${serverId}/channels/${chId}/messages`, { method: 'POST', body: JSON.stringify(body) }),

  // Members
  listMembers: (serverId) => request(`/servers/${serverId}/members`),
  updateMember: (serverId, memberId, body) => request(`/servers/${serverId}/members/${memberId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  kickMember: (serverId, memberId) => request(`/servers/${serverId}/members/${memberId}`, { method: 'DELETE' }),

  // ── Privacy ───────────────────────────────────────────────────────────────
  listBlocked: () => request('/privacy/blocked'),
  blockUser: (body) => request('/privacy/blocked', { method: 'POST', body: JSON.stringify(body) }),
  unblockUser: (id) => request(`/privacy/blocked/${id}`, { method: 'DELETE' }),
  getPrivacySettings: () => request('/privacy/settings'),
  updatePrivacySettings: (body) => request('/privacy/settings', { method: 'PATCH', body: JSON.stringify(body) }),

  // ── Developer Platform ────────────────────────────────────────────────────
  listApiKeys: () => request('/dev/api-keys'),
  createApiKey: (body) => request('/dev/api-keys', { method: 'POST', body: JSON.stringify(body) }),
  revokeApiKey: (id) => request(`/dev/api-keys/${id}`, { method: 'DELETE' }),

  listWebhooks: () => request('/dev/webhooks'),
  getWebhook: (id) => request(`/dev/webhooks/${id}`),
  listWebhookDeliveries: (id) => request(`/dev/webhooks/${id}/deliveries`),
  createWebhook: (body) => request('/dev/webhooks', { method: 'POST', body: JSON.stringify(body) }),
  updateWebhook: (id, body) => request(`/dev/webhooks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  toggleWebhook: (id) => request(`/dev/webhooks/${id}/toggle`, { method: 'POST' }),
  rotateWebhookSecret: (id) => request(`/dev/webhooks/${id}/rotate-secret`, { method: 'POST' }),
  sendWebhookTest: (id, event) => request(`/dev/webhooks/${id}/test`, { method: 'POST', body: JSON.stringify({ event }) }),
  deleteWebhook: (id) => request(`/dev/webhooks/${id}`, { method: 'DELETE' }),
  getDevSettings: () => request('/dev/settings'),
  updateDevSettings: (patch) => request('/dev/settings', { method: 'PATCH', body: JSON.stringify(patch) }),

  // ── Server Relay (READ ONLY — see worker/src/routes/relay.ts) ────────────
  // PHASE 4: servers/members/channels list endpoints now take the same
  // optional cursor+limit params as messages/poll already did, and return
  // the shared { items, nextCursor, hasMore } page shape.
  listRelayServers: (cursor) =>
    request(`/relay/servers${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  getRelayServer: (id) => request(`/relay/servers/${id}`),
  listRelayMembers: (serverId, cursor) =>
    request(`/relay/servers/${serverId}/members${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  listRelayChannels: (serverId, cursor) =>
    request(`/relay/servers/${serverId}/channels${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  getRelayChannel: (channelId) => request(`/relay/channels/${channelId}`),
  listRelayChannelMessages: (channelId, cursor) =>
    request(`/relay/channels/${channelId}/messages${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  pollRelayChannel: (channelId, since) =>
    request(`/relay/channels/${channelId}/poll${since ? `?since=${encodeURIComponent(since)}` : ''}`),

  // ── Stats ─────────────────────────────────────────────────────────────────
  summary: () => request('/stats/summary'),
  botRate: (id) => request(`/stats/bots/${id}/rate`),

  // ── Files ─────────────────────────────────────────────────────────────────
  uploadFile: (formData) => upload('/files/upload', formData),
};
