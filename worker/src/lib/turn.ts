const ENDPOINT = "https://rtc.live.cloudflare.com/v1/turn/keys";
export const TURN_TTL_SECONDS = 86400;
export type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};
export async function cloudflareIceServers(options: {
  keyId: string;
  apiToken: string;
  customIdentifier: string;
  fetcher?: typeof fetch;
}): Promise<IceServer[]> {
  const response = await (options.fetcher ?? fetch)(
    `${ENDPOINT}/${encodeURIComponent(options.keyId)}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ttl: TURN_TTL_SECONDS,
        customIdentifier: options.customIdentifier,
      }),
    },
  );
  if (!response.ok) throw new Error(`turn_credentials_${response.status}`);
  const body = await response.json<{ iceServers?: IceServer[] }>();
  if (!Array.isArray(body.iceServers) || !body.iceServers.length)
    throw new Error("turn_credentials_invalid_response");
  return body.iceServers;
}
export async function opaqueTurnUser(userId: string) {
  const bytes = new TextEncoder().encode(userId);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .slice(0, 12)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
