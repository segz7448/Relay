// utils/secureStore.js — one storage API for every platform.
//
// expo-secure-store has no web implementation (its native module throws
// `getValueWithKeyAsync is not a function` and takes the whole app down
// on the web build). On native we use the real hardware-backed
// SecureStore; on web we fall back to localStorage. The web fallback is
// not a security boundary — it exists so the web export runs at all;
// session tokens on web get the same treatment any SPA gives them.
// Every caller imports from here instead of expo-secure-store directly.

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const PREFIX = 'botmanager_secure_';

export async function getItemAsync(key) {
  if (Platform.OS === 'web') {
    try {
      return window.localStorage.getItem(PREFIX + key);
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

export async function setItemAsync(key, value) {
  if (Platform.OS === 'web') {
    try {
      window.localStorage.setItem(PREFIX + key, value);
    } catch {
      // storage full/blocked — same "best effort" contract as native callers handle
    }
    return;
  }
  return SecureStore.setItemAsync(key, value);
}

export async function deleteItemAsync(key) {
  if (Platform.OS === 'web') {
    try {
      window.localStorage.removeItem(PREFIX + key);
    } catch {
      // ignore
    }
    return;
  }
  return SecureStore.deleteItemAsync(key);
}
