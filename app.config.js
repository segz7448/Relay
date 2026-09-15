const app = require('./app.json');

// GitHub Actions injects the deployed Cloudflare Worker URL while generating
// the native Android project. Local development keeps the Worker dev default.
const cloudflareWorkerUrl = process.env.CLOUDFLARE_WORKER_URL || 'http://localhost:8787';
const googleServicesFile = process.env.GOOGLE_SERVICES_FILE;

module.exports = {
  ...app,
  expo: {
    ...app.expo,
    extra: {
      ...(app.expo.extra || {}),
      cloudflareWorkerUrl,
    },
    android: {
      ...app.expo.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  },
};
