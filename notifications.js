// notifications.js — FCM + expo-notifications integration.
// Requests permission, gets the raw native device push token (FCM
// registration token on Android — no Expo account/project id involved),
// registers it with the Cloudflare Worker, and forwards received
// notifications into the in-app notification list.

import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as SecureStore from './utils/secureStore';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import { api } from './api';
import { PREFS_KEY } from './notificationPrefs';

// Map a push payload's data.type to the on-device preference category
// that governs it (see notificationPrefs.js). The handler below reads
// the real persisted prefs, so the category toggles in Settings ->
// Notifications genuinely silence their category instead of being
// cosmetic switches.
const TYPE_TO_PREF = {
  message: 'messageNotifications',
  bot_alert: 'botNotifications',
  server: 'serverNotifications',
  relay: 'serverNotifications',
  incoming_call: 'callNotifications',
};

async function readPrefs() {
  try {
    const raw = await SecureStore.getItemAsync(PREFS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const prefs = await readPrefs();
    const type = notification?.request?.content?.data?.type;
    const categoryOn = TYPE_TO_PREF[type] ? prefs[TYPE_TO_PREF[type]] !== false : true;
    return {
      shouldShowAlert: categoryOn,
      shouldPlaySound: categoryOn && prefs.sound !== 'None',
      shouldSetBadge: categoryOn && prefs.notificationBadge !== false,
    };
  },
});

const NotificationsContext = createContext(null);

export function NotificationsProvider({ children }) {
  const [items, setItems] = useState([]);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const listenerRef = useRef(null);
  const responseListenerRef = useRef(null);

  const addItem = useCallback((notification) => {
    const { title, body, data } = notification.request?.content ?? notification;
    // Honor the "In-app notifications" preference: when off, the system
    // alert still shows but nothing is added to the in-app inbox.
    readPrefs().then((prefs) => {
      if (prefs.inAppNotifications === false) return;
      setItems((prev) => [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          title,
          body,
          data,
          read: false,
          receivedAt: Date.now(),
        },
        ...prev,
      ]);
    });
  }, []);

  const requestPermissionAndRegister = useCallback(async () => {
    if (!Device.isDevice) {
      console.log('[Notifications] Push not available in simulator');
      return null;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    const granted = finalStatus === 'granted';
    setPermissionGranted(granted);
    if (!granted) return null;

    // Android: create notification channels
    if (Platform.OS === 'android') {
      await Promise.all([
        Notifications.setNotificationChannelAsync('default', {
          name: 'Default',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#276749',
        }),
        Notifications.setNotificationChannelAsync('messages', {
          name: 'Messages',
          importance: Notifications.AndroidImportance.HIGH,
          sound: 'default',
        }),
        Notifications.setNotificationChannelAsync('bot_alerts', {
          name: 'Bot Alerts',
          importance: Notifications.AndroidImportance.DEFAULT,
        }),
        Notifications.setNotificationChannelAsync('calls', {
          name: 'Calls',
          importance: Notifications.AndroidImportance.MAX,
          sound: 'default',
          vibrationPattern: [0, 500, 500, 500],
        }),
      ]);
    }

    // Get the raw native device push token (FCM registration token on Android).
    // This talks to Firebase directly and does NOT go through Expo's push
    // service, so no Expo account / project id is involved at all — the
    // worker's fcm.ts sends straight to https://fcm.googleapis.com.
    let pushToken = null;
    try {
      const tokenData = await Notifications.getDevicePushTokenAsync();
      pushToken = tokenData.data;
    } catch (e) {
      console.warn('[Notifications] Could not get push token:', e.message);
      return null;
    }

    // Register with the Worker — so it knows where to deliver FCM alerts
    try {
      await api.registerPushToken(pushToken);
    } catch (e) {
      console.warn('[Notifications] Push token registration failed:', e.message);
    }

    return pushToken;
  }, []);

  useEffect(() => {
    Notifications.getPermissionsAsync().then(({ status }) =>
      setPermissionGranted(status === 'granted')
    );

    // Listen for foreground notifications
    listenerRef.current = Notifications.addNotificationReceivedListener(addItem);

    // Handle notification taps (app backgrounded or killed)
    responseListenerRef.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        // Tapping a system notification takes the user to the thing it
        // was about, using the ids the Worker puts in the payload
        // (worker/src/lib/fcm.ts).
        const { data } = response.notification.request.content;
        if (data?.conversationId) {
          router.push(`/conversation/${data.conversationId}`);
        } else if (data?.botId) {
          router.push(`/bot/${data.botId}`);
        }
      }
    );

    return () => {
      if (listenerRef.current) Notifications.removeNotificationSubscription(listenerRef.current);
      if (responseListenerRef.current) Notifications.removeNotificationSubscription(responseListenerRef.current);
    };
  }, [addItem]);

  const markRead = useCallback((id) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }, []);

  const markAllRead = useCallback(() => {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const unreadCount = items.filter((n) => !n.read).length;

  return (
    <NotificationsContext.Provider
      value={{ items, unreadCount, permissionGranted, requestPermissionAndRegister, markRead, markAllRead, addItem }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used inside NotificationsProvider');
  return ctx;
}
