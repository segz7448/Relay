const TRANSIENT_D1 = /busy|locked|timeout|temporar|internal error|network|connection/i;
export class ServiceError extends Error {
  constructor(public code: string, public status: 503 | 500, message: string, public retryable = false) { super(message); }
}
export function classifyServiceError(error: unknown): ServiceError {
  const message = error instanceof Error ? error.message : String(error);
  if (TRANSIENT_D1.test(message)) return new ServiceError('database_temporarily_unavailable', 503, 'Database temporarily unavailable', true);
  if (/no such table|no such column/i.test(message)) return new ServiceError('database_schema_not_ready', 503, 'Database schema not ready');
  if (/binding|undefined.*DB|JWT_SECRET/i.test(message)) return new ServiceError('worker_configuration_error', 503, 'Worker configuration incomplete');
  return new ServiceError('internal_server_error', 500, 'Internal server error');
}
export async function retryD1Read<T>(operation: () => Promise<T>, retries = 2): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      last = error;
      if (!TRANSIENT_D1.test(error instanceof Error ? error.message : String(error)) || attempt === retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5 * (attempt + 1)));
    }
  }
  throw last;
}
export async function readiness(env: { DB?: D1Database; KV?: KVNamespace; BUCKET?: R2Bucket; JWT_SECRET?: string; TURN_KEY_ID?: string; TURN_KEY_API_TOKEN?: string }) {
  const missing = ['DB','KV','BUCKET','JWT_SECRET'].filter((name) => !(env as any)[name]);
  if (missing.length) return { ok: false as const, code: 'missing_required_binding', missing };
  const required = ['users','sessions','api_keys','bots','conversations','messages','servers'];
  const placeholders = required.map(() => '?').join(',');
  const rows = await retryD1Read(() => env.DB!.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${placeholders})`).bind(...required).all<{name:string}>());
  const found = new Set(rows.results.map((row) => row.name));
  const absent = required.filter((name) => !found.has(name));
  if (absent.length) return { ok: false as const, code: 'database_schema_not_ready', missingTables: absent };
  return { ok: true as const, services: { worker: 'ready', database: 'ready', kv: 'bound', bucket: 'bound', turn: env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN ? 'configured' : 'optional_unconfigured' } };
}
