import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../../lib/keys";
const J = { "Content-Type": "application/json" },
  db = () => env.DB as D1Database;
async function login(id: string) {
  await db()
    .prepare(
      "INSERT INTO users(id,email,username,name,password_hash,created_at,updated_at)VALUES(?,?,?,?,?,?,?)",
    )
    .bind(id, `${id}@x`, id, id, await hashPassword("password-12345"), 1, 1)
    .run();
  return (
    await (
      await SELF.fetch("https://relay.test/auth/login", {
        method: "POST",
        headers: J,
        body: JSON.stringify({ identifier: id, password: "password-12345" }),
      })
    ).json<any>()
  ).sessionToken;
}
const req = (
  token: string,
  path: string,
  method = "GET",
  body?: any,
  key?: string,
) =>
  SELF.fetch(`https://relay.test${path}`, {
    method,
    headers: {
      ...J,
      Authorization: `Bearer ${token}`,
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
beforeEach(async () => {
  for (const t of [
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
    await db().exec(`DELETE FROM ${t}`);
});
describe("fresh external agent onboarding journey", () => {
  it("uses only exported host/key/discovery to build, operate, audit, rotate, and revoke", async () => {
    const owner = await login("owner"),
      member = await login("member");
    const issued = await (
      await req(owner, "/dev/api-keys", "POST", {
        name: "Admin agent",
        scope: "Admin",
      })
    ).json<any>();
    expect(issued.key).toMatch(/^sk_live_/);
    const config = {
      host: "https://relay.test",
      key: issued.key,
      discovery: "https://relay.test/agent-api",
    };
    const discovery = await (await SELF.fetch(config.discovery)).json<any>();
    expect(
      discovery.journey.map((x: any) => `${x.method} ${x.path}`),
    ).toContain("POST /bots");
    const bot1 = await (
      await req(
        config.key,
        "/bots",
        "POST",
        { name: "Helper", username: "journey_helper" },
        "create-bot-1",
      )
    ).json<any>();
    expect(bot1.token).toBeTruthy();
    const replay = await req(
      config.key,
      "/bots",
      "POST",
      { name: "Helper", username: "journey_helper" },
      "create-bot-1",
    );
    expect(replay.status).toBe(409);
    expect((await replay.json<any>()).recovery).toBe(
      `POST /bots/${bot1.id}/rotate-token`,
    );
    const server1 = await (
      await req(
        config.key,
        "/servers",
        "POST",
        { name: "Ops" },
        "create-server-1",
      )
    ).json<any>();
    const server2 = await (
      await req(
        config.key,
        "/servers",
        "POST",
        { name: "Ops" },
        "create-server-1",
      )
    ).json<any>();
    expect(server2.id).toBe(server1.id);
    expect(
      (
        await req(config.key, `/servers/${server1.id}/members`, "POST", {
          userId: "member",
          role: "admin",
          permissions: { manageChannels: true },
        })
      ).status,
    ).toBe(201);
    const channel = await (
      await req(config.key, `/servers/${server1.id}/channels`, "POST", {
        name: "automation",
      })
    ).json<any>();
    expect(
      (
        await req(config.key, `/servers/${server1.id}/bots`, "POST", {
          botId: bot1.id,
        })
      ).status,
    ).toBe(201);
    expect((await req(config.key, `/servers/${server1.id}/bots`)).status).toBe(
      200,
    );
    expect(
      (
        await req(
          config.key,
          `/servers/${server1.id}/bots/${bot1.id}`,
          "DELETE",
        )
      ).status,
    ).toBe(204);
    expect(
      await (await req(config.key, `/servers/${server1.id}/bots`)).json<any>(),
    ).toEqual([]);
    expect(
      (
        await req(config.key, `/servers/${server1.id}/bots`, "POST", {
          botId: bot1.id,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await req(
          config.key,
          `/servers/${server1.id}/channels/${channel.id}/messages`,
          "POST",
          { text: "setup complete" },
        )
      ).status,
    ).toBe(201);
    const read = await req(
      config.key,
      `/servers/${server1.id}/channels/${channel.id}/messages`,
    );
    expect(read.status).toBe(200);
    const audit = await (
      await req(owner, `/dev/api-keys/${issued.id}/audit`)
    ).json<any>();
    expect(
      audit.some((x: any) => x.path === "/bots" && x.outcome === "allowed"),
    ).toBe(true);
    const rotated = await (
      await req(owner, `/dev/api-keys/${issued.id}/rotate`, "POST")
    ).json<any>();
    expect(
      (
        await (await req(owner, `/dev/api-keys/${issued.id}/audit`)).json<any>()
      ).some((x: any) => x.outcome === "rotated"),
    ).toBe(true);
    expect((await req(config.key, "/bots")).status).toBe(401);
    expect((await req(rotated.key, "/bots")).status).toBe(200);
    await req(owner, `/dev/api-keys/${issued.id}`, "DELETE");
    expect(
      (
        await (await req(owner, `/dev/api-keys/${issued.id}/audit`)).json<any>()
      ).some((x: any) => x.outcome === "revoked"),
    ).toBe(true);
    expect((await req(rotated.key, "/bots")).status).toBe(401);
    expect(member).toBeTruthy();
  });
  it("proves every mode at the public boundary", async () => {
    const owner = await login("modes");
    const builder = await (
      await req(owner, "/dev/api-keys", "POST", {
        name: "seed",
        scope: "Builder",
      })
    ).json<any>();
    const server = await (
      await req(
        builder.key,
        "/servers",
        "POST",
        { name: "seed" },
        "seed-server",
      )
    ).json<any>();
    const channel = await (
      await req(builder.key, `/servers/${server.id}/channels`, "POST", {
        name: "ops",
      })
    ).json<any>();
    for (const mode of ["Read only", "Operator", "Builder", "Admin"]) {
      const k = await (
        await req(owner, "/dev/api-keys", "POST", { name: mode, scope: mode })
      ).json<any>();
      expect((await req(k.key, "/bots")).status).toBe(200);
      const send = await req(
        k.key,
        `/servers/${server.id}/channels/${channel.id}/messages`,
        "POST",
        { text: mode },
      );
      expect(send.status).toBe(mode === "Read only" ? 401 : 201);
      const create = await req(
        k.key,
        "/servers",
        "POST",
        { name: mode },
        `mode-${mode}`,
      );
      expect(create.status).toBe(
        ["Admin", "Builder"].includes(mode) ? 201 : 401,
      );
      expect((await req(k.key, `/servers/${server.id}`, "DELETE")).status).toBe(
        mode === "Admin" ? 204 : 401,
      );
      if (mode === "Admin") break;
    }
  });
  it("rotates a session compatibly for installed clients and the new token survives management requests", async () => {
    const token = await login("rotate_owner");
    const rotated = await SELF.fetch("https://x/auth/rotate", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    expect(rotated.status).toBe(200);
    const body = await rotated.json<any>();
    expect(body.apiKey).toBe(body.sessionToken);
    expect(typeof body.apiKey).toBe("string");
    const oldRequest = await SELF.fetch("https://x/dev/api-keys", { headers: { Authorization: `Bearer ${token}` } });
    expect(oldRequest.status).toBe(401);
    const nextRequest = await SELF.fetch("https://x/dev/api-keys", { headers: { Authorization: `Bearer ${body.apiKey}` } });
    expect(nextRequest.status).toBe(200);
  });

});
