import assert from "node:assert/strict";import{readFileSync}from"node:fs";
const screen=readFileSync("app/agent-connection.jsx","utf8"),icons=readFileSync("components/AgentConsoleIcon.jsx","utf8");
for(const x of ["Back to Settings","Copy Relay host","Generate ${mode} access key","Rotate ${x.name}","Audit ${x.name}","Revoke ${x.name}","Copy complete one-time access key","Copy full agent bootstrap configuration","Retry loading keys"])assert.ok(screen.includes(x),x);
for(const x of ["loading","error","ready","NO ACTIVE KEYS","ONE-TIME ACCESS KEY","AUDIT"])assert.ok(screen.includes(x),x);
assert.match(screen,/iconButton:\s*\{[\s\S]*?width: 48,[\s\S]*?height: 48,/);assert.ok(screen.includes('accessibilityLiveRegion="assertive"'));assert.ok(icons.includes('react-native-svg'));assert.ok(!icons.includes('@expo/vector-icons'));console.log('Midnight Console behavior/accessibility contract: OK');
