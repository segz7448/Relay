// notificationPrefs.js
//
// On-device notification/sound preferences (per-category alerts, sound
// choice, vibration, in-app banners, preview text, app-icon badge) —
// same persisted-context shape as theme.js's appearance mode. These are
// the *preferences*; notifications.js (the expo-notifications wrapper)
// is where the actual permission/registration plumbing lives.

import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import * as SecureStore from './utils/secureStore';

export const PREFS_KEY = 'botmanager_notification_prefs';

export const SOUND_OPTIONS = ['Default', 'Chime', 'Ding', 'Pulse', 'Note', 'None'];

const DEFAULT_PREFS = {
  messageNotifications: true,
  botNotifications: true,
  serverNotifications: true,
  callNotifications: true,
  sound: 'Default',
  vibration: true,
  inAppNotifications: true,
  previewMessages: true,
  notificationBadge: true,
};

const NotificationPrefsContext = createContext({
  prefs: DEFAULT_PREFS,
  loaded: false,
  setPref: () => {},
});

export function NotificationPrefsProvider({ children }) {
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);
  const prefsRef = useRef(prefs);
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  useEffect(() => {
    let cancelled = false;
    SecureStore.getItemAsync(PREFS_KEY)
      .then((raw) => {
        if (cancelled) return;
        if (raw) {
          try {
            const parsed = { ...DEFAULT_PREFS, ...JSON.parse(raw) };
            prefsRef.current = parsed;
            setPrefs(parsed);
          } catch {
            // corrupt value — keep defaults
          }
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const setPref = useCallback((key, value) => {
    const next = { ...prefsRef.current, [key]: value };
    prefsRef.current = next;
    setPrefs(next);
    SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const value = useMemo(() => ({ prefs, loaded, setPref }), [prefs, loaded, setPref]);

  return <NotificationPrefsContext.Provider value={value}>{children}</NotificationPrefsContext.Provider>;
}

export function useNotificationPrefs() {
  return useContext(NotificationPrefsContext);
}
