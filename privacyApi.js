// privacyApi.js — REAL privacy data. Same exports as the original mock.

import { api } from './api';
import { fetchConversations } from './messagesApi';

// ── Blocked users ─────────────────────────────────────────────────────────────

export async function fetchBlockedUsers() {
  return api.listBlocked();
}

export async function blockUser(user) {
  await api.blockUser({ id: user.id, name: user.name, username: user.username });
  return fetchBlockedUsers();
}

export async function unblockUser(id) {
  await api.unblockUser(id);
  return fetchBlockedUsers();
}

// Search the account directory. Results contain public profile fields only.
export async function searchDirectory(query) {
  return api.searchUsers(query);
}

export async function fetchDirectoryUser(id) {
  return api.getUser(id);
}

// ── Sessions ──────────────────────────────────────────────────────────────────

function sessionToActivity(s) {
  return {
    id: s.id,
    device: s.device_name ?? s.deviceName ?? 'Unknown Device',
    app: [s.platform, s.app_version ?? s.appVersion].filter(Boolean).join(' ') || 'botmanager',
    location: 'Unknown location', // no IP geolocation service wired up
    ip: s.device_ip ?? s.deviceIp ?? 'Unknown IP',
    lastActive: s.last_active_at ?? s.lastActiveAt,
    current: s.current ?? false,
    flagged: false, // no anomaly-detection signal available yet
  };
}

export async function fetchSessions() {
  const sessions = await api.listSessions();
  return (sessions ?? []).map(sessionToActivity);
}

export async function terminateSession(id) {
  await api.deleteSession(id);
  return fetchSessions();
}

export async function terminateAllOtherSessions() {
  await api.deleteAllOtherSessions();
  return fetchSessions();
}

// Ends every session, including the current one (full sign-out everywhere).
export async function terminateAllSessions() {
  await api.logoutAllDevices();
}

// ── Devices ───────────────────────────────────────────────────────────────────
// Devices === sessions in this implementation — each login creates a session
// row that also represents "the device it was signed in from".

export async function fetchDevices() {
  const sessions = await api.listSessions();
  return (sessions ?? []).map((s) => ({
    id: s.id,
    name: s.device_name ?? 'Unknown Device',
    platform: s.platform ?? 'unknown',
    current: s.current ?? false,
    lastSynced: s.last_active_at,
    addedAt: s.created_at,
    pushEnabled: !!(s.push_enabled ?? true),
  }));
}

export async function removeDevice(id) {
  await api.deleteSession(id);
  return fetchDevices();
}

export async function setDevicePush(id, enabled) {
  await api.updateSession(id, { pushEnabled: enabled });
  return fetchDevices();
}

// ── Login activity ─────────────────────────────────────────────────────────────
// There's no separate login_attempts table (no failed-attempt tracking yet),
// so every entry here is a session that was actually created — i.e. a
// successful sign-in.
export async function fetchLoginActivity() {
  const sessions = await api.listSessions();
  return (sessions ?? []).map((s) => ({
    id: s.id,
    device: s.device_name ?? 'Unknown Device',
    location: 'Unknown location',
    ip: s.device_ip ?? 'Unknown IP',
    at: s.created_at,
    status: 'success',
  }));
}

// ── Privacy settings ──────────────────────────────────────────────────────────

export async function fetchPrivacySettings() {
  return api.getPrivacySettings();
}

export async function updatePrivacySettings(patch) {
  await api.updatePrivacySettings(patch);
  return fetchPrivacySettings();
}
