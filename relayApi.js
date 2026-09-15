// relayApi.js — Server Relay client. READ ONLY.
//
// This file intentionally has no create/update/delete functions. The
// Server Relay is a read-only view onto servers/channels/members/messages
// — see worker/src/routes/relay.ts for the backend enforcement of that.
// If you need to create a server, edit a channel, kick a member, etc.,
// that is a different feature (see serversApi.js) and does not belong
// on the Server Relay screen.

import { api } from './api';

// Paginated: returns { items, nextCursor, hasMore }. First call omits
// `cursor`; pass the previous response's `nextCursor` for the next page.
export async function fetchRelayServers(cursor) {
  return api.listRelayServers(cursor);
}

export async function fetchRelayServer(id) {
  return api.getRelayServer(id);
}

// Paginated: returns { items, nextCursor, hasMore }.
export async function fetchRelayMembers(serverId, cursor) {
  return api.listRelayMembers(serverId, cursor);
}

// Paginated: returns { items, nextCursor, hasMore }.
export async function fetchRelayChannels(serverId, cursor) {
  return api.listRelayChannels(serverId, cursor);
}

export async function fetchRelayChannel(channelId) {
  return api.getRelayChannel(channelId);
}

// Paginated message history. First call omits `cursor`; pass the previous
// response's `nextCursor` to load the next (older) page. Returns
// { items, nextCursor, hasMore }.
export async function fetchRelayChannelMessages(channelId, cursor) {
  return api.listRelayChannelMessages(channelId, cursor);
}

// Poll for new messages since a cursor (e.g. the last message's own cursor
// value — see nextCursor on poll/message responses). Returns
// { items, nextCursor }. Safe to call repeatedly; never returns a message
// already returned by a previous call with the resulting nextCursor.
export async function pollRelayChannel(channelId, sinceCursor) {
  return api.pollRelayChannel(channelId, sinceCursor);
}
