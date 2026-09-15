import { env } from 'cloudflare:test';
import { describe,expect,it } from 'vitest';
import { checkBotLimits } from '../botRateLimit';
describe('Phase 20 bot rate limits',()=>{it('enforces bot, user, and IP composite buckets',async()=>{for(let i=0;i<2;i++)expect((await checkBotLimits(env.KV,{surface:'message',botId:'b1',botUserId:'u1',ip:'203.0.113.1',limit:2,windowSec:60})).allowed).toBe(true);expect((await checkBotLimits(env.KV,{surface:'message',botId:'b1',botUserId:'u1',ip:'203.0.113.1',limit:2,windowSec:60})).allowed).toBe(false);expect((await checkBotLimits(env.KV,{surface:'message',botId:'b2',botUserId:'u2',ip:'203.0.113.2',limit:2,windowSec:60})).allowed).toBe(true);});});
