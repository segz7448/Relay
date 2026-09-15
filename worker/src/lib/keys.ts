// Key generation using Web Crypto (CF Worker safe)

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function uid(): string {
  return randomHex(12);
}

export async function hashPassword(password: string): Promise<string> {
  // PBKDF2 with SHA-256 — secure, CF Worker compatible
  const salt = randomHex(16);
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const hash = Array.from(new Uint8Array(derived)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${salt}:${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, expectedHash] = stored.split(':');
  if (!salt || !expectedHash) return false;
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const hash = Array.from(new Uint8Array(derived)).map(b => b.toString(16).padStart(2, '0')).join('');
  return hash === expectedHash;
}

export async function hashToken(raw: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function generateApiKey(): { raw: string; prefix: string } {
  const raw = `sk_live_${randomHex(32)}`;
  return { raw, prefix: raw.slice(0, 14) };
}

export function generateBotToken(): { raw: string; prefix: string } {
  const id = Math.floor(1_000_000_000 + Math.random() * 8_000_000_000);
  const raw = `${id}:${randomHex(20)}`;
  return { raw, prefix: raw.slice(0, 12) };
}

export function generateWebhookSecret(): { raw: string; prefix: string } {
  const raw = `whsec_${randomHex(24)}`;
  return { raw, prefix: raw.slice(0, 12) };
}

export function generateInviteCode(): string {
  return randomHex(4).toUpperCase() + '-' + randomHex(3).toUpperCase();
}
