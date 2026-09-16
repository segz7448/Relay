export interface FirebaseServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface FCMPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  badge?: number;
  sound?: string;
  imageUrl?: string;
  channelId?: string;
}

interface AccessToken {
  owner: string;
  value: string;
  expiresAt: number;
}

const ACCESS_TOKEN_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const encoder = new TextEncoder();
let cachedAccessToken: AccessToken | undefined;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function encodeJson(value: unknown): string {
  return base64Url(encoder.encode(JSON.stringify(value)));
}

function parseServiceAccount(raw: string): FirebaseServiceAccount {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is not valid JSON");
  }

  if (!value || typeof value !== "object") {
    throw new Error("FIREBASE_SERVICE_ACCOUNT must be a JSON object");
  }

  const candidate = value as Partial<FirebaseServiceAccount>;
  if (
    !candidate.project_id ||
    !candidate.client_email ||
    !candidate.private_key
  ) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is missing required fields");
  }

  return candidate as FirebaseServiceAccount;
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binary = atob(body);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return bytes.buffer;
}

async function createAssertion(
  account: FirebaseServiceAccount,
  nowSeconds: number,
): Promise<string> {
  const header = encodeJson({ alg: "RS256", typ: "JWT" });
  const claims = encodeJson({
    iss: account.client_email,
    scope: ACCESS_TOKEN_SCOPE,
    aud: account.token_uri ?? DEFAULT_TOKEN_URI,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  });
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(unsigned),
  );
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

async function getAccessToken(
  account: FirebaseServiceAccount,
): Promise<string> {
  const now = Date.now();
  if (
    cachedAccessToken?.owner === account.client_email &&
    cachedAccessToken.expiresAt > now + 60_000
  ) {
    return cachedAccessToken.value;
  }

  const tokenUri = account.token_uri ?? DEFAULT_TOKEN_URI;
  const assertion = await createAssertion(account, Math.floor(now / 1000));
  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `FCM OAuth token exchange failed with HTTP ${response.status}`,
    );
  }

  const result = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!result.access_token)
    throw new Error("FCM OAuth token exchange returned no access token");

  cachedAccessToken = {
    owner: account.client_email,
    value: result.access_token,
    expiresAt: now + (result.expires_in ?? 3600) * 1000,
  };
  return cachedAccessToken.value;
}

export async function sendFCMToToken(
  serviceAccountJson: string,
  fcmToken: string,
  payload: FCMPayload,
): Promise<{ success: boolean; error?: string }> {
  try {
    const account = parseServiceAccount(serviceAccountJson);
    const accessToken = await getAccessToken(account);
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          message: {
            token: fcmToken,
            notification: {
              title: payload.title,
              body: payload.body,
              ...(payload.imageUrl ? { image: payload.imageUrl } : {}),
            },
            data: payload.data ?? {},
            android: {
              priority: "high",
              notification: {
                channel_id: payload.channelId ?? "default",
                sound: payload.sound ?? "default",
                notification_count: payload.badge ?? 1,
                default_vibrate_timings: true,
              },
            },
          },
        }),
      },
    );

    if (!response.ok) {
      return {
        success: false,
        error: `FCM send failed with HTTP ${response.status}`,
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function sendFCMToTokens(
  serviceAccountJson: string,
  tokens: string[],
  payload: FCMPayload,
): Promise<void> {
  if (!tokens.length) return;
  await Promise.allSettled(
    tokens.map((token) => sendFCMToToken(serviceAccountJson, token, payload)),
  );
}

export function messagePayload(
  senderName: string,
  text: string,
  conversationId: string,
): FCMPayload {
  return {
    title: senderName,
    body: text.length > 100 ? text.slice(0, 97) + "…" : text,
    data: { type: "message", conversationId },
    channelId: "messages",
  };
}

export function botAlertPayload(
  botName: string,
  eventType: string,
  botId: string,
): FCMPayload {
  return {
    title: `Bot alert — ${botName}`,
    body: eventType,
    data: { type: "bot_alert", botId },
    channelId: "bot_alerts",
  };
}

export function callPayload(
  callerName: string,
  callType: "voice",
  contactId: string,
  callId?: string,
): FCMPayload {
  return {
    title: `Incoming ${callType} call`,
    body: `${callerName} is calling you`,
    data: {
      type: "incoming_call",
      callType,
      contactId,
      ...(callId ? { callId } : {}),
    },
    channelId: "calls",
    sound: "ringtone",
  };
}
