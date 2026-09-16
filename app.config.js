const app = require("./app.json");

// GitHub Actions injects the deployed Cloudflare Worker URL while generating
// the native Android project. Local development keeps the Worker dev default.
const cloudflareWorkerUrl =
  process.env.CLOUDFLARE_WORKER_URL || "https://botmanager-worker.ayiijumo.workers.dev";
const googleServicesFile = process.env.GOOGLE_SERVICES_FILE;
const turnUrls = process.env.RELAY_TURN_URLS;
const turnUsername = process.env.RELAY_TURN_USERNAME;
const turnCredential = process.env.RELAY_TURN_CREDENTIAL;

module.exports = {
  ...app,
  expo: {
    ...app.expo,
    extra: {
      ...(app.expo.extra || {}),
      cloudflareWorkerUrl,
      ...(turnUrls && turnUsername && turnCredential
        ? {
            turn: {
              urls: turnUrls.split(","),
              username: turnUsername,
              credential: turnCredential,
            },
          }
        : {}),
    },
    android: {
      ...app.expo.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  },
};
