// PHASE 5 — Test cursor manipulation resistance ("Cursor manipulation" /
// "Message duplication" in the spec's prevent-list). This logic shipped
// in Phase 4 (relayCursor.ts) but had no test coverage until Phase 5's
// "Test relay pagination" / "Test relay polling" pass.

import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor } from '../relayCursor';

const SECRET = 'test-secret-do-not-use-in-prod';

describe('relay cursor signing', () => {
  it('round-trips a valid cursor', async () => {
    const encoded = await encodeCursor({ created_at: 1000, id: 'msg_1' }, SECRET);
    const decoded = await decodeCursor(encoded, SECRET);
    expect(decoded).toEqual({ ts: 1000, id: 'msg_1' });
  });

  it('rejects a hand-edited cursor (tampered payload, same-looking signature slot)', async () => {
    const encoded = await encodeCursor({ created_at: 1000, id: 'msg_1' }, SECRET);
    // Decode, bump the timestamp to try to skip further back in history /
    // authorization bounds, re-encode without re-signing (what an
    // attacker without the secret would have to do).
    const raw = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
    const [, id, sig] = raw.split(':');
    const tamperedRaw = `999999:${id}:${sig}`;
    const tampered = btoa(tamperedRaw)
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    const decoded = await decodeCursor(tampered, SECRET);
    expect(decoded).toBeNull();
  });

  it('rejects a cursor signed with a different secret', async () => {
    const encoded = await encodeCursor({ created_at: 1000, id: 'msg_1' }, 'other-secret');
    const decoded = await decodeCursor(encoded, SECRET);
    expect(decoded).toBeNull();
  });

  it('rejects malformed / garbage cursor strings without throwing', async () => {
    await expect(decodeCursor('not-a-real-cursor', SECRET)).resolves.toBeNull();
    await expect(decodeCursor('', SECRET)).resolves.toBeNull();
  });
});
