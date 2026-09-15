// worker/src/test/sql-raw.d.ts
//
// Type-level only: Vite's `?raw` import suffix (used by
// src/test/applySchema.ts to pull db/schema.sql in as a plain string)
// has no built-in TypeScript declaration — this is the standard ambient
// module shim Vite's own docs recommend for it.
declare module '*.sql?raw' {
  const content: string;
  export default content;
}
