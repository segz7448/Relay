// worker/vitest.config.ts
//
// PHASE 7 — real Miniflare/Workers test-pool harness.
//
// Closes the second remaining issue flagged since Phase 5: "No Miniflare/
// Workers test-pool harness exists in this project — today's tests run
// against real modules with lightweight D1/KV fakes, not full HTTP
// integration tests." That's fixed here: tests now run inside the actual
// Workers runtime (via `@cloudflare/vitest-pool-workers`, which wraps
// Miniflare) against a REAL D1 database and REAL KV namespace — the same
// SQLite-backed D1 implementation Cloudflare uses for `wrangler dev`, not
// a hand-rolled substitute. `src/lib/__tests__/fakes.ts` and every test
// that used it have been deleted; nothing in this test suite mocks or
// fakes D1, KV, crypto, or the Hono app itself.
//
// Bindings come from this project's own `wrangler.toml` (same D1/KV/R2
// binding names — `DB` / `KV` / `BUCKET` — the deployed Worker uses), so
// there's no separate/parallel binding config to drift out of sync with
// production. `JWT_SECRET` isn't in wrangler.toml (it's a deploy-time
// secret, never committed — see wrangler.toml's own comment), so it's
// supplied here as a miniflare override purely for the local test
// instance; it is not a real secret and is not used anywhere else.

import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          JWT_SECRET: 'vitest-local-test-secret-do-not-use-in-prod',
          FCM_SERVER_KEY: 'unused-in-tests',
        },
      },
    }),
  ],
  test: {
    setupFiles: ['./src/test/applySchema.ts'],
  },
});
