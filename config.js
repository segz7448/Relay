// Public runtime configuration. Never place secrets in EXPO_PUBLIC_* values.
// CI/deploy provides this as a GitHub repository variable named API_URL and
// maps it to EXPO_PUBLIC_API_URL during the build.
const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL || process.env.API_URL;

if (!configuredApiUrl && !__DEV__) {
  throw new Error('EXPO_PUBLIC_API_URL is required for production builds');
}

export const API_URL = (configuredApiUrl || 'http://localhost:8787').replace(/\/$/, '');
