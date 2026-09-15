// auth.js — Session token stored in SecureStore.
// The "session token" is a JWT issued by the Cloudflare Worker.
// auth.js is the low-level store; accountsStore.js is the high-level one.

import * as SecureStore from 'expo-secure-store';
import { setSessionToken } from './api';

const KEY = 'botmanager_session_token';

export async function loadSession() {
  const token = await SecureStore.getItemAsync(KEY);
  if (token) setSessionToken(token);
  return token;
}

export async function saveSession(token) {
  await SecureStore.setItemAsync(KEY, token);
  setSessionToken(token);
}

export async function clearSession() {
  await SecureStore.deleteItemAsync(KEY);
  setSessionToken(null);
}
