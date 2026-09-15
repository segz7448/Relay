# Phase 11 — Bot API: Settings & Commands Endpoints

## What was already there (built ahead of schedule, verified working)
Settings columns (`allow_messages`, `allow_files`, `allow_commands`,
`enable_notifications`, `notify_on_message`, `webhook_url`) already existed
on `bots` and were already patchable through the generic `PATCH /bots/:id`
via `PROFILE_FIELD_MAP`. Full command CRUD (`GET/POST /bots/:id/commands`,
`PATCH/DELETE /bots/:id/commands/:cmdId`) already existed, gated by the
same `getBot(db, botId, userId)` ownership check as everything else on
this router.

## Gaps found and fixed this phase

### 1. Cross-bot data leak on `PATCH /bots/:id/commands/:cmdId` (security)
The route's read-back was `SELECT * FROM bot_commands WHERE id = ?` — no
`bot_id` filter. The preceding `UPDATE ... WHERE id = ? AND bot_id = ?`
correctly touched zero rows when `:cmdId` belonged to a different bot
(command ids are globally unique, like every id in this schema), but the
trailing SELECT still found and returned *that other bot's* command —
name, description, action config — to a caller who only owns the bot in
the URL, not the command. Reachable by guessing/enumerating a command id
against any bot you own. Fixed by giving every command route its own
`getCommand(db, botId, cmdId)` helper that filters by `bot_id` too, and
returning 404 when it doesn't match. Regression-tested in
`botSettingsCommands.e2e.test.ts` ("cross-bot isolation" test), including
confirming the target command was untouched afterward.

While fixing this, found and fixed the identical pattern in
`PATCH /bots/:id/users/:userId` (its read-back was also unscoped by
`bot_id`). Full `bot_users` isolation is Phase 17's scope; this was just
closing the one leak spotted while fixing the same bug class here.

### 2. Commands API was returning the wrong case — a real display bug
`GET /:id/commands` (and the commands array embedded in `GET /:id`)
returned raw D1 rows: `action_type`, `action_value` (snake_case). Every
screen that renders a command — `commands.jsx`'s `CommandRow`,
`command-edit.jsx` — reads `item.actionType` / `item.actionValue`
(camelCase). Result: the "Action" line under every command in the list
was rendering `undefined` before this phase. Fixed with a single
`commandShape()` serializer now used by every command route (list, get,
create, patch, enable, disable) and by the embedded array in `GET /:id`,
so there's exactly one place that decides how a command is shaped.

### 3. No uniqueness on command names
Nothing stopped two commands named `/start` on the same bot. That's not
just untidy — Phase 15's runtime dispatcher and the existing
`/bot-runtime/commands` endpoint both key off `command` alone, so a
duplicate would be genuinely ambiguous ("which `/start` fires?"). Added
`CREATE UNIQUE INDEX idx_bot_commands_unique ON bot_commands(bot_id, command)`
to `schema.sql`, plus an explicit pre-check on create and rename that
returns `409 command_taken` with a clear message (belt-and-suspenders:
the DB constraint is the real guarantee, the app-level check is what
gives a good error message instead of a raw constraint-violation).
Confirmed the same name is still fine across two *different* bots owned
by the same user.

**Caveat**: this is a `CREATE UNIQUE INDEX IF NOT EXISTS`, applied by
re-running `schema.sql` (this project's migration mechanism — there's no
separate numbered-migrations folder). If a database already has duplicate
`(bot_id, command)` rows from before this index existed, that statement
will fail until they're deduped. Nothing in this codebase could have
created such a duplicate before this phase (there was no uniqueness check
at all), so a fresh dev/staging D1 is unaffected either way, but this is
called out explicitly per the "verify database migrations" checklist item.

### 4. No server-side format/action-type validation on commands
Command names were only validated client-side (`command-edit.jsx`'s
regex). Added the same regex server-side (`COMMAND_RE`), applied on both
create and rename. Also added `COMMAND_ACTION_TYPES`, a fixed set mirrored
from `ACTION_TYPES` in `botsApi.js` — the spec calls this "command
behavior" and describes it as interpreted by a fixed set of behavior
types; nothing before this phase stopped `actionType: "anything at all"`
from being stored, even though `/bot-runtime/commands` and the future
runtime dispatcher (Phase 15) only know how to interpret five specific
values. There's no shared module between the Worker bundle and the Expo
bundle in this project's layout, so the list is intentionally duplicated
with a comment flagging that fact rather than imported.

### 5. Missing endpoints the spec calls out by name
The spec's Commands list is: Create, List, Get, Update, Delete, Enable,
Disable. "Get command" and "Enable/Disable command" didn't exist as their
own endpoints:
- Added `GET /bots/:id/commands/:cmdId` — mirrors the bot-level "Get bot"
  vs "List bots" distinction, and lets `command-edit.jsx` fetch exactly
  the row it's editing instead of loading the whole bot and filtering an
  array client-side.
- Added `POST /bots/:id/commands/:cmdId/enable` and `.../disable` — same
  precedent Phase 10 set for bot-level enable/disable (dedicated actions,
  not folded into the generic PATCH). Also incidentally removes a small
  client-side race: the old `toggleCommandEnabled` fetched the whole
  command list, found the one being toggled, then PATCHed the opposite of
  whatever it currently said — two round trips with a window for the
  second to act on stale data. `setCommandEnabled(botId, cmdId, enabled)`
  now takes the target state directly (the caller — `CommandRow` — always
  has the current item on screen) and calls the dedicated endpoint.

### 6. "Webhook settings" had zero UI anywhere
`webhook_url` was a real column, already patchable via the generic PATCH,
already used for outbound delivery (`bots.ts`'s
`POST /:id/users/:userId/messages` route already POSTs to it). But no
screen — not `create-bot.jsx`, not `edit.jsx`, not `settings.jsx` — ever
read or wrote it. The spec explicitly lists "Webhook settings" as a bot
setting, so this was a real gap, not a future-phase item: it's a setting,
this is the settings phase. Added a "Webhook" section to
`app/bot/[id]/settings.jsx` (URL field + explicit Save button, since a
URL is easy to leave half-typed mid-edit unlike the instant-save toggles).
Also added server-side format validation (`isValidWebhookUrl`, http/https
only) on both create and patch — previously any string was accepted and
would just fail silently on first delivery attempt.

### 7. "Notifications" setting was only half-exposed
`notify_on_message` existed as a column and in `PROFILE_FIELD_MAP` from
Phase 10, but no screen surfaced it — only `enable_notifications` had a
toggle. Added a second, dependent toggle ("Notify on every message",
disabled unless notifications are enabled at all) to `settings.jsx`, so
the spec's "Notifications" bullet is actually reachable in its more
granular form, not just the top-level on/off.

### 8. "Allow commands" setting existed but wasn't enforced anywhere
The owner could switch "Allow commands" off in Settings, and
`GET /bot-runtime/commands` would keep returning the full command list
regardless — the flag was surfaced to the bot via `/bot-runtime/me` as
information, but nothing server-side actually gated on it. Fixed:
`/bot-runtime/commands` now checks `allow_commands` itself and returns
`[]` when it's off, rather than trusting a runtime integration to check
`/me` first and honor the flag voluntarily. (`allow_messages` /
`allow_files` enforcement is out of scope here — those gate the message
pipeline and file transfer, which are Phase 14 and Phase 19's territory
respectively — this fix is specifically about the one setting this
phase's own new/changed endpoint touches.)

## Deliberate non-changes
- Did not build out webhook delivery signing/retries/HMAC — that's
  explicitly Phase 16 ("Bot Webhook System"). This phase only adds the
  *setting* (URL, validated shape, visible in the UI) that Phase 16 will
  build the full delivery system against.
- Did not touch `bot_users` beyond the one incidental read-back fix in
  item 1 — full isolation work there is Phase 17's scope.

## Tests added
`worker/src/routes/__tests__/botSettingsCommands.e2e.test.ts` — real
HTTP, real D1, same harness as the other `*.e2e.test.ts` files in this
project (no mocks). Covers: every documented bot setting via PATCH;
webhook URL validation (create, patch, and clearing with an empty
string); `allow_commands` enforcement on `/bot-runtime/commands`; command
CRUD round-trip with camelCase-shape regression check; command name/
action-type validation; duplicate command name rejection on create and
rename (plus same-name-across-different-bots is allowed); enable/disable
as dedicated actions; and the cross-bot isolation regression from item 1
above (get/patch/enable/disable/delete all 404 against another owner's
command, and the target command is confirmed untouched afterward).

## Not run in this environment
This sandbox's network egress is disabled (`npm install` returns
`403 Forbidden` against the registry), so `npm run test` / `typecheck` /
`db:migrate` could not actually be executed here. Everything above was
written and manually re-read against the existing patterns in this
codebase (Hono route shapes, the D1 types, the vitest-pool-workers e2e
style already used by `botManagementProfile.e2e.test.ts` and
`botRuntimeAuth.e2e.test.ts`), but has not been machine-verified. Please
run `npm test`, `npm run typecheck`, and apply `schema.sql` to a
disposable D1 before treating this as done — flagging this explicitly per
the "do not report something as complete if it is only partially
implemented / verified" rule.
