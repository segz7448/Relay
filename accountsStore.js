// accountsStore.js
//
// Telegram-style multi-account support: a list of signed-in accounts
// (each with its own session key + display profile), one of them
// "active" at a time. Switching accounts just swaps which apiKey the
// api.js singleton uses — every screen that calls `api.*` automatically
// starts talking to the new account's data on its next request.
//
// profileStore.js is a thin adapter on top of this (the active
// account's name/username/email/bio/photo *is* "the profile"), so
// screens that already used useProfile() keep working unmodified.
//
// Persisted on-device via SecureStore, same pattern as theme.js and the
// old profileStore.js. On first run, if no account list exists yet but
// the old single-session keys do (someone updating from before
// multi-account existed), that session is migrated in as this device's
// first account instead of being dropped.

import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import * as SecureStore from './utils/secureStore';
import { api, setApiKey } from './api';

const ACCOUNTS_KEY = 'botmanager_accounts';
const ACTIVE_KEY = 'botmanager_active_account_id';

// Legacy single-session keys from before multi-account existed (auth.js /
// the original profileStore.js) — read once for migration, never written.
const LEGACY_SESSION_KEY = 'botmanager_api_key';
const LEGACY_PROFILE_KEY = 'botmanager_profile';

// Same ceiling Telegram uses for non-Premium accounts. Keeps the switcher
// list from growing unbounded and matches the interface being modeled.
export const MAX_ACCOUNTS = 3;

function makeId() {
  return `acct_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function shape(data) {
  return {
    id: data.id || makeId(),
    apiKey: data.apiKey,
    email: data.email || '',
    name: data.name || '',
    username: data.username || '',
    photo: data.photo || null,
    bio: data.bio || '',
    // Presence for the switcher list: the active account is always
    // "online" (it's live on this device right now); every other account
    // on the list is "offline" with a lastSeenAt stamp of when it was
    // last the active one — same online/last-seen shape messagesApi
    // uses for contacts, so AccountRow can share the same presence logic
    // as contact/[id].jsx.
    online: data.online ?? true,
    lastSeenAt: data.lastSeenAt ?? Date.now(),
  };
}

// Shared with AccountRow (and mirrors the presence() helper in
// app/contact/[id].jsx) so an account's dot + label are computed the
// same way everywhere they're shown.
export function accountPresence(account) {
  if (!account) return { label: '', online: false };
  if (account.online) return { label: 'online', online: true };
  const ts = account.lastSeenAt;
  if (!ts) return { label: 'last seen recently', online: false };
  const diff = Date.now() - ts;
  const min = 60 * 1000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < 2 * min) return { label: 'last seen just now', online: false };
  if (diff < hr) return { label: `last seen ${Math.floor(diff / min)}m ago`, online: false };
  if (diff < day) return { label: `last seen ${Math.floor(diff / hr)}h ago`, online: false };
  return { label: `last seen ${Math.floor(diff / day)}d ago`, online: false };
}

async function migrateLegacySession() {
  let apiKey = null;
  try {
    apiKey = await SecureStore.getItemAsync(LEGACY_SESSION_KEY);
  } catch {
    // ignore — no legacy session to migrate
  }
  if (!apiKey) return [];

  let seeded = {};
  try {
    const raw = await SecureStore.getItemAsync(LEGACY_PROFILE_KEY);
    if (raw) seeded = JSON.parse(raw);
  } catch {
    // corrupt/missing legacy profile — fall through
  }
  if (!seeded.email && !seeded.name) {
    try {
      setApiKey(apiKey);
      const account = await api.me();
      if (account?.email) seeded = { email: account.email, name: account.email.split('@')[0] };
    } catch {
      // backend unreachable — migrate with a blank profile, editable later
    }
  }
  return [shape({ apiKey, ...seeded })];
}

const AccountsContext = createContext({
  accounts: [],
  activeId: null,
  activeAccount: null,
  loaded: false,
  maxAccounts: MAX_ACCOUNTS,
  addingAccount: false,
  beginAddAccount: () => {},
  endAddAccount: () => {},
  addAccount: async () => {},
  switchAccount: async () => {},
  removeAccount: async () => {},
  updateAccount: async () => {},
  updateActiveAccount: async () => {},
});

export function AccountsProvider({ children }) {
  const [accounts, setAccounts] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [addingAccount, setAddingAccount] = useState(false);

  // Mirrors state for use inside callbacks without stale closures, the
  // same pattern profileStore.js used for its single profile object.
  const ref = useRef({ accounts: [], activeId: null });
  useEffect(() => {
    ref.current = { accounts, activeId };
  }, [accounts, activeId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let list = [];
      try {
        const raw = await SecureStore.getItemAsync(ACCOUNTS_KEY);
        if (raw) list = JSON.parse(raw);
      } catch {
        // corrupt/missing — fall through to migration/empty
      }

      if (list.length === 0) {
        list = await migrateLegacySession();
      }

      let active = null;
      try {
        active = await SecureStore.getItemAsync(ACTIVE_KEY);
      } catch {
        // ignore
      }
      if (!list.find((a) => a.id === active)) active = list[0]?.id ?? null;

      // Normalize presence on load: exactly the active account is online,
      // every other one is offline. Covers accounts persisted before this
      // field existed (undefined online) and stale state from a session
      // that never got the chance to flip its own flag off.
      if (active) {
        list = list.map((a) =>
          a.id === active ? { ...a, online: true } : { ...a, online: false, lastSeenAt: a.lastSeenAt ?? Date.now() }
        );
      }

      const current = list.find((a) => a.id === active);
      setApiKey(current?.apiKey ?? null);

      if (list.length > 0) {
        await SecureStore.setItemAsync(ACCOUNTS_KEY, JSON.stringify(list)).catch(() => {});
        if (active) await SecureStore.setItemAsync(ACTIVE_KEY, active).catch(() => {});
      }

      if (!cancelled) {
        ref.current = { accounts: list, activeId: active };
        setAccounts(list);
        setActiveId(active);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (list, active) => {
    await SecureStore.setItemAsync(ACCOUNTS_KEY, JSON.stringify(list)).catch(() => {});
    if (active) await SecureStore.setItemAsync(ACTIVE_KEY, active).catch(() => {});
    else await SecureStore.deleteItemAsync(ACTIVE_KEY).catch(() => {});
  }, []);

  const beginAddAccount = useCallback(() => setAddingAccount(true), []);
  const endAddAccount = useCallback(() => setAddingAccount(false), []);

  // Adds a freshly-signed-in session as a new account and switches to it.
  // If the email/username already matches an account on this device
  // (re-signing-in to something already added), that account's session
  // key is refreshed and it's switched to instead of creating a duplicate
  // — same "you're already signed in" behavior Telegram falls back to.
  const addAccount = useCallback(
    async (data) => {
      const { accounts: curList, activeId: curActive } = ref.current;
      const emailKey = (data.email || '').trim().toLowerCase();
      const usernameKey = (data.username || '').trim().toLowerCase();
      const existing = curList.find(
        (a) =>
          (emailKey && a.email && a.email.toLowerCase() === emailKey) ||
          (usernameKey && a.username && a.username.toLowerCase() === usernameKey)
      );

      const now = Date.now();
      const markPreviousOffline = (list) =>
        list.map((a) => (a.id === curActive ? { ...a, online: false, lastSeenAt: now } : a));

      if (existing) {
        const nextList = markPreviousOffline(curList).map((a) =>
          a.id === existing.id ? { ...a, apiKey: data.apiKey, online: true, lastSeenAt: now } : a
        );
        ref.current = { accounts: nextList, activeId: existing.id };
        setAccounts(nextList);
        setActiveId(existing.id);
        setApiKey(data.apiKey);
        await persist(nextList, existing.id);
        return existing;
      }

      if (curList.length >= MAX_ACCOUNTS) {
        throw new Error(`You can only have up to ${MAX_ACCOUNTS} accounts on this device.`);
      }

      const account = shape({ ...data, online: true, lastSeenAt: now });
      const nextList = [...markPreviousOffline(curList), account];
      ref.current = { accounts: nextList, activeId: account.id };
      setAccounts(nextList);
      setActiveId(account.id);
      setApiKey(account.apiKey);
      await persist(nextList, account.id);

      // Hydrate real profile fields from /accounts/me
      try {
        const me = await api.me();
        const hydrated = nextList.map((a) =>
          a.id === account.id
            ? { ...a, name: me.name || a.name, email: me.email || a.email,
                username: me.username || a.username, bio: me.bio || '', photo: me.photoUrl || null }
            : a
        );
        ref.current = { ...ref.current, accounts: hydrated };
        setAccounts(hydrated);
        await persist(hydrated, account.id);
      } catch (_) {}

      return account;
    },
    [persist]
  );

  const switchAccount = useCallback(
    async (id) => {
      const { accounts: curList, activeId: curActive } = ref.current;
      const target = curList.find((a) => a.id === id);
      if (!target || id === curActive) return;
      const now = Date.now();
      // Stamp the account we're leaving as offline as of right now, and
      // the one we're switching to as online — same presence flip a real
      // "this session went active on another device" event would cause.
      const nextList = curList.map((a) => {
        if (a.id === curActive) return { ...a, online: false, lastSeenAt: now };
        if (a.id === id) return { ...a, online: true, lastSeenAt: now };
        return a;
      });
      ref.current = { accounts: nextList, activeId: id };
      setAccounts(nextList);
      setActiveId(id);
      setApiKey(target.apiKey);
      await persist(nextList, id);
    },
    [persist]
  );

  // Logs an account out of this device. Removing the active account
  // switches to whichever account is left (matching Telegram: logging
  // out of "Log Out" drops you into your next account rather than the
  // whole app) — only falling through to signed-out state when it was
  // the last one.
  const removeAccount = useCallback(
    async (id) => {
      const { accounts: curList, activeId: curActive } = ref.current;
      const nextList = curList.filter((a) => a.id !== id);
      let nextActive = curActive;
      if (curActive === id) {
        nextActive = nextList[0]?.id ?? null;
        setApiKey(nextList[0]?.apiKey ?? null);
      }
      ref.current = { accounts: nextList, activeId: nextActive };
      setAccounts(nextList);
      setActiveId(nextActive);
      await persist(nextList, nextActive);
      return { remainingCount: nextList.length };
    },
    [persist]
  );

  const updateAccount = useCallback(
    async (id, patch) => {
      const { accounts: curList, activeId: curActive } = ref.current;
      const nextList = curList.map((a) => (a.id === id ? { ...a, ...patch } : a));
      ref.current = { accounts: nextList, activeId: curActive };
      setAccounts(nextList);
      if (id === curActive && patch.apiKey) setApiKey(patch.apiKey);
      await persist(nextList, curActive);
      return nextList.find((a) => a.id === id);
    },
    [persist]
  );

  const updateActiveAccount = useCallback(
    (patch) => updateAccount(ref.current.activeId, patch),
    [updateAccount]
  );

  const activeAccount = accounts.find((a) => a.id === activeId) || null;

  const value = useMemo(
    () => ({
      accounts,
      activeId,
      activeAccount,
      loaded,
      maxAccounts: MAX_ACCOUNTS,
      addingAccount,
      beginAddAccount,
      endAddAccount,
      addAccount,
      switchAccount,
      removeAccount,
      updateAccount,
      updateActiveAccount,
    }),
    [
      accounts,
      activeId,
      activeAccount,
      loaded,
      addingAccount,
      beginAddAccount,
      endAddAccount,
      addAccount,
      switchAccount,
      removeAccount,
      updateAccount,
      updateActiveAccount,
    ]
  );

  return <AccountsContext.Provider value={value}>{children}</AccountsContext.Provider>;
}

export function useAccounts() {
  return useContext(AccountsContext);
}
