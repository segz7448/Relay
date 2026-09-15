// devPlatformStore.js — REAL developer platform data.
// Same exported constants and async function signatures as the original.

import { api } from './api';

// ── Constants (unchanged — used by UI pickers) ────────────────────────────────

export const SCOPES = ['Full access', 'Read only', 'Bots only'];

export const SCOPE_HELP = {
  'Full access': 'Create, edit, and delete bots, read and write messages, manage webhooks.',
  'Read only': 'Can read bots, stats, and message history — no create, edit, or delete.',
  'Bots only': 'Limited to bot CRUD and command management — no account or billing access.',
};

export const EVENT_TYPES = [
  'message.received',
  'message.sent',
  'bot.created',
  'bot.deleted',
  'user.blocked',
  'command.triggered',
  'delivery.failed',
];

// Re-exported for the Bot Tokens screen (which imports from this file)
export { fetchBots as fetchBotTokens } from './botsApi';

// ── API Keys ──────────────────────────────────────────────────────────────────

export async function fetchApiKeys() {
  return api.listApiKeys();
}

export async function createApiKey({ name, scope }) {
  return api.createApiKey({ name, scope });
}

export async function revokeApiKey(id) {
  await api.revokeApiKey(id);
  return fetchApiKeys();
}

// ── Webhooks ──────────────────────────────────────────────────────────────────

export async function fetchWebhooks() {
  return api.listWebhooks();
}

export async function fetchWebhook(id) {
  return api.getWebhook(id);
}

export async function fetchDeliveries(id) {
  return api.listWebhookDeliveries(id);
}

export async function createWebhook({ url, description, events }) {
  return api.createWebhook({ url, description, events });
}

export async function updateWebhook(id, patch) {
  return api.updateWebhook(id, patch);
}

export async function toggleWebhookEnabled(id) {
  return api.toggleWebhook(id);
}

export async function regenerateWebhookSecret(id) {
  const { secret } = await api.rotateWebhookSecret(id);
  return { secret };
}

export async function sendTestEvent(id, event) {
  return api.sendWebhookTest(id, event);
}

export async function rotateWebhookSecret(id) {
  return api.rotateWebhookSecret(id);
}

export async function deleteWebhook(id) {
  await api.deleteWebhook(id);
  return fetchWebhooks();
}

// ── Dev settings (IP allowlist, signing/sandbox/logging/beta toggles) ────────

export async function fetchDevSettings() {
  return api.getDevSettings();
}

export async function updateDevSettings(patch) {
  return api.updateDevSettings(patch);
}
