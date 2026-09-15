// utils/botInboxFormat.mjs — pure formatters for the Phase 16 webhook
// delivery history and the Phase 17 bot conversation inbox.
//
// These are plain functions (no React, no RN imports) so they can be unit
// tested directly with `node --test` (see utils/__tests__/) and imported
// from the screens. Metro resolves .mjs through @expo/metro-config's
// default sourceExts.

// Telegram-style compact timestamp for list rows: minutes/hours/days,
// falling back to a short date once it's more than a week old.
export function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const min = 60 * 1000, hr = 60 * min, day = 24 * hr;
  if (diff < 0) return 'now';
  if (diff < min) return 'now';
  if (diff < hr) return `${Math.floor(diff / min)}m`;
  if (diff < day) return `${Math.floor(diff / hr)}h`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Preview line for one conversation row. The Worker's
// GET /bots/:id/conversations row carries `lastMessage` as
// { id, text, direction, status } or null; outbound (owner/bot) messages
// get the Telegram-style "You: " prefix. Text can be null on an
// attachment-only message.
export function conversationPreview(conv) {
  const last = conv?.lastMessage;
  if (!last) return 'No messages yet';
  const text = (last.text ?? '').trim() || 'Attachment';
  return last.direction === 'out' ? `You: ${text}` : text;
}

// Unread badge text, or null when the badge should be hidden entirely.
export function unreadBadgeLabel(count) {
  const n = Number(count) || 0;
  if (n <= 0) return null;
  return n > 99 ? '99+' : String(n);
}

// bot_webhook_deliveries.status is 'delivered' | 'failed' | 'exhausted'
// (worker/src/lib/botWebhookDelivery.ts). Map it to the visual kind the
// row uses, defensively passing through anything unexpected as 'pending'.
export function deliveryStatusKind(status) {
  if (status === 'delivered') return 'success';
  if (status === 'failed' || status === 'exhausted') return 'error';
  return 'pending';
}

export function deliveryStatusLabel(status) {
  if (status === 'delivered') return 'Delivered';
  if (status === 'failed') return 'Failed';
  if (status === 'exhausted') return 'Retries exhausted';
  return 'Pending';
}

// One-line meta under a delivery row: "HTTP 200 · 84ms · 3m", with the
// attempt number only shown once a delivery needed a retry.
export function deliveryMeta(d) {
  const parts = [];
  parts.push(d?.responseCode != null ? `HTTP ${d.responseCode}` : 'No response');
  if (d?.latencyMs != null) parts.push(`${d.latencyMs}ms`);
  if ((d?.attempt ?? 1) > 1) parts.push(`attempt ${d.attempt}`);
  parts.push(timeAgo(d?.createdAt));
  return parts.join(' · ');
}
