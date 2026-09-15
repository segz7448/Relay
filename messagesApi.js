// messagesApi.js — REAL conversation + message data.
// Same exports/shapes as the original mock.

import { api } from './api';

export async function fetchConversations() { return api.listConversations(); }
export async function fetchConversation(id) { return api.getConversation(id); }
export async function fetchMessages(conversationId, { limit = 50, before } = {}) {
  const params = { limit: String(limit) };
  if (before) params.before = String(before);
  const res = await api.listMessages(conversationId, params);
  return res?.messages ?? [];
}
export async function sendMessage(conversationId, body) { return api.sendMessage(conversationId, body); }
export async function markConversationRead(id) { return api.updateConversation(id, { unreadCount: 0 }); }
export async function pinConversation(id, pinned) { return api.updateConversation(id, { pinned }); }
export async function muteConversation(id, muted) { return api.updateConversation(id, { muted }); }
export async function deleteConversation(id) { return api.deleteConversation(id); }
export async function addConversation(conv) {
  return api.createConversation({ kind: conv.kind, name: conv.name, avatarColor: conv.avatarColor, bio: conv.bio ?? '', refId: conv.id });
}
export async function removeConversation(id) { return api.deleteConversation(id); }
export async function patchConversation(id, patch) { return api.updateConversation(id, patch); }
export async function reactToMessage(convId, msgId, emoji) { return api.reactToMessage(convId, msgId, emoji); }

// ── Search ───────────────────────────────────────────────────────────────────

export async function searchMessages(query) {
  try {
    const res = await api.searchConversations(query);
    return res?.messages ?? [];
  } catch (error) {
    throw error;
  }
}

export async function searchFiles(query, kinds = []) {
  try {
    const res = await api.searchConversations(query, kinds);
    return res?.files ?? [];
  } catch (error) {
    throw error;
  }
}

// There's no public cross-account directory to browse (accounts are
// provisioned directly in D1 by the app owner — there's no social graph
// to search). "Usernames" search is scoped to people you already have a
// direct conversation with, matched against their name. (Implemented in
// privacyApi.js — searchDirectory — since that's where every screen
// imports it from; startDirectConversation lives here since it operates
// on conversations.)
export function startDirectConversation(user) {
  // `user` here comes from searchDirectory() and is always an existing
  // conversation, so "starting" it is just handing back its id.
  return user.id;
}

// ── Forwarding ───────────────────────────────────────────────────────────────

export async function forwardMessage(message, targetIds, originName) {
  const prefix = originName ? `Forwarded from ${originName}:\n` : '';
  await Promise.all(targetIds.map((targetId) =>
    api.sendMessage(targetId, {
      text: message.text ? `${prefix}${message.text}` : (prefix || undefined),
      kind: message.kind,
      attachmentUrl: message.attachmentUrl,
      attachmentType: message.attachmentType,
      attachmentName: message.attachmentName,
      attachmentSize: message.attachmentSize,
      durationSec: message.durationSec,
    })
  ));
}

