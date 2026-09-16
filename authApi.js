// authApi.js — REAL auth, backed by the Cloudflare Worker.
// There is no self-service sign-up: accounts are created directly in the
// Cloudflare D1 database by the app owner (see worker/README.md).

import { api } from "./api";

export async function login({ identifier, password }) {
  const res = await api.login({
    identifier: identifier.trim(),
    password,
    deviceName: "BotManager App",
    platform: "android",
  });
  // res.sessionToken is the JWT — stored as "apiKey" in accountsStore
  if (!res.sessionToken) throw new Error("login_missing_session_token");
  return {
    apiKey: res.sessionToken,
    name: res.name,
    username: res.username,
    email: res.email,
    bio: res.bio || "",
    photo: res.photoUrl || null,
  };
}
