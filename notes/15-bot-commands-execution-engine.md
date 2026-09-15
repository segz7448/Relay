# Phase 15 — Bot Commands: Execution Engine

## What was already there (built ahead of schedule, essentially complete)
The WIP snapshot this phase started from already contained a real,
working execution engine, not a stub:

- `worker/src/lib/botCommands.ts` — `COMMAND_RE`, `COMMAND_ACTION_TYPES`
  (a fixed, closed set: `Reply with text`, `Send welcome message`,
  `Open menu`, `Trigger webhook`, `No action`), `normalizeCommandName`,
  `DEFAULT_COMMANDS` (`/start`, `/help`), and `executeCommandAction` — a
  plain `switch` over `action_type`. No `eval`, no `Function()`, no
  dynamic code path of any kind. A command's `action_value` is only ever
  used as inert data: literal reply text, or a URL passed to `fetch`.
- `worker/src/lib/botMessagePipeline.ts`'s `processCommandOrLogicOrWebhook`
  already called into it: `bot.allow_commands && text.startsWith('/')` ->
  look up `bot_commands WHERE bot_id = ? AND command = ? AND enabled = 1`
  -> `executeCommandAction`. Not a command (or commands off) falls
  through to the existing webhook-fallback branch, never both.
- `worker/src/routes/bots.ts`'s `POST /bots` already seeded real
  `/start` / `/help` rows for every new bot, and the full command CRUD
  (create/list/get/update/delete/enable/disable) already normalized
  names, enforced the `UNIQUE(bot_id, command)` index, and validated
  `action_type` against the same `COMMAND_ACTION_TYPES` set the
  dispatcher trusts.
- `app/bot/[id]/commands.jsx` / `command-edit.jsx` already rendered the
  list, the enabled/disabled switch, and the action-type/description
  editor — nothing UI-side needed building.

In other words: by spec bullet, "belong to one bot," "unique normalized
names," "descriptions," "enabled/disabled status," "execute their
configured behavior," "respect bot settings," "work through the bot
runtime," "appear correctly in the UI," and "no arbitrary server-side
code execution" were all already real, wired, non-mock implementations
before this phase's work began.

## The actual gap: zero test coverage of the dispatcher itself
`worker/src/routes/__tests__/botSettingsCommands.e2e.test.ts` (Phase 11)
covers command CRUD and the owner-facing `/bot-runtime/commands` read
surface. `worker/src/routes/__tests__/botRuntimeAuth.e2e.test.ts`
(Phase 9) covers the same read surface from the bot-token-auth angle.
Neither, nor anything else in the suite, ever sent a real `/`-prefixed
message through `POST /webhook/:token` and checked that a command
actually fired. The execution engine — the part of the spec this phase
is named for — had no direct test evidence it worked end to end.

## What this phase added
`worker/src/routes/__tests__/botCommandsEngine.e2e.test.ts` — real HTTP,
real D1, real webhook endpoint, no mocks (including the "Trigger
webhook" cases below, which make genuine outbound `fetch()` calls rather
than stubbing `fetch`). Covers, directly against the spec:

1. **Default seeding** — a new bot has real, editable `/start`/`/help`
   rows from creation.
2. **Each of the five behavior types actually executes**, dispatched
   through the real inbound pipeline:
   - `Send welcome message` (`/start`) returns the bot's real configured
     `welcomeMessage`.
   - `Open menu` (`/help`) returns a live-built list of the bot's
     currently *enabled* commands only — a command disabled moments
     earlier in the same test is confirmed absent.
   - `Reply with text` returns exactly the configured static text.
   - `No action` produces no outbound row at all.
   - `Trigger webhook` with no `webhook_url` configured produces no
     reply (nothing fabricated when there's nowhere to call).
   - `Trigger webhook` with a `webhook_url` pointed at
     `http://127.0.0.1:1/...` (nothing listens there) makes a real
     `fetch()`, gets a real connection failure, and produces no
     fabricated reply — exercises `callBotWebhook`'s actual `catch`
     branch, not a simulated one.
3. **Disabled commands never dispatch** — the row exists, the owner can
   see it, but it produces no reply.
4. **Unknown commands never dispatch, and are never mistaken for the
   webhook fallback** — tested against a bot that *does* have a
   `webhook_url` configured, to prove the `isCommand` branch returns
   immediately on a lookup miss rather than falling through.
5. **Case-insensitive, whitespace-terminated matching** — `/GREET World`
   matches a `greet` command and ignores the trailing argument.
6. **"Respect bot settings"** — `allowCommands: false` turns `/`-prefixed
   text back into an ordinary (non-command) message; the raw text is
   confirmed stored as the inbound message rather than being parsed.
7. **"Respect command permissions"** — a blocked bot-user's `/`-message
   never reaches the dispatcher at all; both the inbound row and any
   reply are absent (this enforcement is Phase 12/14's, re-verified here
   because the spec explicitly lists it as a Phase 15 command
   requirement).
8. **Per-bot isolation** — the identical command name (`/offer`) on two
   different bots dispatches two different, bot-specific replies.
9. **Uniqueness re-verified from the dispatcher's side** — creating the
   same normalized name twice on one bot is rejected (`409`), confirming
   the format/dup rules the dispatcher's `SELECT` depends on still hold.
10. **Defensive `default` branch** — a row manually forced (via direct
    D1 write, the only way to reach it — every real write path validates
    against `COMMAND_ACTION_TYPES`) to an unrecognized `action_type`
    produces no reply rather than being interpreted as anything. Confirms
    there is no code path, reachable or not, that treats `action_value`
    as executable.

## Gaps found and fixed this phase
No behavioral bugs were found in the execution engine itself while
writing these tests — the existing implementation held up under all of
the above. This phase's fix was closing the test-coverage gap, not a
runtime bug fix.

## Caveats / what could not be verified in this environment
This sandbox has no outbound network access, so `npm install` could not
run (`npm error 403 ... registry.npmjs.org`), and consequently neither
could `vitest`, `tsc --noEmit`, `eslint`, or `wrangler`. The new test
file was checked for TypeScript syntax validity with a standalone `tsc`
parse pass (no real type errors, only expected "cannot find module"
noise from missing `node_modules`), and every assertion was cross-checked
by hand against the real schema (`worker/src/db/schema.sql`) and the real
pipeline/route code it exercises — but the suite has **not actually been
run**. Before treating this phase as verified, run, inside `worker/`:

```
npm install
npm test
npm run typecheck
```

The one test most worth watching on a first real run is `"Trigger
webhook" makes a real outbound call...` — it depends on
`http://127.0.0.1:1` refusing the connection immediately in whatever
environment `vitest-pool-workers` actually executes `fetch()` in. The
test carries a 15s timeout (`WEBHOOK_TIMEOUT_MS` is 8s) as a buffer, but
if that environment's Workers runtime instance doesn't have loopback
network access at all, the specific failure mode fetch() throws might
differ (though `callBotWebhook`'s `catch` is unconditional, so the
observable outcome — no fabricated reply — should hold regardless).
