import assert from "node:assert/strict";import{readFileSync}from"node:fs";
const screen=readFileSync('app/agent-connection.jsx','utf8'),store=readFileSync('devPlatformStore.js','utf8'),api=readFileSync('api.js','utf8'),routes=readFileSync('worker/src/routes/other.ts','utf8');
for(const fn of ['fetchApiKeys','createApiKey','revokeApiKey','rotateAccessKey','fetchAccessKeyAudit'])assert.ok(screen.includes(fn),fn);
for(const call of ['api.listApiKeys()','api.createApiKey','api.revokeApiKey','api.rotateApiKeyAccess','api.listApiKeyAudit'])assert.ok(store.includes(call),call);
for(const path of ['/dev/api-keys','/dev/api-keys/${id}','/dev/api-keys/${id}/rotate','/dev/api-keys/${id}/audit'])assert.ok(api.includes(path),path);
for(const route of ['dev.get("/api-keys"','dev.post("/api-keys"','dev.delete("/api-keys/:keyId"','dev.post("/api-keys/:keyId/rotate"','dev.get("/api-keys/:keyId/audit"'])assert.ok(routes.includes(route),route);
assert.ok(screen.includes('Clipboard.setStringAsync'));assert.ok(screen.includes('router.back()'));assert.ok(screen.includes('setMode(x)'));assert.ok(screen.includes('API UNREACHABLE'));console.log('Midnight Console app-to-Worker wiring: OK');
