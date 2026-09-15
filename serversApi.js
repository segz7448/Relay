// serversApi.js — REAL server-relay data. Same exported constants and
// async function signatures as the original mock, all wired to the Worker.

import { api } from './api';

// ── Constants (unchanged — used by the UI for channel type pickers etc.) ──────

export const PERMISSION_KEYS = [
  { key: 'readMessages', label: 'Read messages' },
  { key: 'sendMessages', label: 'Send messages' },
  { key: 'manageChannels', label: 'Manage channels' },
  { key: 'manageMembers', label: 'Manage members' },
  { key: 'administrator', label: 'Administrator' },
];

export const CHANNEL_TYPES = [
  { key: 'general', label: 'General', icon: 'home-outline', prefix: '#', postAccess: 'everyone', description: 'Open, unstructured discussion for the whole server.' },
  { key: 'text', label: 'Text', icon: 'chatbubble-outline', prefix: '#', postAccess: 'everyone', description: 'A standard channel for messages and threads.' },
  { key: 'media', label: 'Media', icon: 'image-outline', prefix: '#', postAccess: 'everyone', description: 'Built for sharing photos, video, and voice notes.' },
  { key: 'files', label: 'Files', icon: 'folder-outline', prefix: '#', postAccess: 'everyone', description: 'A shared drop for documents and other attachments.' },
  { key: 'announcement', label: 'Announcements', icon: 'megaphone-outline', prefix: '#', postAccess: 'admins_only', description: 'Everyone can read; only admins can post.' },
  { key: 'bot', label: 'Bot channel', icon: 'hardware-chip-outline', prefix: '#', postAccess: 'bot_only', description: 'A dedicated feed a single bot posts updates into.' },
];

export const POST_ACCESS_OPTIONS = [
  { key: 'everyone', label: 'Everyone' },
  { key: 'admins_only', label: 'Admins only' },
  { key: 'bot_only', label: 'Bot only' },
];

export const NOTIFICATION_LEVELS = [
  { key: 'all', label: 'All messages', icon: 'notifications-outline' },
  { key: 'mentions', label: 'Mentions only', icon: 'at-outline' },
  { key: 'muted', label: 'Muted', icon: 'notifications-off-outline' },
];

// ── Server CRUD ───────────────────────────────────────────────────────────────

export async function fetchServers() {
  return api.listServers();
}

export async function getServer(id) {
  return api.getServer(id);
}

export async function createServer({ name, description, iconColor, privacy }) {
  return api.createServer({ name, description, iconColor, privacy });
}

export async function updateServer(id, patch) {
  return api.updateServer(id, patch);
}

export async function toggleServerMuted(id) {
  const server = await api.getServer(id);
  return api.updateServer(id, { muted: !server.muted });
}

export async function markServerRead(id) {
  return api.updateServer(id, { unreadCount: 0 });
}

// This account is always the owner of every server it can see (the app is
// single-owner — see servers.ts), so there's no separate membership to
// step down from: leaving is the same as deleting the server.
export async function leaveServer(id) {
  await api.deleteServer(id);
}

export async function deleteServer(id) {
  await api.deleteServer(id);
}

// ── Channels ──────────────────────────────────────────────────────────────────

export async function createChannel(serverId, body) {
  return api.createChannel(serverId, body);
}

export async function updateChannel(serverId, chId, body) {
  return api.updateChannel(serverId, chId, body);
}

export async function deleteChannel(serverId, chId) {
  await api.deleteChannel(serverId, chId);
}

// ── Channel messages ──────────────────────────────────────────────────────────

export async function fetchChannelMessages(serverId, channelId, limit = 50) {
  return api.listChannelMessages(serverId, channelId, limit);
}

export async function sendChannelMessage(serverId, channelId, text) {
  return api.sendChannelMessage(serverId, channelId, { text });
}

// ── Members ───────────────────────────────────────────────────────────────────

export async function fetchMembers(serverId) {
  return api.listMembers(serverId);
}

export async function updateMemberRole(serverId, memberId, role) {
  return api.updateMember(serverId, memberId, { role });
}

export async function updateMemberPermissions(serverId, memberId, permissions) {
  return api.updateMember(serverId, memberId, { permissions });
}

export async function kickMember(serverId, memberId) {
  await api.kickMember(serverId, memberId);
}

