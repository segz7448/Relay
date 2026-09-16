const sessions = new Map();
export function holdCallSession(callId, value) {
  sessions.set(String(callId), value);
}
export function takeCallSession(callId) {
  const key = String(callId),
    v = sessions.get(key);
  sessions.delete(key);
  return v;
}
