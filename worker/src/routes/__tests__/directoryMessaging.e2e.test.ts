import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../../lib/keys";
const db = () => env.DB as D1Database;
const J = { "Content-Type": "application/json" };
async function createAndLogin(id: string) {
  await db().prepare("INSERT INTO users(id,email,username,name,bio,password_hash,created_at,updated_at)VALUES(?,?,?,?,?,?,?,?)")
    .bind(id, `${id}@x`, id, id === "alice" ? "Alice" : "Bob", `${id} bio`, await hashPassword("password-12345"), 1, 1).run();
  const res = await SELF.fetch("https://x/auth/login", { method: "POST", headers: J, body: JSON.stringify({ identifier: id, password: "password-12345" }) });
  return (await res.json<any>()).sessionToken as string;
}
const A = (token: string, method = "GET", body?: unknown) => ({ method, headers: { ...J, Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
beforeEach(async () => { for (const table of ["messages", "conversations", "sessions", "users"]) await db().exec(`DELETE FROM ${table}`); });
describe("directory profile to direct message", () => {
  it("searches public profiles, opens one, creates an idempotent pair, and delivers both directions", async () => {
    const alice = await createAndLogin("alice");
    const bob = await createAndLogin("bob");
    const found = await (await SELF.fetch("https://x/accounts/directory?q=bob", A(alice))).json<any[]>();
    expect(found).toEqual([{ id: "bob", username: "bob", name: "Bob", bio: "bob bio", photoUrl: null }]);
    expect(await (await SELF.fetch("https://x/accounts/directory/bob", A(alice))).json()).toEqual(found[0]);
    await db().prepare("INSERT INTO conversations(id,user_id,kind,name,ref_id,created_at,updated_at) VALUES('old-dm','alice','direct','Bob','bob',1,1)").run();
    const first = await (await SELF.fetch("https://x/conversations/direct", A(alice, "POST", { userId: "bob" }))).json<any>();
    expect(first.id).toBe("old-dm");
    const retry = await (await SELF.fetch("https://x/conversations/direct", A(alice, "POST", { userId: "bob" }))).json<any>();
    expect(retry.id).toBe(first.id);
    const peer = await db().prepare("SELECT id FROM conversations WHERE user_id='bob' AND ref_id='alice'").first<any>();
    expect(peer?.id).toBeTruthy();
    expect((await SELF.fetch(`https://x/conversations/${first.id}/messages`, A(alice, "POST", { text: "hello bob" }))).status).toBe(201);
    for (const body of [
      { attachmentType: "location", attachmentName: "Location", attachmentData: { coords: { lat: 37.7749, lng: -122.4194 } } },
      { attachmentType: "contact", attachmentName: "Ada", attachmentData: { contact: { name: "Ada Lovelace", phone: "+1 555 0100" } } },
    ]) expect((await SELF.fetch(`https://x/conversations/${first.id}/messages`, A(alice, "POST", body))).status).toBe(201);
    const image = new File([new Uint8Array([137,80,78,71,13,10,26,10])], "tiny.png", { type: "image/png" });
    const form = new FormData(); form.set("file", image);
    const upload = await (await SELF.fetch("https://x/files/upload", { method: "POST", headers: { Authorization: `Bearer ${alice}` }, body: form })).json<any>();
    expect((await SELF.fetch(upload.url, A(bob))).status).toBe(404);
    expect((await SELF.fetch(`https://x/conversations/${first.id}/messages`, A(alice, "POST", { attachmentUrl: upload.url, attachmentType: "image", attachmentName: "tiny.png", attachmentSize: 8 }))).status).toBe(201);
    expect((await SELF.fetch(upload.url, A(bob))).status).toBe(200);
    const inbox = await (await SELF.fetch(`https://x/conversations/${peer.id}/messages`, A(bob))).json<any>();
    expect(inbox.messages[0]).toMatchObject({ text: "hello bob", dir: "in", senderId: "alice" });
    expect(inbox.messages[1].attachment).toMatchObject({ kind: "location", coords: { lat: 37.7749, lng: -122.4194 } });
    expect(inbox.messages[2].attachment).toMatchObject({ kind: "contact", contact: { name: "Ada Lovelace", phone: "+1 555 0100" } });
    expect(inbox.messages[3].attachment).toMatchObject({ kind: "image", uri: upload.url });
    const persisted = await db().prepare("SELECT attachment_type,attachment_data FROM messages WHERE conversation_id=? ORDER BY created_at ASC").bind(peer.id).all<any>();
    expect(persisted.results.map((row) => row.attachment_type)).toEqual([null, "location", "contact", "image"]);
  });
});
