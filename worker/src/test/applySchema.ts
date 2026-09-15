// worker/src/test/applySchema.ts
//
// Runs once per test file (vitest `setupFiles`), inside the real Workers
// runtime, against the real local D1 instance the pool provisions from
// wrangler.toml's `DB` binding. Applies the project's actual
// `db/schema.sql` — the exact same file `npm run db:migrate` runs against
// a real database — so tests exercise the real schema, not a hand-typed
// approximation of it.

import { env } from 'cloudflare:test';
import schemaSql from '../db/schema.sql?raw';

// D1's `.exec()` only accepts one complete, single-line statement per
// call — it does not parse `;`-terminated multi-statement batches, and a
// statement that itself spans multiple physical lines (every CREATE
// TABLE in schema.sql is written one-column-per-line for readability) is
// read as "incomplete". None of that changes the DDL itself: strip `--`
// comments (both whole-line and trailing-after-code, e.g. schema.sql's
// `date TEXT NOT NULL, -- YYYY-MM-DD`) and PRAGMA lines, collapse each
// remaining statement's internal whitespace to single spaces, then run
// each one individually, in schema order (later tables reference earlier
// ones via FK).
const withoutCommentsOrPragmas = schemaSql
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .filter((line) => !/^\s*PRAGMA/i.test(line))
  .join('\n');

const statements = withoutCommentsOrPragmas
  .split(';')
  .map((s) => s.trim())
  .filter((s) => s.length > 0)
  // D1's `.exec()` only accepts statements separated by newlines — it does
  // NOT parse a statement that itself spans multiple physical lines (every
  // CREATE TABLE in schema.sql is formatted one-column-per-line for human
  // readability). Collapsing internal whitespace to single spaces changes
  // nothing SQL-semantic, it just makes each statement fit on one line the
  // way `.exec()` expects; the actual DDL — table/column names, types,
  // constraints, defaults — is untouched.
  .map((s) => s.replace(/\s+/g, ' '));

// D1's `.exec()` runs exactly one statement per call — batching multiple
// `;`-terminated statements into one call (even one-per-line) isn't
// supported, so each is executed individually, in schema order (later
// tables reference earlier ones via FK, so order matters).
for (const statement of statements) {
  await env.DB.exec(`${statement};`);
}
