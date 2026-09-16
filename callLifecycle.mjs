export const TERMINAL_REASONS = new Set([
  "ended",
  "rejected",
  "no_answer",
  "failed",
  "ice_failed",
]);
export function callStatus(call, connection = "new") {
  if (call?.state === "ended")
    return call.endReason === "rejected"
      ? "Declined"
      : call.endReason === "no_answer"
        ? "Missed call"
        : ["failed", "ice_failed"].includes(call.endReason)
          ? "Call failed"
          : "Call ended";
  if (connection === "failed") return "Connection failed";
  if (connection === "disconnected") return "Reconnecting…";
  if (connection === "connected" || call?.state === "active")
    return "Connected";
  if (call?.state === "ringing")
    return call.direction === "incoming" ? "Incoming voice call" : "Ringing…";
  return "Connecting…";
}
export function shouldFailDisconnected(disconnectedAt, now, graceMs = 12_000) {
  return !!disconnectedAt && now - disconnectedAt >= graceMs;
}
export function setAudioMuted(stream, muted) {
  const tracks = stream?.getAudioTracks?.() ?? [];
  for (const track of tracks) track.enabled = !muted;
  return tracks.length;
}
