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
    .bind(
      id,
      `${id}@x.test`,
      id,
      id,
      await hashPassword("password-12345"),
      1,
      1,
    )
    .run();
  const r = await SELF.fetch("https://x/auth/login", {
    method: "POST",
    headers: J,
    body: JSON.stringify({ identifier: id, password: "password-12345" }),
  });
  return (await r.json<any>()).sessionToken;
}
const A = (t: string, m = "GET", b?: any) => ({
  method: m,
  headers: { ...J, Authorization: `Bearer ${t}` },
  ...(b ? { body: JSON.stringify(b) } : {}),
});
beforeEach(async () => {
  for (const t of [
    "call_ice_candidates",
    "calls",
    "call_logs",
    "sessions",
    "users",
  ])
    await db().exec(`DELETE FROM ${t}`);
});
describe("voice call signaling", () => {
  it("enforces participants and the offer-answer-ice-end state machine", async () => {
    const caller = await login("caller"),
      callee = await login("callee"),
      outsider = await login("outsider");
    const created = await (
      await SELF.fetch(
        "https://x/calls",
        A(caller, "POST", {
          calleeId: "callee",
          offer: { type: "offer", sdp: "offer-sdp" },
        }),
      )
    ).json<any>();
    expect(created.state).toBe("ringing");
    expect(
      (await SELF.fetch(`https://x/calls/${created.id}`, A(outsider))).status,
    ).toBe(404);
    expect(
      (
        await SELF.fetch(
          `https://x/calls/${created.id}/answer`,
          A(caller, "POST", { answer: { type: "answer", sdp: "x" } }),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await SELF.fetch(
          `https://x/calls/${created.id}/answer`,
          A(callee, "POST", { answer: { type: "answer", sdp: "answer-sdp" } }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await SELF.fetch(
          `https://x/calls/${created.id}/ice`,
          A(caller, "POST", { candidate: { candidate: "candidate" } }),
        )
      ).status,
    ).toBe(201);
    const ice = await (
      await SELF.fetch(`https://x/calls/${created.id}/ice`, A(callee))
    ).json<any>();
    expect(ice[0].candidate.candidate).toBe("candidate");
    expect(
      (
        await SELF.fetch(
          `https://x/calls/${created.id}/end`,
          A(caller, "POST", { reason: "ended" }),
        )
      ).status,
    ).toBe(200);
    expect(
      (await db().prepare("SELECT count(*) n FROM call_logs").first<any>()).n,
    ).toBe(2);
  });
  it("persists declined, failed, completed and duplicate hangup exactly once", async () => {
    const caller = await login("outcome_caller"),
      callee = await login("outcome_callee");
    for (const [i, reason, answer] of [
      [1, "rejected", false],
      [2, "failed", false],
      [3, "ended", true],
    ] as const) {
      const created = await (
        await SELF.fetch(
          "https://x/calls",
          A(caller, "POST", {
            calleeId: "outcome_callee",
            offer: { type: "offer", sdp: String(i) },
          }),
        )
      ).json<any>();
      if (answer)
        await SELF.fetch(
          `https://x/calls/${created.id}/answer`,
          A(callee, "POST", { answer: { type: "answer", sdp: "ok" } }),
        );
      expect(
        (
          await SELF.fetch(
            `https://x/calls/${created.id}/end`,
            A(answer ? caller : callee, "POST", { reason }),
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await SELF.fetch(
            `https://x/calls/${created.id}/end`,
            A(caller, "POST", { reason }),
          )
        ).status,
      ).toBe(200);
    }
    const rows = await db()
      .prepare(
        "SELECT status,count(*) n FROM call_logs GROUP BY status ORDER BY status",
      )
      .all<any>();
    expect(rows.results).toEqual([
      { status: "completed", n: 2 },
      { status: "declined", n: 2 },
      { status: "failed", n: 2 },
    ]);
  });
  it("rejects self calls, unknown users, and busy participants", async () => {
    const a = await login("a"),
      b = await login("b");
    expect(
      (
        await SELF.fetch(
          "https://x/calls",
          A(a, "POST", { calleeId: "a", offer: {} }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await SELF.fetch(
          "https://x/calls",
          A(a, "POST", { calleeId: "missing", offer: {} }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await SELF.fetch(
          "https://x/calls",
          A(a, "POST", { calleeId: "b", offer: {} }),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await SELF.fetch(
          "https://x/calls",
          A(a, "POST", { calleeId: "b", offer: {} }),
        )
      ).status,
    ).toBe(409);
  });
});
describe("profile photos", () => {
  const png = (tail = 1) => new Uint8Array([137,80,78,71,13,10,26,10,tail]);
  async function upload(t: string, file: File) {
    const form = new FormData(); form.set("photo", file);
    return SELF.fetch("https://x/accounts/me/photo", { method: "POST", headers: { Authorization: `Bearer ${t}` }, body: form });
  }
  it("validates real bytes and rejects missing, malformed, unsupported, empty, and oversized input", async () => {
    const t = await login("photo_invalid");
    expect((await SELF.fetch("https://x/accounts/me/photo", { method: "POST", headers: { Authorization: `Bearer ${t}` }, body: new FormData() })).status).toBe(400);
    expect((await upload(t, new File(["x"], "x.txt", { type: "text/plain" }))).status).toBe(415);
    expect((await upload(t, new File([], "empty.png", { type: "image/png" }))).status).toBe(413);
    expect((await upload(t, new File([new Uint8Array([1,2,3])], "lying.png", { type: "image/png" }))).status).toBe(422);
    expect((await upload(t, new File([new Uint8Array(5 * 1024 * 1024 + 1)], "huge.png", { type: "image/png" }))).status).toBe(413);
  });
  it("stores picker bytes in R2, persists through a new login, serves metadata, replaces without stale cache, and removes", async () => {
    const t = await login("photo");
    const firstResponse = await upload(t, new File([png(1)], "picker.png", { type: "image/png" }));
    expect(firstResponse.status).toBe(201);
    const first = await firstResponse.json<any>();
    expect(first.photoUrl).toMatch(/^https:\/\/x\/accounts\/photos\/photo\?v=[0-9a-f-]+$/);
    const firstAsset = await SELF.fetch(first.photoUrl);
    expect(firstAsset.status).toBe(200);
    expect(firstAsset.headers.get("content-type")).toBe("image/png");
    expect(firstAsset.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await firstAsset.arrayBuffer())).toEqual(png(1));

    const relogin = await (await SELF.fetch("https://x/auth/login", { method: "POST", headers: J, body: JSON.stringify({ identifier: "photo", password: "password-12345" }) })).json<any>();
    expect((await (await SELF.fetch("https://x/accounts/me", A(relogin.sessionToken))).json<any>()).photoUrl).toBe(first.photoUrl);

    const secondResponse = await upload(relogin.sessionToken, new File([png(2)], "replacement.png", { type: "image/png" }));
    expect(secondResponse.status).toBe(201);
    const second = await secondResponse.json<any>();
    expect(second.photoUrl).not.toBe(first.photoUrl);
    expect(new Uint8Array(await (await SELF.fetch(second.photoUrl)).arrayBuffer())).toEqual(png(2));
    expect((await (await SELF.fetch("https://x/accounts/me", A(relogin.sessionToken))).json<any>()).photoUrl).toBe(second.photoUrl);

    expect((await SELF.fetch("https://x/accounts/me/photo", A(relogin.sessionToken, "DELETE"))).status).toBe(200);
    expect((await (await SELF.fetch("https://x/accounts/me", A(relogin.sessionToken))).json<any>()).photoUrl).toBeNull();
    expect((await SELF.fetch(second.photoUrl)).status).toBe(404);
  });
});
