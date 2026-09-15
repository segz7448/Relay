// Firebase Cloud Messaging — Legacy HTTP API
// Set FCM_SERVER_KEY secret via: wrangler secret put FCM_SERVER_KEY
// Get your server key from: Firebase Console → Project Settings → Cloud Messaging

export interface FCMPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  badge?: number;
  sound?: string;
  imageUrl?: string;
  channelId?: string;
}

export async function sendFCMToToken(
  serverKey: string,
  fcmToken: string,
  payload: FCMPayload
): Promise<{ success: boolean; error?: string }> {
  const message = {
    to: fcmToken,
    priority: 'high',
    notification: {
      title: payload.title,
      body: payload.body,
      sound: payload.sound ?? 'default',
      badge: payload.badge ?? 1,
      ...(payload.imageUrl ? { image: payload.imageUrl } : {}),
    },
    data: {
      ...(payload.data ?? {}),
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
    },
    android: {
      priority: 'high',
      notification: {
        channel_id: payload.channelId ?? 'default',
        sound: 'default',
        priority: 'high',
        default_vibrate_timings: true,
      },
    },
  };

  try {
    const res = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `key=${serverKey}`,
      },
      body: JSON.stringify(message),
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `FCM HTTP ${res.status}: ${text}` };
    }

    const json = await res.json() as { success: number; failure: number; results?: Array<{ error?: string }> };
    if (json.failure > 0) {
      const err = json.results?.[0]?.error ?? 'unknown_error';
      return { success: false, error: err };
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export async function sendFCMToTokens(
  serverKey: string,
  tokens: string[],
  payload: FCMPayload
): Promise<void> {
  if (!tokens.length) return;
  await Promise.allSettled(tokens.map(t => sendFCMToToken(serverKey, t, payload)));
}

// Build payloads for common event types
export function messagePayload(senderName: string, text: string, conversationId: string): FCMPayload {
  return {
    title: senderName,
    body: text.length > 100 ? text.slice(0, 97) + '…' : text,
    data: { type: 'message', conversationId },
    channelId: 'messages',
  };
}

export function botAlertPayload(botName: string, eventType: string, botId: string): FCMPayload {
  return {
    title: `Bot alert — ${botName}`,
    body: eventType,
    data: { type: 'bot_alert', botId },
    channelId: 'bot_alerts',
  };
}

export function callPayload(callerName: string, callType: 'voice' | 'video', contactId: string): FCMPayload {
  return {
    title: `Incoming ${callType} call`,
    body: `${callerName} is calling you`,
    data: { type: 'incoming_call', callType, contactId },
    channelId: 'calls',
    sound: 'ringtone',
  };
}
