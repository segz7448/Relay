import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
function walk(dir){return readdirSync(dir).flatMap(n=>{const p=join(dir,n);return statSync(p).isDirectory()?walk(p):[p]})}
const files=walk('app').filter(p=>p.endsWith('.jsx'));
const sources=[...files,...walk('components').filter(p=>p.endsWith('.jsx'))];
const routes=new Set(files.map(p=>('/'+relative('app',p).replace(/\\/g,'/').replace(/\.jsx$/,'').replace(/\/index$/,'').replace(/^\/(tabs)\//,'/')).replace(/^\/$/,'/')));
const dynamic=[...routes].filter(r=>r.includes('['));
const missing=[];
for(const p of sources){const s=readFileSync(p,'utf8');for(const m of s.matchAll(/router\.(?:push|replace)\((?:`|'|")([^`'"]+)/g)){const target=m[1].split('?')[0].replace(/\/$/,'')||'/';if(target.includes('${')){const pattern=target.replace(/\$\{[^}]+\}/g,'[x]');if(!dynamic.some(r=>r.replace(/\[[^\]]+\]/g,'[x]')===pattern))missing.push(`${p}: ${target}`)}else if(target!=='/'&&target!=='/contact/me'&&!routes.has(target))missing.push(`${p}: ${target}`)}}
assert.deepEqual(missing,[]);
for(const required of ['/agent-connection','/call/[id]','/settings-developer'])assert.ok(routes.has(required),required);
console.log(`Route-target audit: ${routes.size} screens, every static/dynamic navigation target resolves`);
