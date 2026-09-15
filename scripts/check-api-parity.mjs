// scripts/check-api-parity.mjs — frontend/backend route parity (bmd.md
// Phase 24). Fails (exit 1) if any function in the frontend API client
// calls a method+path the Worker does not register. Worker routes with
// no frontend caller are listed as informational only: bot-runtime
// routes are called by external bot code, and the public webhook
// receiver is called by Telegram-style senders, not by this app.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

// ── Worker routes ─────────────────────────────────────────────────────
// 1. Mount table from src/index.ts: `app.route('/prefix', identifier)`
//    plus the import that ties the identifier to a routes file.
const indexSrc = readFileSync(join(root, 'worker/src/index.ts'), 'utf8');
const importRe = /import\s+(\w+)\s+from\s+'\.\/routes\/(\w+)'/g;
const namedImportRe = /import\s+\{([^}]+)\}\s+from\s+'\.\/routes\/(\w+)'/g;
const routeRe = /app\.route\('([^']+)',\s*(\w+)\)/g;

const identToFile = new Map();
for (const m of indexSrc.matchAll(importRe)) identToFile.set(m[1], m[2]);
for (const m of indexSrc.matchAll(namedImportRe)) {
  for (const name of m[1].split(',').map((s) => s.trim()).filter(Boolean)) identToFile.set(name, m[2]);
}

const mounts = []; // { prefix, file, routerIdent }
for (const m of indexSrc.matchAll(routeRe)) {
  const file = identToFile.get(m[2]);
  if (!file) throw new Error(`cannot resolve routes file for ${m[2]}`);
  mounts.push({ prefix: m[1], file, routerIdent: m[2] });
}

// 2. Route registrations per file: `ident.method('path'` — the ident is
//    the local Hono instance name, resolved per file by scanning.
const METHODS = ['get', 'post', 'patch', 'put', 'delete'];
const workerRoutes = new Set(); // "METHOD /prefix/path"
for (const { prefix, file, routerIdent } of mounts) {
  const src = readFileSync(join(root, `worker/src/routes/${file}.ts`), 'utf8');
  // other.ts defines several routers (privacy/dev/stats/files/webhook) —
  // match only registrations on this mount's own router identifier.
  const re = new RegExp(`${routerIdent === 'privacy' || routerIdent === 'dev' || routerIdent === 'stats' || routerIdent === 'files' || routerIdent === 'webhook' ? routerIdent : '\\w+'}\\.(get|post|patch|put|delete)\\('([^']*)'`, 'g');
  for (const m of src.matchAll(re)) {
    workerRoutes.add(`${m[1].toUpperCase()} ${prefix}${m[2]}`);
  }
}

// ── Frontend client calls ─────────────────────────────────────────────
// api.js: request('/path', { method: 'X' }) / upload('/path') (POST).
// Calls are extracted with a balanced-paren scan (regex can't handle the
// nested template literals used for query strings), then the path
// argument is normalized: simple `${param}` interpolations become {},
// anything from a literal '?' or a complex `${...expr...}` (always a
// conditional query string in this codebase) is cut.
const apiSrc = readFileSync(join(root, 'api.js'), 'utf8');

function extractCalls(src) {
  const calls = [];
  let i = 0;
  while (i < src.length) {
    const reqIdx = src.indexOf('request(', i);
    const upIdx = src.indexOf('upload(', i);
    let idx = -1;
    let fn = null;
    if (reqIdx === -1 && upIdx === -1) break;
    if (upIdx !== -1 && (reqIdx === -1 || upIdx < reqIdx)) { idx = upIdx; fn = 'upload'; }
    else { idx = reqIdx; fn = 'request'; }
    // scan to the matching close paren, respecting strings/templates
    let depth = 0;
    let j = idx + fn.length; // at '('
    let quote = null;
    for (; j < src.length; j++) {
      const ch = src[j];
      if (quote) {
        if (ch === '\\') { j++; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth === 0) break; }
    }
    calls.push({ fn, args: src.slice(idx + fn.length + 1, j) });
    i = j + 1;
  }
  return calls;
}

function normalizeClientPath(args) {
  const t = args.trim();
  const quote = t[0];
  if (quote !== "'" && quote !== '`') return null;
  // find the end of the first string/template argument
  let body = '';
  let k = 1;
  let depth = 0;
  for (; k < t.length; k++) {
    const ch = t[k];
    if (depth > 0) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      if (depth === 0) body += '\u0001'; // mark a complex ${...}
      continue;
    }
    if (ch === quote) break;
    if (quote === '`' && ch === '$' && t[k + 1] === '{') {
      // read the expression to decide simple-param vs complex
      let d = 1;
      let e = k + 2;
      let expr = '';
      for (; e < t.length; e++) {
        if (t[e] === '{') d++;
        else if (t[e] === '}') { d--; if (d === 0) break; }
        expr += t[e];
      }
      if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(expr)) body += '{}';
      else body += '\u0001';
      k = e;
      continue;
    }
    body += ch;
  }
  // cut at the first literal query marker or complex-expression marker
  const cut = body.search(/[?\u0001]/);
  if (cut !== -1) body = body.slice(0, cut);
  return body;
}

const clientCalls = []; // { method, path }
for (const call of extractCalls(apiSrc)) {
  const path = normalizeClientPath(call.args);
  if (!path) continue;
  let method = call.fn === 'upload' ? 'POST' : 'GET';
  const mm = /method:\s*'(\w+)'/.exec(call.args);
  if (mm) method = mm[1].toUpperCase();
  clientCalls.push({ method, path });
}

// ── Normalize + diff ──────────────────────────────────────────────────
const norm = (p) => p.replace(/:[^/{}]+/g, '{}').replace(/\{\+\}/g, '{}').replace(/\/+$/, '') || '/';
const workerNorm = new Set([...workerRoutes].map((r) => {
  const [method, ...rest] = r.split(' ');
  return `${method} ${norm(rest.join(' '))}`;
}));

const missing = [];
for (const call of clientCalls) {
  const key = `${call.method} ${norm(call.path)}`;
  if (!workerNorm.has(key)) missing.push(key);
}

console.log(`worker routes registered: ${workerRoutes.size}`);
console.log(`frontend client calls:    ${clientCalls.length}`);
if (missing.length) {
  console.error('\nFAIL — frontend calls with no matching Worker route:');
  for (const m of [...new Set(missing)].sort()) console.error(`  ${m}`);
  process.exit(1);
}
console.log('\nOK — every frontend client call resolves to a registered Worker route.');
