import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../../lib/keys";
const db = () => env.DB as D1Database,
  J = { "Content-Type": "application/json" };
async function login(id: string) {
  await db()
    .prepare(
      "INSERT INTO users(id,email,username,name,password_hash,created_at,updated_at)VALUES(?,?,?,?,?,?,?)",
    )
    .bind(id, `${id}@x`, id, id, await hashPassword("password-12345"), 1, 1)
    .run();
  return (
    await (
      await SELF.fetch("https://x/auth/login", {
        method: "POST",
        headers: J,
        body: JSON.stringify({ identifier: id, password: "password-12345" }),
      })
    ).json<any>()
  ).sessionToken;
}
const A = (t: string, m = "GET", b?: any, k?: string) => ({
  method: m,
  headers: {
    ...J,
    Authorization: `Bearer ${t}`,
    ...(k ? { "Idempotency-Key": k } : {}),
  },
  ...(b ? { body: JSON.stringify(b) } : {}),
});
async function key(t: string, scope: string) {
  return await (
    await SELF.fetch(
      "https://x/dev/api-keys",
      A(t, "POST", { name: scope, scope }),
    )
  ).json<any>();
}
beforeEach(async () => {
  for (const x of [
    "agent_access_audit",
    "server_bots",
    "idempotency_records",
    "api_keys",
    "bot_commands",
    "bots",
    "channel_messages",
    "channel_members",
    "channels",
    "server_categories",
    "server_members",
    "servers",
    "sessions",
    "users",
  ])
    await db().exec(`DELETE FROM ${x}`);
});
describe("agent access", () => {
  it("enforces modes, revocation, and session-only key issuance", async () => {
    const t = await login("u");
    for (const mode of ["Admin", "Builder", "Operator", "Read only"]) {
      const k = await key(t, mode);
      const r = await SELF.fetch(
        "https://x/servers",
        A(k.key, "POST", { name: mode }, `server-${mode}`),
      );
      expect(r.status).toBe(["Admin", "Builder"].includes(mode) ? 201 : 401);
      expect(
        (await SELF.fetch("https://x/dev/api-keys", A(k.key))).status,
      ).toBe(401);
      await SELF.fetch(`https://x/dev/api-keys/${k.id}`, A(t, "DELETE"));
      expect((await SELF.fetch("https://x/servers", A(k.key))).status).toBe(
        401,
      );
    }
  });
  it("blocks cross-tenant access and duplicate setup", async () => {
    const a = await login("a"),
      b = await login("b"),
      ka = await key(a, "Builder"),
      kb = await key(b, "Builder");
    const one = await (
      await SELF.fetch(
        "https://x/servers",
        A(ka.key, "POST", { name: "one" }, "retry-key"),
      )
    ).json<any>();
    const two = await (
      await SELF.fetch(
        "https://x/servers",
        A(ka.key, "POST", { name: "one" }, "retry-key"),
      )
    ).json<any>();
    expect(two.id).toBe(one.id);
    expect(
      (await SELF.fetch(`https://x/servers/${one.id}`, A(kb.key))).status,
    ).toBe(404);
  });
  it("publishes discovery and rejects malformed credentials", async () => {
    expect(
      (await (await SELF.fetch("https://x/agent-api")).json<any>())
        .authentication.keyPrefix,
    ).toBe("sk_live_");
    expect((await SELF.fetch("https://x/bots", A("sk_live_bad"))).status).toBe(
      401,
    );
  });
});
