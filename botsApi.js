// botsApi.js — REAL bot data. Same exports/shapes as the original mock.
// All reads/writes go to the Cloudflare Worker via api.js.

import { api } from './api';
import { addConversation, removeConversation, patchConversation } from './messagesApi';

// These constants are used by the UI — keep them here.
export const CATEGORIES = [
  'Productivity', 'Commerce', 'Support', 'Finance',
  'Games', 'Social', 'News', 'Utilities', 'Other',
];

export const ACTION_TYPES = [
  'Reply with text',
  'Send welcome message',
  'Open menu',
  'Trigger webhook',
  'No action',
];

// ── Bots CRUD ────────────────────────────────────────────────────────────────

export async function fetchBots() {
  const bots = await api.listBots();
  return bots;
}

export async function getBot(id) {
  return api.getBot(id);
}

// Composite fetch used by the bot detail screens — the bot record plus its
// commands and users, all merged into one object (matches the original
// mock's shape of a bot carrying its own `commands`/`users` arrays).
export async function fetchBot(id) {
  const [bot, commands, users] = await Promise.all([
    api.getBot(id),
    api.listCommands(id).catch(() => []),
    api.listBotUsers(id).catch(() => []),
  ]);
  if (!bot) return null;
  return { ...bot, commands, users };
}

export async function createBot({
  name, username, description, category, avatarColor, welcomeMessage, profileImage,
  enableBot, allowMessages, allowFiles, allowCommands, enableNotifications,
}) {
  // Worker returns the new bot's fields flattened together with the
  // one-time-shown raw token: { ...botFields, token }. Split that apart
  // here so callers get the { bot, token } shape they actually expect —
  // app/create-bot.jsx's success screen destructures `{ bot, token }` off
  // this function's return value and reads `result.bot.name` etc, which
  // was crashing (`bot` was undefined) before this split existed.
  const { token, ...bot } = await api.createBot({
    name, username, description, category, avatarColor, welcomeMessage, profileImage,
    enableBot, allowMessages, allowFiles, allowCommands, enableNotifications,
  });
  // Mirror into the conversations/messages tab as a new bot conversation
  await addConversation({
    id: bot.id,
    kind: 'bot',
    name: bot.name,
    avatarColor: bot.avatarColor,
    lastMessage: '',
    lastMessageAt: Date.now(),
    unread: 0,
    pinned: false,
    muted: false,
    online: false,
    typing: false,
    attachment: null,
  });
  return { bot, token };
}

export async function updateBot(id, patch) {
  const bot = await api.updateBot(id, patch);
  // Keep conversation name/color in sync
  const updates = {};
  if (patch.name) updates.name = patch.name;
  if (patch.avatarColor) updates.avatarColor = patch.avatarColor;
  if (Object.keys(updates).length) await patchConversation(id, updates);
  return bot;
}

export async function setBotEnabled(id, enabled) {
  // PHASE 10 — dedicated enable/disable endpoints rather than a generic
  // PATCH { enabled }, so disabling also clears bot status server-side
  // (see worker/src/routes/bots.ts).
  await (enabled ? api.enableBot(id) : api.disableBot(id));
  return fetchBot(id);
}

export async function deleteBot(id) {
  await api.deleteBot(id);
  await removeConversation(id);
}

// Returns just the new raw token string, shown/copyable once. (The Worker
// response is { token, tokenPrefix } — unwrapped here so callers get the
// same "plain string" shape they'd expect from a token, not an object.)
export async function rotateBotToken(id) {
  const res = await api.rotateBotToken(id);
  return res.token;
}

export async function revokeBotToken(id) {
  await api.revokeBotToken(id);
  return fetchBot(id);
}

// ── Commands ─────────────────────────────────────────────────────────────────

export async function fetchCommands(botId) {
  return api.listCommands(botId);
}

// PHASE 11 — dedicated single-command fetch (the API's "Get command"),
// used by the command-edit screen instead of loading the whole bot and
// searching its commands array client-side.
export async function fetchCommand(botId, cmdId) {
  return api.getCommand(botId, cmdId);
}

export async function createCommand(botId, body) {
  return api.createCommand(botId, body);
}

// Alias used by the command editor screen
export async function addCommand(botId, body) {
  return api.createCommand(botId, body);
}

export async function updateCommand(botId, cmdId, body) {
  return api.updateCommand(botId, cmdId, body);
}

export async function deleteCommand(botId, cmdId) {
  await api.deleteCommand(botId, cmdId);
}

// Alias that also hands back the refreshed bot (commands list included) —
// used by screens that re-render straight from the returned bot.
export async function removeCommand(botId, cmdId) {
  await api.deleteCommand(botId, cmdId);
  return fetchBot(botId);
}

// PHASE 11 — takes the target state directly and calls the dedicated
// enable/disable endpoint, rather than re-fetching the whole command list
// just to read back the one boolean the caller already has on-screen.
// (The caller — commands.jsx's CommandRow — always has the current item
// in hand, so it can pass `!item.enabled` straight through.)
export async function setCommandEnabled(botId, cmdId, enabled) {
  await (enabled ? api.enableCommand(botId, cmdId) : api.disableCommand(botId, cmdId));
  return fetchBot(botId);
}

// ── Bot users ─────────────────────────────────────────────────────────────────

export async function fetchBotUsers(botId) {
  return api.listBotUsers(botId);
}

// PHASE 12 — calls the Worker's dedicated GET /bots/:id/users/:userId
// directly instead of fetching the whole user list and filtering
// client-side (that was this function's entire previous body). Preserves
// the old "not found -> null" contract: the Worker 404s with
// { error: 'not_found' }, which api.js's request() turns into a thrown
// Error whose message is exactly that string — caught and translated back
// to null here. Any other failure (network, auth, 5xx) still propagates,
// same as before.
export async function fetchBotUser(botId, userId) {
  try {
    return await api.getBotUser(botId, userId);
  } catch (e) {
    if (e.message === 'not_found') return null;
    throw e;
  }
}

export async function updateBotUser(botId, userId, patch) {
  return api.updateBotUser(botId, userId, patch);
}

// PHASE 12 — dedicated actions, same precedent Phase 11 set for
// setCommandEnabled: take the target state directly rather than
// re-fetching the current value and PATCHing its opposite. The old
// toggleUserBlocked/toggleUserMuted (removed) did exactly that "fetch,
// then PATCH the opposite of whatever it said" — a real race: two callers
// (e.g. two devices) toggling around the same time can step on each
// other, with the second write silently landing on stale data. The
// Worker's dedicated /block /unblock /mute /unmute routes
// (worker/src/routes/bots.ts) were built in Phase 12 specifically to
// remove that race; this is the client finally calling them. Returns just
// the one updated bot-user record (not the whole bot) — callers merge it
// into whatever list/detail state they're holding.
export async function setBotUserBlocked(botId, userId, blocked) {
  return blocked ? api.blockBotUser(botId, userId) : api.unblockBotUser(botId, userId);
}

export async function setBotUserMuted(botId, userId, muted) {
  return muted ? api.muteBotUser(botId, userId) : api.unmuteBotUser(botId, userId);
}

export async function removeBotUser(botId, userId) {
  await api.deleteBotUser(botId, userId);
  return fetchBot(botId);
}

// ── Analytics / activity ──────────────────────────────────────────────────────

export async function fetchBotAnalytics(botId) {
  return api.getBotAnalytics(botId);
}

// PHASE 13 — per-day time series for the analytics chart. `days` optional,
// server defaults to 7.
export async function fetchBotAnalyticsDaily(botId, days) {
  return api.getBotAnalyticsDaily(botId, days);
}

export async function fetchBotActivity(botId) {
  return api.getBotActivity(botId);
}

// Phases 16-20 production surfaces.
export const fetchBotConversations = (botId) => api.listBotConversations(botId);
export const fetchBotFiles = (botId) => api.listBotFiles(botId);
export async function uploadBotFile(botId, asset, botUserId) {
  const form = new FormData();
  form.append('file', { uri: asset.uri, name: asset.name, type: asset.mime || 'application/octet-stream' });
  if (botUserId) form.append('botUserId', botUserId);
  return api.uploadBotFile(botId, form);
}
export const removeBotFile = (botId, fileId) => api.deleteBotFile(botId, fileId);
export const fetchBotWebhook = (botId) => api.getBotWebhook(botId);
export const configureBotWebhook = (botId, url) => api.configureBotWebhook(botId, { url });
export const updateBotWebhook = (botId, url) => api.updateBotWebhook(botId, { url });
export const setBotWebhookEnabled = (botId, enabled) => enabled ? api.enableBotWebhook(botId) : api.disableBotWebhook(botId);
export const rotateBotWebhookSecret = (botId) => api.rotateBotWebhookSecret(botId);
export const testBotWebhook = (botId) => api.testBotWebhook(botId);
export const fetchBotWebhookDeliveries = (botId) => api.listBotWebhookDeliveries(botId);
