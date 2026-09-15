// botUserMessagesApi.js — REAL per-bot-user message history.

import { api } from './api';

export async function fetchUserMessages(botId, userId) {
  return api.getBotUserMessages(botId, userId);
}

// Sending a message back to a bot user (outbound from the admin side).
// Persists via POST /bots/:id/users/:userId/messages, which also
// forwards the message to the bot's registered webhook_url, if any.
//
// Accepts either a plain text string or a full body:
//   { text?, attachmentUrl?, attachmentType? }
// The Worker requires at least one of text/attachmentUrl (its own
// `empty_message` 400 otherwise) — mirrored here so an empty send fails
// before it ever hits the network.
export async function sendUserMessage(botId, userId, input) {
  const body = typeof input === 'string' ? { text: input } : { ...input };
  if (!body.text && !body.attachmentUrl) throw new Error('empty_message');
  return api.sendBotUserMessage(botId, userId, body);
}
