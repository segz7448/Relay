import { describe, expect, it, vi } from "vitest";
import {
  cloudflareIceServers,
  opaqueTurnUser,
  TURN_TTL_SECONDS,
} from "../turn";
describe("Cloudflare TURN credentials", () => {
  it("keeps the long-term secret server-side and requests short-lived ICE servers", async () => {
    const fetcher = vi.fn(async (_url: any, init: any) => {
      expect(init.headers.Authorization).toBe("Bearer server-secret");
      expect(JSON.parse(init.body)).toEqual({
        ttl: 86400,
        customIdentifier: "opaque",
      });
      return new Response(
        JSON.stringify({
          iceServers: [
            {
              urls: ["turn:turn.cloudflare.com:3478"],
              username: "short",
              credential: "lived",
            },
          ],
        }),
        { status: 201 },
      );
    }) as any;
    const result = await cloudflareIceServers({
      keyId: "key-id",
      apiToken: "server-secret",
      customIdentifier: "opaque",
      fetcher,
    });
    expect(result[0].credential).toBe("lived");
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://rtc.live.cloudflare.com/v1/turn/keys/key-id/credentials/generate-ice-servers",
    );
    expect(TURN_TTL_SECONDS).toBe(86400);
  });
  it("uses a stable opaque analytics identifier", async () => {
    expect(await opaqueTurnUser("private-user-id")).toMatch(/^[0-9a-f]{24}$/);
    expect(await opaqueTurnUser("private-user-id")).not.toContain(
      "private-user-id",
    );
  });
});
