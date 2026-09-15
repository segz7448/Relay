// botUserMessagesApi.js — REAL per-bot-user message history.

import { api } from './api';

export async function fetchUserMessages(botId, userId) {
  return api.getBotUserMessages(botId, userId);
}

export async function sendUserMessage(botId, userId, text) {
  // Sending a message back to a bot user (outbound from the admin side).
  // Persists via POST /bots/:id/users/:userId/messages, which also
  // forwards the message to the bot's registered webhook_url, if any.
  return api.sendBotUserMessage(botId, userId, { text });
}
