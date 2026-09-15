# Relay

Relay is an Expo Router client backed by a Cloudflare Worker using D1, KV, and R2. It includes authenticated messaging and bot administration plus a strictly read-only Server Relay surface.

## What is implemented

- Session authentication, account profile, active sessions, privacy, security settings, and developer settings
- Bot lifecycle, one-time tokens, commands, users, analytics, activity, webhook delivery, conversations, and private files
- Per-bot ownership and cross-bot isolation across users, messages, conversations, files, analytics, and webhooks
- Webhook URL validation, separate HMAC secret, stable event IDs, timestamped payloads, delivery history, retries, and SSRF controls
- Authenticated conversation and attachment persistence
- Server Relay server/channel/member/message reads with authorization, signed cursors, pagination, ID deduplication, and polling
- Shared KV rate limits for Relay reads and bot mutation surfaces
- Numbered D1 migrations, Workers-runtime tests, production app export, and Worker dry-run validation in CI

Call controls are intentionally absent. The repository has no realtime voice/video signaling or media backend, so exposing call UI would misrepresent the product.

## Local checks

```sh
npm ci
CLOUDFLARE_WORKER_URL=http://localhost:8787 npm run check
CLOUDFLARE_WORKER_URL=http://localhost:8787 npm run export:web

cd worker
npm ci
npm run typecheck
npm test -- --run
npm run db:migrate:local
npx wrangler deploy --dry-run
```

## Configuration

Public configuration:

- GitHub repository variable `CLOUDFLARE_WORKER_URL`, embedded in native app config during the APK build
- D1 database ID and KV namespace ID in `worker/wrangler.toml`
- R2 bucket name and allowed CORS origin in `worker/wrangler.toml`

Secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `JWT_SECRET`
- `FCM_SERVER_KEY`

Keep every secret in GitHub Actions secrets or Cloudflare Worker secrets. Do not put secrets in repository variables or source files.

## Deployment gate

Replace the non-secret D1/KV placeholders and choose the production CORS origin before deployment. Apply D1 migrations before the Worker rollout. The repository does not invent resource IDs or credentials.
