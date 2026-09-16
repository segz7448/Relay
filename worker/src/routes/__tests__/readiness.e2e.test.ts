import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../../lib/keys';
const db=()=>env.DB as D1Database;
beforeEach(async()=>{await db().exec('DELETE FROM sessions; DELETE FROM users;');await db().prepare('INSERT INTO users(id,email,username,name,password_hash,created_at,updated_at)VALUES(?,?,?,?,?,?,?)').bind('ready','r@x','ready','Ready',await hashPassword('password-12345'),1,1).run()});
async function token(){const r=await SELF.fetch('https://x/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:'ready',password:'password-12345'})});return (await r.json<any>()).sessionToken}
describe('authenticated readiness',()=>{
 it('rejects unauthenticated probes without exposing infrastructure',async()=>{const r=await SELF.fetch('https://x/ready');expect(r.status).toBe(401);expect(await r.json()).toEqual({error:'missing_token'})});
 it('proves Worker and required bindings plus D1 schema',async()=>{const r=await SELF.fetch('https://x/ready',{headers:{Authorization:`Bearer ${await token()}`}});expect(r.status).toBe(200);expect(await r.json()).toEqual({ok:true,services:{worker:'ready',database:'ready',kv:'bound',bucket:'bound',turn:'optional_unconfigured'}})})
});
