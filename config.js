import Constants from 'expo-constants';

// The installed app talks to the deployed Cloudflare Worker. GitHub Actions
// injects this value through app.config.js when it generates the Android app.
const configuredApiUrl = Constants.expoConfig?.extra?.cloudflareWorkerUrl;

if (!configuredApiUrl && !__DEV__) {
  throw new Error('Cloudflare Worker URL is missing from the Android build');
}

export const API_URL = (configuredApiUrl || 'https://botmanager-worker.ayiijumo.workers.dev').replace(/\/$/, '');
