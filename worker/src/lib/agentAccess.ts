export const API_MODES = ["Admin", "Builder", "Operator", "Read only"] as const;
export type ApiMode = (typeof API_MODES)[number];
const reads = ["/bots", "/servers", "/relay", "/conversations", "/stats"];
const operatorPosts = [
  /^\/bots\/[^/]+\/users\/[^/]+\/messages$/,
  /^\/servers\/[^/]+\/channels\/[^/]+\/messages$/,
  /^\/conversations\/[^/]+\/messages$/,
];
export function apiModeAllows(mode: ApiMode, method: string, path: string) {
  if (method === "GET")
    return reads.some((x) => path === x || path.startsWith(x + "/"));
  if (mode === "Read only") return false;
  if (mode === "Operator")
    return method === "POST" && operatorPosts.some((x) => x.test(path));
  if (mode === "Builder")
    return (
      ["POST", "PATCH", "PUT"].includes(method) &&
      ["/bots", "/servers"].some((x) => path === x || path.startsWith(x + "/"))
    );
  return (
    mode === "Admin" &&
    ["/bots", "/servers", "/conversations", "/stats", "/files", "/dev"].some(
      (x) => path === x || path.startsWith(x + "/"),
    )
  );
}
export const AGENT_API_DISCOVERY = {
  version: 1,
  authentication: {
    header: "Authorization: Bearer <access-key>",
    keyPrefix: "sk_live_",
    oneTimeReveal: true,
    revocable: true,
    management: "session-only /dev/api-keys",
  },
  idempotency: {
    header: "Idempotency-Key",
    format: "8-128 letters, digits, dot, underscore, colon, or hyphen",
    createServer: "replays original resource",
    createBot:
      "409 returns resourceId and rotate-token recovery because the token is not stored",
  },
  modes: {
    Admin: { read: true, configure: true, delete: true, send: true },
    Builder: { read: true, configure: true, delete: false, send: true },
    Operator: { read: true, configure: false, delete: false, send: true },
    "Read only": { read: true, configure: false, delete: false, send: false },
  },
  journey: [
    {
      method: "POST",
      path: "/bots",
      body: { name: "Agent bot", username: "unique_bot" },
      idempotent: true,
      oneTimeResponse: "token",
    },
    {
      method: "POST",
      path: "/servers",
      body: { name: "Agent server" },
      idempotent: true,
    },
    {
      method: "POST",
      path: "/servers/{serverId}/channels",
      body: { name: "ops" },
    },
    {
      method: "POST",
      path: "/servers/{serverId}/members",
      body: { userId: "user-id", role: "member", permissions: {} },
    },
    {
      method: "POST",
      path: "/servers/{serverId}/bots",
      body: { botId: "bot-id" },
    },
    {
      method: "POST",
      path: "/servers/{serverId}/channels/{channelId}/messages",
      body: { text: "hello" },
    },
    { method: "GET", path: "/relay/servers" },
  ],
};
