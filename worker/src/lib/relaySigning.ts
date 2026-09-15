// worker/src/lib/relaySigning.ts
//
// PHASE 4 — ported concept: "Relay transport / Signing / Cryptographic
// verification / Timestamp validation / Replay protection" from the
// second ZIP's Automaton Social Relay (backend/src/socialCrypto.ts,
// agent/src/social/signing.ts).
//
// What was ported vs. what was NOT:
//
//   PORTED (the idea, not the code):
//     - a namespaced canonical string per signed action, so a signature
//       collected for one purpose can never be replayed as authorization
//       for a different one
//     - HMAC-style signature + timestamp-freshness check
//     - a KV-backed nonce cache to reject replayed signed requests
//
//   NOT PORTED, on purpose:
//     - wallet signatures (secp256k1 / Ed25519, viem, tweetnacl, bs58).
//       This project authenticates users with sessions/JWTs
//       (see middleware/auth.ts), not blockchain wallets — there is no
//       wallet identity to verify against here, so that whole layer does
//       not apply and is left out rather than faked.
//
// Where this is actually used in THIS project:
//   Server Relay has no agent-to-relay or relay-to-relay network call —
//   it is a read-only view the Worker serves directly from its own D1
//   tables (see notes in routes/relay.ts). There is currently no
//   external/cross-service caller that sends the Worker a signed relay
//   request, so `verifyRelaySignature` below is not wired to a live
//   inbound route today. It IS wired, concretely, into relayCursor.ts:
//   opaque pagination cursors are HMAC-signed with `hmacSign` from this
//   file so a client cannot forge or tamper with a cursor to skip
//   pagination bounds or authorization (see relayCursor.ts). The
//   timestamp + nonce replay-guard (`verifyRelaySignature`) is kept here,
//   fully implemented and ready, for the day a signed write/ingestion
//   surface is added to the relay layer — deliberately not force-fit
//   onto today's idempotent GET polling, where a hard nonce requirement
//   would break normal client retry/resume behavior instead of
//   protecting anything.

export interface SignedRelayRequest {
  payload: string;
  timestamp: number; // ms since epoch
  nonce: string;
  signature: string;
}

const REPLAY_WINDOW_MS = 5 * 60 * 1000; // ±5 min, same window the reference used
const NONCE_TTL_SEC = 600; // 10 min — comfortably longer than the replay window

/** Derive a purpose-scoped key from a base secret instead of reusing it directly. */
async function deriveKey(secret: string, purpose: string): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const derivedBytes = await crypto.subtle.sign('HMAC', baseKey, new TextEncoder().encode(`relay:${purpose}`));
  return crypto.subtle.importKey(
    'raw', derivedBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}

export async function hmacSign(payload: string, secret: string, purpose: string): Promise<string> {
  const key = await deriveKey(secret, purpose);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return bufToHex(sig);
}

export async function hmacVerify(payload: string, signature: string, secret: string, purpose: string): Promise<boolean> {
  try {
    const key = await deriveKey(secret, purpose);
    const sigBytes = hexToBuf(signature);
    return await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payload));
  } catch {
    return false;
  }
}

/** Same freshness window the reference relay used for its signed actions. */
export function isTimestampFresh(timestamp: number, windowMs: number = REPLAY_WINDOW_MS): boolean {
  const age = Date.now() - timestamp;
  return age <= windowMs && age >= -60_000; // allow 60s of forward clock skew
}

export class RelaySignatureError extends Error {
  code: 'stale_timestamp' | 'replay_detected' | 'bad_signature';
  constructor(code: 'stale_timestamp' | 'replay_detected' | 'bad_signature', message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Full signed-request verification: timestamp freshness, nonce replay guard
 * (KV-backed), then signature check. Reserved for a future signed
 * relay-to-worker call — see file header. Not currently invoked by any
 * route.
 */
export async function verifyRelaySignature(
  req: SignedRelayRequest,
  secret: string,
  purpose: string,
  kv: KVNamespace,
): Promise<void> {
  if (!isTimestampFresh(req.timestamp)) {
    throw new RelaySignatureError('stale_timestamp', 'relay request timestamp outside allowed window');
  }

  const nonceKey = `relay_nonce:${purpose}:${req.nonce}`;
  const seen = await kv.get(nonceKey);
  if (seen) {
    throw new RelaySignatureError('replay_detected', 'relay request nonce already used');
  }

  const canonical = `${payloadCanonical(req.payload, req.timestamp, req.nonce)}`;
  const valid = await hmacVerify(canonical, req.signature, secret, purpose);
  if (!valid) {
    throw new RelaySignatureError('bad_signature', 'relay request signature invalid');
  }

  // Only recorded once the signature is confirmed valid, so a bad guess
  // can't be used to burn/lock out a legitimate nonce.
  await kv.put(nonceKey, '1', { expirationTtl: NONCE_TTL_SEC });
}

function payloadCanonical(payload: string, timestamp: number, nonce: string): string {
  // Namespacing note (ported from the reference's `Automaton:<action>:` prefixing):
  // the caller-supplied `purpose` is mixed into the derived key, not into
  // this string, which keeps this helper action-agnostic while still
  // making a signature collected for one purpose unusable for another.
  return `${payload}:${timestamp}:${nonce}`;
}

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function hexToBuf(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}
