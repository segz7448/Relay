import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../../lib/keys";
const db = () => env.DB as D1Database,
  J = { "Content-Type": "application/json" };
async function login() {
  await db()
    .prepare(
      "INSERT INTO users(id,email,username,name,password_hash,created_at,updated_at)VALUES(?,?,?,?,?,?,?)",
    )
    .bind(
      "state",
      "s@x",
      "state",
      "State",
      await hashPassword("password-12345"),
      1,
      1,
    )
    .run();
  return (
    await (
      await SELF.fetch("https://x/auth/login", {
        method: "POST",
        headers: J,
        body: JSON.stringify({
          identifier: "state",
          password: "password-12345",
        }),
      })
    ).json<any>()
  ).sessionToken;
}
const A = (t: string, m = "GET", b?: any) => ({
  method: m,
  headers: { ...J, Authorization: `Bearer ${t}` },
  ...(b ? { body: JSON.stringify(b) } : {}),
});
beforeEach(async () => {
  for (const t of ["messages", "conversations", "sessions", "users"])
    await db().exec(`DELETE FROM ${t}`);
});
describe("visible conversation lifecycle", () => {
  it("persists pin, mute, unread and deletion through public HTTP", async () => {
    const t = await login();
    const c = await (
      await SELF.fetch(
        "https://x/conversations",
        A(t, "POST", { kind: "direct", name: "Peer" }),
      )
    ).json<any>();
    for (const patch of [{ pinned: true }, { muted: true }, { unreadCount: 3 }])
      expect(
        (
          await SELF.fetch(
            `https://x/conversations/${c.id}`,
            A(t, "PATCH", patch),
          )
        ).status,
      ).toBe(200);
    const row = await db()
      .prepare("SELECT pinned,muted,unread_count FROM conversations WHERE id=?")
      .bind(c.id)
      .first<any>();
    expect(row).toEqual({ pinned: 1, muted: 1, unread_count: 3 });
    expect(
      (await SELF.fetch(`https://x/conversations/${c.id}`, A(t, "DELETE")))
        .status,
    ).toBe(204);
    expect(
      await db()
        .prepare("SELECT id FROM conversations WHERE id=?")
        .bind(c.id)
        .first(),
    ).toBeNull();
  });
});
