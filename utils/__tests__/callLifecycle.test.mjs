import test from "node:test";
import assert from "node:assert/strict";
import {
  callStatus,
  setAudioMuted,
  shouldFailDisconnected,
} from "../../callLifecycle.mjs";
test("truthful call states cover ring, connect, reconnect and outcomes", () => {
  assert.equal(
    callStatus({ state: "ringing", direction: "incoming" }),
    "Incoming voice call",
  );
  assert.equal(
    callStatus({ state: "ringing", direction: "outgoing" }),
    "Ringing…",
  );
  assert.equal(callStatus({ state: "active" }, "connected"), "Connected");
  assert.equal(
    callStatus({ state: "active" }, "disconnected"),
    "Reconnecting…",
  );
  assert.equal(
    callStatus({ state: "ended", endReason: "rejected" }),
    "Declined",
  );
  assert.equal(
    callStatus({ state: "ended", endReason: "no_answer" }),
    "Missed call",
  );
  assert.equal(
    callStatus({ state: "ended", endReason: "ice_failed" }),
    "Call failed",
  );
});
test("mute toggles every real audio track", () => {
  const tracks = [{ enabled: true }, { enabled: true }];
  assert.equal(setAudioMuted({ getAudioTracks: () => tracks }, true), 2);
  assert.deepEqual(
    tracks.map((x) => x.enabled),
    [false, false],
  );
  setAudioMuted({ getAudioTracks: () => tracks }, false);
  assert.deepEqual(
    tracks.map((x) => x.enabled),
    [true, true],
  );
});
test("disconnect grace prevents premature failure", () => {
  assert.equal(shouldFailDisconnected(1000, 12999), false);
  assert.equal(shouldFailDisconnected(1000, 13000), true);
});
