import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { apiKeyFromCreate, apiKeyFromWire } from "../apiContracts.mjs";
test("api key wire/create normalization preserves one-time secret", () => {
  assert.deepEqual(
    apiKeyFromWire({
      id: "1",
      name: "x",
      key_prefix: "sk_live_ab",
      scope: "Builder",
      revoked: 0,
      created_at: 1,
    }),
    {
      id: "1",
      name: "x",
      prefix: "sk_live_ab",
      scope: "Builder",
      lastUsedAt: null,
      revoked: false,
      createdAt: 1,
    },
  );
  assert.equal(
    apiKeyFromCreate({
      id: "1",
      name: "x",
      key: "secret",
      prefix: "p",
      scope: "Builder",
    }).secret,
    "secret",
  );
});
test("four real tabs and native voice dependencies are declared", () => {
  const tabs = readFileSync("app/(tabs)/_layout.jsx", "utf8");
  const bar = readFileSync("components/GlassTabBar.jsx", "utf8");
  const icons = readFileSync("components/RelayTabIcon.jsx", "utf8");
  for (const label of ["Messages", "Calls", "Server Relay", "Settings"])
    assert.ok(bar.includes(label), label);
  assert.ok(bar.includes("BlurView"));
  assert.ok(bar.includes("chipActive"));
  assert.ok(icons.includes("react-native-svg"));
  assert.ok(icons.includes("Circle"));
  for (const n of ["index", "calls", "relay", "settings"])
    assert.match(tabs, new RegExp(`name=["']${n}["']`));
  const app = JSON.parse(readFileSync("app.json"));
  assert.ok(app.expo.android.permissions.includes("RECORD_AUDIO"));
  assert.match(readFileSync("package.json", "utf8"), /react-native-webrtc/);
});
test("TURN remains explicit rather than implied production reliability", () => {
  assert.match(readFileSync("callEngine.js", "utf8"), /configuredTurn/);
  assert.match(
    readFileSync("worker/README.md", "utf8"),
    /not production-reliable/,
  );
});

test("connection screen implements selected Midnight Console lifecycle", () => {
  const x = readFileSync("app/agent-connection.jsx", "utf8");
  const icons = readFileSync("components/AgentConsoleIcon.jsx", "utf8");
  for (const label of [
    "Agent Control",
    "EDGE CONNECTION",
    "ACCESS PROFILE",
    "GENERATE KEY",
    "CREDENTIALS",
    "BOOTSTRAP",
    "ONE-TIME ACCESS KEY",
    "AUDIT",
    "Rotate",
    "Revoke",
    "Copy full agent bootstrap configuration",
    "Back to Settings",
    "accessibilityLiveRegion",
  ])
    assert.ok(x.includes(label), label);
  for (const state of ["loading", "error", "ready", "NO ACTIVE KEYS"])
    assert.ok(x.includes(state), state);
  for (const mode of ["Admin", "Builder", "Operator", "Read only"])
    assert.ok(readFileSync("agentConnection.js", "utf8").includes(mode));
  for (const icon of [
    "relay",
    "key",
    "copy",
    "rotate",
    "audit",
    "trash",
    "shield",
    "retry",
    "back",
  ])
    assert.ok(icons.includes(`name === "${icon}"`), icon);
  assert.ok(icons.includes("react-native-svg"));
});
test("profile photo screen renders local selection and persisted remote URLs", () => {
  const x = readFileSync("app/edit-profile.jsx", "utf8");
  for (const contract of [
    'form.append("photo"',
    "remote.photoUrl",
    "api.removePhoto()",
    'typeof photo === "string" ? photo : photo?.uri',
  ])
    assert.ok(x.includes(contract), contract);
});

test('profile relogin hydrates persisted photo and every person avatar uses the resilient Avatar component', () => {
  const auth = readFileSync('authApi.js', 'utf8');
  const login = readFileSync('app/auth/login.jsx', 'utf8');
  const avatar = readFileSync('components/Avatar.jsx', 'utf8');
  const contact = readFileSync('app/contact/[id].jsx', 'utf8');
  assert.ok(auth.includes('photo: res.photoUrl || null'));
  assert.ok(login.includes('photo: signedIn.photo || null'));
  assert.ok(avatar.includes('useEffect(() => setFailed(false), [uri])'));
  assert.ok(contact.includes('<Avatar uri={person?.photo || person?.photoUrl}'));
});
