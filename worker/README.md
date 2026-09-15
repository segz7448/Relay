# BotManager — Cloudflare Backend

The `worker/` folder is the complete production backend: a Cloudflare Worker
with D1 (SQLite), R2 (file storage), KV (rate-limits), and FCM push
notifications.

There is no self-service sign-up. This is a single-owner app — you create
each user row directly in the D1 `users` table (see below); the app only
ever exposes a login screen.

---

## One-time setup

### 1 — Install Wrangler
```bash
cd worker
npm install
```

### 2 — Create Cloudflare resources

```bash
# D1 database
npx wrangler d1 create botmanager-db
# → copy the database_id into wrangler.toml

# KV namespace
npx wrangler kv:namespace create BOTMANAGER_KV
# → copy the id into wrangler.toml

# R2 bucket
npx wrangler r2 bucket create botmanager-files
```

### 3 — Apply the database schema

```bash
# Local (dev)
npm run db:migrate

# Remote (production)
npm run db:migrate:remote
```

### 4 — Secrets: GitHub Actions only — never in the repo

**Every credential this backend needs is a GitHub Actions secret.** None of
them are ever written into `wrangler.toml`, `.env`, or any other file that
gets committed. `.github/workflows/deploy-worker.yml` reads these on every
push to `main` and pushes the runtime ones into the Worker for you via
`wrangler secret put` — you never touch them by hand for production.

Set these at **GitHub → your repo → Settings → Secrets and variables →
Actions → New repository secret**:

| Secret name | What it is | Where to get it |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Authenticates Wrangler/CI against your Cloudflare account so it's allowed to deploy | Cloudflare dashboard → My Profile → API Tokens → Create Token (Edit Cloudflare Workers template) |
| `CLOUDFLARE_ACCOUNT_ID` | Which Cloudflare account to deploy into | Cloudflare dashboard → right sidebar of any domain/Workers overview page |
| `JWT_SECRET` | Signs/verifies session tokens (`c.env.JWT_SECRET`) | Generate once yourself: `openssl rand -hex 32` |
| `FCM_SERVER_KEY` | Sends push notifications via Firebase Cloud Messaging | Firebase Console → Project Settings → Cloud Messaging → Server key |

`CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` are consumed directly by the
`wrangler` CLI in the workflow (as env vars) to authenticate the deploy
itself. `JWT_SECRET`/`FCM_SERVER_KEY` are different — they're pushed *into*
the Worker as its own runtime secrets (`wrangler secret put`), which is
what `c.env.JWT_SECRET` and `c.env.FCM_SERVER_KEY` read at request time.

The app side (`build-apk.yml`) needs its own two secrets — see the comment
block at the top of that workflow file for what they are and where they're
used. Same rule applies: GitHub secret, never committed.

**Local development only** — if you want to run `wrangler dev` against real
secrets on your own machine instead of deploying, put them in a
`worker/.dev.vars` file (gitignored — see `.gitignore`) or run
`npx wrangler secret put JWT_SECRET` / `... FCM_SERVER_KEY` by hand against
your account. Either way, that's a local convenience only; it's not how
production gets its secrets, and neither of those ever needs to touch git.

### 5 — Create your user

There's no sign-up screen, so insert your own row directly:

```bash
npx wrangler d1 execute botmanager-db --remote --command \
  "INSERT INTO users (id, email, username, name, password_hash, created_at, updated_at) VALUES (...)"
```

Hash the password with the same PBKDF2 scheme `worker/src/lib/keys.ts` uses
for `password_hash` (salt:hash, both hex) — don't store it in plaintext.

---

## Development

```bash
# Start the Worker locally (http://localhost:8787)
npm run dev

# In the app root, set:
# EXPO_PUBLIC_API_URL=http://localhost:8787

# Stream Worker logs
npx wrangler tail
```

## Deployment

```bash
npm run deploy
# → https://botmanager-worker.<subdomain>.workers.dev
```

Update `EXPO_PUBLIC_API_URL` in `.env` for local dev, and in the
`EXPO_PUBLIC_API_URL` GitHub Actions secret (used by `build-apk.yml`) for
CI builds, to the deployed URL, then rebuild.

---

## Architecture

```
POST /auth/login           Email+password → JWT session token
POST /auth/logout          Revoke session

GET  /accounts/me          Fetch profile
PATCH /accounts/me         Update profile
POST /accounts/me/photo    Upload avatar → R2
POST /accounts/me/push-token  Register FCM device token
GET  /accounts/me/sessions    List active sessions
DELETE /accounts/me/sessions/:id  Revoke session

GET  /bots                 List bots
POST /bots                 Create bot (returns one-time token)
GET  /bots/:id             Bot + commands + users + analytics
PATCH /bots/:id            Update bot
DELETE /bots/:id           Delete bot
POST /bots/:id/rotate-token  Rotate bot token
... (commands, users, analytics, activity sub-routes)

GET  /conversations        Inbox
POST /conversations/:id/messages  Send message
...

GET  /servers              Server relay list
POST /servers              Create server
... (channels, members, bots sub-routes)

GET  /calls                Call log
POST /calls                Log a call

GET  /privacy/blocked      Blocked users
GET  /privacy/settings     Privacy rules + alert toggles
PATCH /privacy/settings    Update privacy settings

GET  /dev/api-keys         Developer API keys
POST /dev/api-keys         Create key (secret shown once)
GET  /dev/webhooks         Webhook list
POST /dev/webhooks         Create webhook (secret shown once)

POST /webhook/:token       Public — inbound bot messages
                           → stores in D1, bumps analytics,
                             forwards to bot webhook_url,
                             fires FCM push if enabled

POST /files/upload         Upload file to R2
GET  /files/:key           Download from R2
```

### JWT session token
- Signed with HS256 using `JWT_SECRET`  
- 30-day expiry  
- Stored on-device in `expo-secure-store`  
- Revocable server-side by deleting the session row in D1

### FCM push flow
1. App calls `POST /accounts/me/push-token` on startup  
2. Token stored in `sessions.fcm_token`  
3. When a webhook message arrives for a bot with `enable_notifications=true`
   + `notify_on_message=true`, the Worker looks up all FCM tokens for that
   bot's owner and fires `POST https://fcm.googleapis.com/fcm/send`

### File storage
Files are stored in R2 under `uploads/<userId>/<timestamp>-<uid>.<ext>`.
Serve them through a public R2 custom domain (e.g. `files.botmanager.dev`)
or proxy through the Worker's `/files/:key` route.
