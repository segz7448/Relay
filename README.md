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
- Authenticated 1:1 voice/video calls: WebRTC offer/answer and ICE-candidate exchange through the Worker, TURN credential issuance, call history, and a two-peer test harness
- Numbered D1 migrations, Workers-runtime tests, production app export, and Worker dry-run validation in CI

Calls use `react-native-webrtc` on the client (`callEngine.js`) with the Worker (`worker/src/routes/calls.ts`) acting purely as the signaling channel — it never touches media itself, only offers/answers/ICE candidates. TURN credentials come primarily from the Worker's `/calls/ice-servers` endpoint (needs the `TURN_KEY_ID`/`TURN_KEY_API_TOKEN` secrets below); if that's not configured or the request fails, the client falls back to the build-time `RELAY_TURN_*` values, and if neither is set, to STUN-only — which still works on networks where a direct peer connection is possible.

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
- Optional TURN config for calls: `RELAY_TURN_URLS` (comma-separated), `RELAY_TURN_USERNAME`, `RELAY_TURN_CREDENTIAL` — embedded in native app config the same way as `CLOUDFLARE_WORKER_URL`; used as a client-side fallback if the Worker's own TURN issuance isn't configured

Secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `JWT_SECRET`
- `FCM_SERVER_KEY`
- `TURN_KEY_ID` / `TURN_KEY_API_TOKEN` — Cloudflare Realtime TURN credentials the Worker uses to issue short-lived ICE servers for calls (`/calls/ice-servers`); without these, calls fall back to the client-side `RELAY_TURN_*` variables above, then to STUN-only

Keep every secret in GitHub Actions secrets or Cloudflare Worker secrets. Do not put secrets in repository variables or source files.

## Deployment gate

Replace the non-secret D1/KV placeholders and choose the production CORS origin before deployment. Apply D1 migrations before the Worker rollout. The repository does not invent resource IDs or credentials.
