// worker/src/test/env.d.ts
//
// Type-level plumbing only (no runtime code): tells `cloudflare:test`'s
// `env` export (typed as the ambient `Cloudflare.Env`) about this
// project's actual bindings, by merging in the real `Env` interface
// `src/index.ts` already declares — so `env.DB` / `env.KV` in test files
// are the real, correctly-typed D1Database / KVNamespace, not `any`.
import type { Env as WorkerEnv } from '../index';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}

export {};
