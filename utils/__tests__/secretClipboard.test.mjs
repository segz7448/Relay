import test from "node:test";
import assert from "node:assert/strict";
import {
  copyExactSecret,
  canCloseSecret,
  configWithSecret,
} from "../secretClipboard.mjs";
test("copies and verifies every byte of the generated secret", async () => {
  let value = "";
  const key = "sk_live_FULL_abc123+/=_not_masked";
  const copied = await copyExactSecret(
    {
      setStringAsync: async (x) => (value = x),
      getStringAsync: async () => value,
    },
    key,
  );
  assert.equal(copied, key);
  assert.equal(value, key);
});
test("clipboard failure and mismatched readback remain retryable", async () => {
  await assert.rejects(
    copyExactSecret(
      {
        setStringAsync: async () => {
          throw Error("denied");
        },
      },
      "full",
    ),
    /denied/,
  );
  await assert.rejects(
    copyExactSecret(
      {
        setStringAsync: async () => {},
        getStringAsync: async () => "truncated",
      },
      "full",
    ),
    /verification/,
  );
  let v = "";
  assert.equal(
    await copyExactSecret(
      { setStringAsync: async (x) => (v = x), getStringAsync: async () => v },
      "full",
    ),
    "full",
  );
});
test("uncopied secret cannot close without explicit acknowledgement", () => {
  assert.equal(canCloseSecret({ copied: false, acknowledged: false }), false);
  assert.equal(canCloseSecret({ copied: true, acknowledged: false }), true);
  assert.equal(canCloseSecret({ copied: false, acknowledged: true }), true);
});
test("bootstrap contains exact secret and rejects masked values", () => {
  const make = (x) => `KEY=${x}`;
  assert.equal(
    configWithSecret(make, "sk_live_COMPLETE"),
    "KEY=sk_live_COMPLETE",
  );
  assert.throws(() => configWithSecret(make, "sk_live_••••"));
  assert.throws(() => configWithSecret(make, "<ACCESS_KEY>"));
});
