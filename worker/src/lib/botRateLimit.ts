export interface LimitResult { allowed: boolean; retryAfter: number; remaining: number }

async function consume(kv: KVNamespace, key: string, limit: number, windowSec: number): Promise<LimitResult> {
  const bucket = Math.floor(Date.now() / (windowSec * 1000));
  const storageKey = `botrl:${key}:${bucket}`;
  const count = Number(await kv.get(storageKey) ?? '0');
  if (count >= limit) return { allowed: false, remaining: 0, retryAfter: windowSec - Math.floor((Date.now() / 1000) % windowSec) };
  await kv.put(storageKey, String(count + 1), { expirationTtl: Math.max(60, windowSec * 2) });
  return { allowed: true, remaining: Math.max(0, limit - count - 1), retryAfter: 0 };
}

export async function checkBotLimits(kv: KVNamespace, options: { surface: string; botId?: string; botUserId?: string; ip: string; limit?: number; windowSec?: number }): Promise<LimitResult> {
  const limit = options.limit ?? 60;
  const windowSec = options.windowSec ?? 60;
  const keys = [`${options.surface}:ip:${options.ip || 'unknown'}`];
  if (options.botId) keys.push(`${options.surface}:bot:${options.botId}`);
  if (options.botUserId) keys.push(`${options.surface}:user:${options.botUserId}`);
  for (const key of keys) {
    const result = await consume(kv, key, limit, windowSec);
    if (!result.allowed) return result;
  }
  return { allowed: true, remaining: limit - 1, retryAfter: 0 };
}

export function requestIp(req: Request): string {
  return req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
}
