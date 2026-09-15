// privacySecurity.js
//
// On-device Privacy & Security preferences — granular privacy rules
// (who can see what), security alert toggles, and the on/off + metadata
// for Passcode Lock and Two-Step Verification. Same persisted-context
// shape as notificationPrefs.js/theme.js. The passcode digits and the
// two-step password itself are deliberately NOT kept here — each of
// those screens owns its own secret under a separate SecureStore key,
// so this file (read by the main hub screen) never has them in memory.

import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import * as SecureStore from './utils/secureStore';

const KEY = 'botmanager_privacy_security';

export const RULE_OPTIONS = [
  { key: 'everybody', label: 'Everybody', icon: 'globe-outline' },
  { key: 'contacts', label: 'My Contacts', icon: 'people-outline' },
  { key: 'nobody', label: 'Nobody', icon: 'lock-closed-outline' },
];

export const RULE_FIELDS = [
  { key: 'phoneNumber', label: 'Phone Number', icon: 'call', iconColor: '#34C759' },
  { key: 'lastSeen', label: 'Last Seen & Online', icon: 'time', iconColor: '#007AFF' },
  { key: 'profilePhoto', label: 'Profile Photo', icon: 'image', iconColor: '#FF9500' },
  { key: 'calls', label: 'Calls', icon: 'call-outline', iconColor: '#FF3B30' },
  { key: 'forwardedMessages', label: 'Forwarded Messages', icon: 'arrow-redo', iconColor: '#5856D6' },
  { key: 'groupsAndChannels', label: 'Groups & Channels', icon: 'people', iconColor: '#00C7BE' },
  { key: 'voiceMessages', label: 'Voice Messages', icon: 'mic', iconColor: '#FF2D55' },
];

const DEFAULT_STATE = {
  rules: {
    phoneNumber: 'contacts',
    lastSeen: 'everybody',
    profilePhoto: 'everybody',
    calls: 'everybody',
    forwardedMessages: 'everybody',
    groupsAndChannels: 'everybody',
    voiceMessages: 'everybody',
  },
  alerts: {
    newLogin: true,
    newDevice: true,
    failedAttempts: true,
    apiKeyUsage: true,
    emailAlerts: true,
    pushAlerts: true,
  },
  passcode: { enabled: false, autoLock: '1 minute', biometric: false },
  twoStep: { enabled: false, hint: '' },
};

const Ctx = createContext({
  state: DEFAULT_STATE,
  loaded: false,
  setRule: () => {},
  setAlert: () => {},
  setPasscodeMeta: () => {},
  setTwoStepMeta: () => {},
});

export function PrivacySecurityProvider({ children }) {
  const [state, setState] = useState(DEFAULT_STATE);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef(state);
  useEffect(() => {
    ref.current = state;
  }, [state]);

  useEffect(() => {
    let cancelled = false;
    SecureStore.getItemAsync(KEY)
      .then((raw) => {
        if (cancelled) return;
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            const merged = {
              rules: { ...DEFAULT_STATE.rules, ...parsed.rules },
              alerts: { ...DEFAULT_STATE.alerts, ...parsed.alerts },
              passcode: { ...DEFAULT_STATE.passcode, ...parsed.passcode },
              twoStep: { ...DEFAULT_STATE.twoStep, ...parsed.twoStep },
            };
            ref.current = merged;
            setState(merged);
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

  const persist = useCallback((next) => {
    ref.current = next;
    setState(next);
    SecureStore.setItemAsync(KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const setRule = useCallback((field, value) => {
    persist({ ...ref.current, rules: { ...ref.current.rules, [field]: value } });
  }, [persist]);

  const setAlert = useCallback((field, value) => {
    persist({ ...ref.current, alerts: { ...ref.current.alerts, [field]: value } });
  }, [persist]);

  const setPasscodeMeta = useCallback((patch) => {
    persist({ ...ref.current, passcode: { ...ref.current.passcode, ...patch } });
  }, [persist]);

  const setTwoStepMeta = useCallback((patch) => {
    persist({ ...ref.current, twoStep: { ...ref.current.twoStep, ...patch } });
  }, [persist]);

  const value = useMemo(
    () => ({ state, loaded, setRule, setAlert, setPasscodeMeta, setTwoStepMeta }),
    [state, loaded, setRule, setAlert, setPasscodeMeta, setTwoStepMeta]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrivacySecurity() {
  return useContext(Ctx);
}

export function ruleLabel(key) {
  return RULE_OPTIONS.find((o) => o.key === key)?.label ?? 'Everybody';
}

// Separate secret stores for the passcode digits / two-step password —
// deliberately outside the context above and outside any screen's React
// state longer than it has to be.
const PASSCODE_KEY = 'botmanager_passcode_secret';
const TWO_STEP_KEY = 'botmanager_two_step_secret';

export async function savePasscodeSecret(digits) {
  await SecureStore.setItemAsync(PASSCODE_KEY, digits);
}
export async function readPasscodeSecret() {
  return SecureStore.getItemAsync(PASSCODE_KEY);
}
export async function clearPasscodeSecret() {
  await SecureStore.deleteItemAsync(PASSCODE_KEY);
}

export async function saveTwoStepSecret(password) {
  await SecureStore.setItemAsync(TWO_STEP_KEY, password);
}
export async function readTwoStepSecret() {
  return SecureStore.getItemAsync(TWO_STEP_KEY);
}
export async function clearTwoStepSecret() {
  await SecureStore.deleteItemAsync(TWO_STEP_KEY);
}
