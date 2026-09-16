import Constants from 'expo-constants';

// The installed app talks to the deployed Cloudflare Worker. app.config.js
// sets `extra.cloudflareWorkerUrl` for every build — from CLOUDFLARE_WORKER_URL
// when GitHub Actions generates the Android app, or its own dev default
// otherwise — so this is the one and only place that value is read. (It used
// to also hardcode that same dev default here as a second fallback; keeping
// one copy means there's one place to update if the Worker URL ever changes.)
const configuredApiUrl = Constants.expoConfig?.extra?.cloudflareWorkerUrl;

if (!configuredApiUrl) {
  // app.config.js always sets this, in dev and in CI builds alike, so
  // reaching here means Constants failed to load rather than a missing env
  // var — fail loudly in both environments instead of guessing a URL.
  throw new Error('Cloudflare Worker URL is missing — check app.config.js / Constants.expoConfig.extra');
}

export const API_URL = configuredApiUrl.replace(/\/$/, '');
