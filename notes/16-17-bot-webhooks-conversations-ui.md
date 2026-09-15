# Phases 16-17 — Bot Webhooks & Conversations: Frontend Wiring

The Phase 16 webhook backend (worker/src/routes/bots.ts "PHASE 16") and the
Phase 17 conversation endpoints shipped complete and tested, and botsApi.js
already wrapped every one of them — but no screen imported those wrappers.
This pass wires the whole surface for real.

## What the audit found (all confirmed unused before this pass)

- `configureBotWebhook`, `updateBotWebhook`, `setBotWebhookEnabled`,
  `rotateBotWebhookSecret`, `testBotWebhook`, `fetchBotWebhookDeliveries`,
  `fetchBotConversations` — exported by botsApi.js, imported nowhere.
- `app/bot/[id]/settings.jsx` edited `webhookUrl` through the generic
  `PATCH /bots/:id`, which writes only the pipeline's mirror column — no
  enable/disable, no secret rotation, no test, no delivery history.
- `app/bot/[id]/users.jsx` listed raw bot users; nothing consumed the
  conversation-style `GET /bots/:id/conversations` (unread counts,
  last-message-per-user).

## What was wired

### Bot webhook management — `app/bot/[id]/webhook.jsx` (new)
- Configure (`POST /bots/:id/webhook`) from a dedicated empty state; the
  one-time raw signing secret is shown in a reveal modal and never stored
  beyond that modal's local state.
- Read (`GET .../webhook`) into a status card (enabled state, last delivery
  status/code/time). `404 not_configured` is a real state, not an error.
- Edit URL (`PATCH .../webhook`) with the server's validation message
  surfaced inline.
- Enable/disable (`POST .../webhook/enable|disable`) with optimistic toggle
  and rollback on failure.
- Rotate secret (`POST .../webhook/rotate-secret`) behind a destructive
  confirm; new secret revealed once, prefix row updated.
- Test (`POST .../webhook/test`) with the real awaited result toasted
  (HTTP code + latency, success or failure).
- Delete (`DELETE .../webhook`) behind a destructive confirm, returning the
  screen to the not-configured state.

### Webhook delivery history — `app/bot/[id]/webhook-deliveries.jsx` (new)
- `GET .../webhook/deliveries` (newest 50) with skeleton loading,
  error-with-retry, unconfigured, and empty states, pull-to-refresh, and
  client-side paging (20 at a time, "Load more" / onEndReached) because the
  route has no cursor yet.
- Rows show event type, status icon/label, HTTP code, latency, retry
  attempt, and relative time via utils/botInboxFormat.mjs.

### Bot conversation inbox — `app/bot/[id]/conversations.jsx` (new)
- `GET /bots/:id/conversations` rendered Telegram-style: avatar, name,
  muted/blocked markers, last-message preview (`You: ` prefix on outbound),
  relative time, unread badge (99+ capped), search, pull-to-refresh,
  loading/error/empty states.
- Tap opens the existing thread screen; long-press keeps user management
  (open, profile, mute, block) one gesture away.
- `app/bot/[id]/user/[userId]/history.jsx` now reads through
  `GET /bots/:id/conversations/:userId/messages` (via the new
  `fetchBotConversationMessages` wrapper), so opening a thread from the
  inbox clears its unread counter server-side.

### Rewires of existing screens
- `app/bot/[id]/index.jsx`: new "Conversations" row with live unread total.
- `app/bot/[id]/settings.jsx`: the generic webhook field is replaced by a
  row showing the real configured state (Enabled / Paused / Not set up)
  that opens the webhook screen. The generic `PATCH { webhookUrl }` column
  write is no longer used by any UI.
- `app/_layout.jsx`: the three new screens are registered with titles.

## Route-to-UI coverage (scripts/check-api-parity.mjs)

The parity check now runs both directions: every frontend client call must
resolve to a registered Worker route (as before), AND every Worker route
must either have a frontend caller or be allowlisted with a documented
reason. Current allowlist (all intentionally non-UI): the public inbound
`POST /webhook/:token` receiver, the bot-token `/bot-runtime/*` endpoints,
both file-download routes (streamed via utils/attachments.js with auth
headers, not api.js), the Phase 6 private-channel membership API
(managed outside the app UI — see notes/06), and the legacy
`/dev/relay` relay-group API (no app surface consumes relay groups).

## Tests added

- `worker/src/routes/__tests__/botWebhook.e2e.test.ts`: real awaited test
  delivery, delivery-history recording + newest-first ordering, and the
  webhook summary's last-delivery fields.
- `utils/__tests__/botInboxFormat.test.mjs` (`npm run test:ui`): unit
  coverage for preview/unread/status/meta formatters against the Worker
  response contract.

## Deliberate non-changes

- The backend `PATCH /bots/:id { webhookUrl }` mirror-column write stays
  for API compatibility (Phase 11) but is unused by the UI; the dedicated
  webhook routes are the single management path.
- `GET /bots/:id/users*` endpoints remain fully wired through the Users
  screen — the inbox augments, not replaces, user management.
