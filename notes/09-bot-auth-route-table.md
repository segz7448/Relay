# Phase 9 — Bot Authentication: Dual Identity Model — Route Table

Every route in the Worker, and which middleware gates it. Built to satisfy
the phase's explicit deliverable: "Write a route table listing every
endpoint and which middleware it uses, and review it for accidental
cross-wiring."

Two identities, two middlewares, never interchangeable:

- **requireUserSession** (`requireAuth` in `middleware/auth.ts`, exported
  under both names as of this phase) — a human's session JWT. Attaches
  `{ userId, sessionId, email, username, name }` to context as `user`.
- **requireBotToken** (`middleware/auth.ts`, new this phase) — a single
  bot's own token. Attaches only `{ botId }` to context as `bot`. Used
  exclusively by `routes/botRuntime.ts`, mounted at `/bot-runtime`.

## routes/auth.ts — `/auth`
| Route | Middleware |
|---|---|
| `POST /login` | public (issues the session JWT) |
| `POST /logout` | public (clears a session by its own token) |
| `POST /rotate` | requireUserSession |

## routes/accounts.ts — `/accounts`
All routes: requireUserSession (`accounts.use('*', requireAuth)`).

## routes/bots.ts — `/bots` (BotManager USER managing their own bots)
All routes: requireUserSession (`bots.use('*', requireAuth)`). Includes
create/get/patch/delete, rotate-token, revoke-token (Phase 8), commands
CRUD, users, analytics, activity, per-user message history/send.

## routes/botRuntime.ts — `/bot-runtime` (the BOT itself) — NEW this phase
All routes: requireBotToken (`botRuntime.use('*', requireBotToken)`).
- `GET /me` — the bot's own profile, scoped by `botId` from the token.
- `GET /commands` — the bot's own enabled commands, scoped by `botId`
  from the token.

Deliberately minimal for this phase — see the file header comment for why
the send/receive pipeline (Phase 14) and command execution (Phase 15)
aren't built out here.

## routes/messages.ts — `/conversations` (the owner's own DM/relay inbox)
All routes: requireUserSession (`messages.use('*', requireAuth)`).

## routes/servers.ts — `/servers`
All routes: requireUserSession (`servers.use('*', requireAuth)`).

## routes/relay.ts — `/relay` (Server Relay, read-only — see Phase 3/5)
All routes: requireUserSession (`relay.use('*', requireAuth)`), plus the
Phase 5 `assertRelayAccess` per-route authorization gate and a KV rate
limiter — both layered on top of, not instead of, requireUserSession.

## routes/other.ts
| Sub-router | Mount | Middleware |
|---|---|---|
| `privacy` | `/privacy` | requireUserSession |
| `calls` | `/calls` | requireUserSession |
| `dev` | `/dev` | requireUserSession |
| `stats` | `/stats` | requireUserSession |
| `files` | `/files` | requireUserSession |
| `webhook` | `/webhook` | public — per-bot token embedded in the URL path (`/webhook/:token`), verified via `verifyBotToken` (Phase 8). This is the inbound delivery target external chat platforms POST to; it is not the bot's own outbound API and is unrelated to requireBotToken/`/bot-runtime`. |

## Cross-wiring review

Checked every route above for the two failure modes the phase calls out:

- **A runtime route mistakenly using requireUserSession** — none found.
  `/bot-runtime/*` is the only surface using requireBotToken, and it uses
  nothing else.
- **A management route mistakenly accepting a bot token** — none found.
  Every `/bots*`, `/conversations*`, `/servers*`, `/relay*`, `/accounts*`,
  `/privacy*`, `/calls*`, `/dev*`, `/stats*`, `/files*` route uses
  requireUserSession only.

One pre-existing, unrelated observation (not a cross-wiring bug, not
touched this phase): `files.get('/:key{.+}')` — the R2 file-read route —
also sits behind requireUserSession. That's an access-control choice, not
an identity mix-up, and is Phase 19 ("Bot Files: R2 Integration")
territory, not Phase 9's.
