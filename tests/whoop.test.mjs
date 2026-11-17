import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import ts from 'typescript';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {buildWhoopSummary,encryptTokens,decryptTokens,normalizeWhoopCycles,hashState,parseTokens,retryAfter,whoopCollection,WHOOP_SCOPES} from '../supabase/functions/_shared/whoop.ts';
import {createWhoopHandler} from '../supabase/functions/_shared/whoopService.ts';
import {whoopDiscovery,readWhoopContext} from '../supabase/functions/_shared/whoopContext.ts';

const db=new PGlite();
const owner='00000000-0000-4000-8000-000000000001', other='00000000-0000-4000-8000-000000000002';
const agent='00000000-0000-4000-8000-000000000003', foreign='00000000-0000-4000-8000-000000000004', unshared='00000000-0000-4000-8000-000000000005';
const key=Buffer.alloc(32,7).toString('base64');
const sql=async (query,params=[]) => (await db.query(query,params)).rows;
const apply=async (user,action,payload={}) => (await sql('select public.apply_whoop_action($1,$2,$3) as r',[user,action,payload]))[0].r;
const snapshot=async (user=owner,connection=agent,metadata=false) => (await sql('select public.read_whoop_personal_context($1,$2,$3) as r',[user,connection,metadata]))[0].r;
async function role(name,fn) { await db.exec(`set role ${name}`); try { return await fn(); } finally { await db.exec('reset role'); } }
const tokens=(extra={}) => ({access_token:'access-secret',refresh_token:'refresh-secret',expires_at:new Date(Date.now()+3600000).toISOString(),scopes:[...WHOOP_SCOPES],...extra});
const cycle=(id=1,extra={}) => ({id,start:new Date(Date.now()-5*3600000).toISOString(),end:null,timezone_offset:'-04:00',updated_at:new Date().toISOString(),score_state:'SCORED',score:{strain:0},...extra});
const recovery=(id=1,extra={}) => ({cycle_id:id,sleep_id:'sleep-1',updated_at:new Date().toISOString(),score_state:'SCORED',score:{recovery_score:0,user_calibrating:false},...extra});
const sleep=(extra={}) => ({id:'sleep-1',cycle_id:1,nap:false,end:new Date().toISOString(),score_state:'SCORED',score:{sleep_performance_percentage:90,stage_summary:{total_light_sleep_time_milli:10000000,total_slow_wave_sleep_time_milli:5000000,total_rem_sleep_time_milli:5000000,total_awake_time_milli:3000000}},...extra});
async function connect(ids=[agent],tokenSet=tokens()) {
  const generation=crypto.randomUUID(),state=await hashState(crypto.randomUUID());
  await apply(owner,'begin',{generation,state_hash:state,connection_ids:ids});
  await apply(owner,'consume_state',{state_hash:state});
  await apply(owner,'authorized',{generation,connection_ids:ids,encrypted_tokens:await encryptTokens(tokenSet,key,owner)});
  return generation;
}
async function lease() {const lease_token=crypto.randomUUID(); const r=await apply(owner,'lease',{lease_token}); return {...r,lease_token};}
const commit=async (l,rows=normalizeWhoopCycles([cycle()],[recovery()],[sleep()])) => apply(owner,'success',{...l,cycles:rows});

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    create table public.agent_connections(id uuid primary key,user_id uuid references auth.users,name text,oauth_client_id text,auth_kind text default 'oauth',scopes text[] default '{context:read}',revoked_at timestamptz,last_used_at timestamptz);`);
  await db.exec(await readFile(new URL('../supabase/migrations/2026-10-26_055_whoop_personal_context.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/2026-10-26_056_whoop_sync_schedule.sql',import.meta.url),'utf8'));
});
beforeEach(async () => {
  await db.exec('reset role; truncate auth.users cascade; drop trigger if exists fail_audit on public.whoop_audit_events;');
  await sql('insert into auth.users values($1),($2)',[owner,other]);
  await sql("insert into public.agent_connections(id,user_id,name,oauth_client_id) values($1,$2,'Codex','client-a'),($3,$4,'Foreign','client-b'),($5,$2,'Other assistant','client-c')",[agent,owner,foreign,other,unshared]);
});
after(() => db.close());

test('normalization keeps scored zero, excludes awake time/naps, and joins the exact recovery sleep',() => {
  const [r]=normalizeWhoopCycles([cycle()],[recovery()],[sleep(),sleep({id:'nap',nap:true,score:{sleep_performance_percentage:100}})]);
  assert.equal(r.recovery_score,0); assert.equal(r.strain,0); assert.equal(r.sleep_total_ms,20000000); assert.equal(r.sleep_performance_pct,90);
  const [missing]=normalizeWhoopCycles([cycle()],[recovery(1,{sleep_id:'not-returned'})],[sleep()]);
  assert.equal(missing.sleep_state,'MISSING'); assert.equal(missing.sleep_total_ms,null);
});
test('unscored values never become zero or silently fall back to an earlier cycle',() => {
  const rows=normalizeWhoopCycles([cycle(1,{score_state:'PENDING_SCORE'}),cycle(2,{start:'2026-01-01T12:00:00Z'})],[recovery(1,{score_state:'UNSCORABLE'})],[sleep({score_state:'PENDING_SCORE'})]);
  assert.equal(rows[0].recovery_score,null); assert.equal(rows[0].strain,null); assert.equal(rows[0].sleep_total_ms,null);
  const s=buildWhoopSummary({status:'connected',last_sync_at:new Date().toISOString()},rows);
  assert.equal(s.latest.cycle_id,1); assert.equal(s.latest.strain,null);
});
test('snapshots expose stale/failed/empty states and never credentials',() => {
  const rows=normalizeWhoopCycles([cycle()],[recovery()],[sleep()]);
  assert.equal(buildWhoopSummary({status:'connected',last_sync_at:'2020-01-01T00:00:00Z'},rows).freshness,'stale');
  assert.equal(buildWhoopSummary({status:'connected',last_sync_at:new Date().toISOString(),last_error_code:'provider_unavailable'},rows).freshness,'sync_failed');
  assert.equal(buildWhoopSummary({status:'connected',last_sync_at:new Date().toISOString(),last_cycle_count:0},rows).latest,null);
  assert.equal(buildWhoopSummary({status:'disconnected'},rows).latest,null);
  assert.ok(!JSON.stringify(buildWhoopSummary(null,[])).includes('access_token'));
});
test('sealed tokens use fresh IVs and cannot be decrypted for another owner',async () => {
  const first=await encryptTokens(tokens(),key,owner),second=await encryptTokens(tokens(),key,owner);
  assert.notEqual(first,second); assert.ok(!first.includes('access-secret'));
  assert.equal((await decryptTokens(first,key,owner)).refresh_token,'refresh-secret');
  await assert.rejects(decryptTokens(first,key,other));
  await assert.rejects(decryptTokens(first.slice(0,-4)+'xxxx',key,owner));
});
test('provider token response requires the requested read scopes and offline refresh',() => {
  assert.throws(() => parseTokens({access_token:'x',refresh_token:'y',expires_in:60,scope:'read:sleep'}));
  assert.equal(parseTokens({access_token:'x',refresh_token:'y',expires_in:60,scope:WHOOP_SCOPES.join(' ')}).scopes.length,4);
});
test('pagination follows every cursor and fails closed on repeated/missing pages and rate limits',async () => {
  const calls=[];
  const rows=await whoopCollection('/developer/v2/cycle','secret','2026-10-01','2026-10-26',async (url,init) => {
    calls.push(String(url)); assert.equal(init.redirect,'error');
    return Response.json({records:[{id:calls.length}],next_token:calls.length===1?'next':null});
  });
  assert.equal(rows.length,2); assert.ok(calls[1].includes('nextToken=next'));
  await assert.rejects(whoopCollection('/developer/v2/cycle','secret','a','b',async () => Response.json({records:[],next_token:'repeat'})),{code:'incomplete_pagination'});
  await assert.rejects(whoopCollection('/developer/v2/cycle','secret','a','b',async () => Response.json({})),{code:'invalid_provider_data'});
  await assert.rejects(whoopCollection('/developer/v2/cycle','secret','a','b',async () => new Response('',{status:429,headers:{'Retry-After':'600'}})),{code:'rate_limited',retryAfterSeconds:600});
  assert.equal(retryAfter(new Date(Date.now()+600000).toUTCString())>=599,true);
});
test('state is hashed, single use, expiring, and invalid after disconnect',async () => {
  const state=await hashState('random-browser-state'),generation=crypto.randomUUID();
  await apply(owner,'begin',{state_hash:state,generation,connection_ids:[agent]});
  assert.equal((await apply(other,'consume_state',{state_hash:state})).ok,false);
  assert.equal((await apply(owner,'consume_state',{state_hash:state})).user_id,owner);
  assert.equal((await apply(owner,'consume_state',{state_hash:state})).ok,false);
  await apply(owner,'begin',{state_hash:state,generation:crypto.randomUUID()});
  await sql("update public.whoop_oauth_states set expires_at=now()-interval '1 minute'");
  assert.equal((await apply(owner,'consume_state',{state_hash:state})).ok,false);
  await apply(owner,'begin',{state_hash:state,generation:crypto.randomUUID()});
  await apply(owner,'disconnect');
  assert.equal((await apply(owner,'consume_state',{state_hash:state})).ok,false);
});
test('cross-owner or revoked assistant grants are rejected',async () => {
  await assert.rejects(connect([foreign]),/active owned/);
  await sql('update public.agent_connections set revoked_at=now() where id=$1',[agent]);
  await assert.rejects(connect([agent]),/active owned/);
});
test('only the explicitly shared live owned agent can read personal context',async () => {
  await connect(); await commit(await lease());
  assert.equal((await snapshot()).available,true);
  assert.deepEqual(await snapshot(owner,unshared),{available:false});
  assert.deepEqual(await snapshot(other,agent),{available:false});
  assert.deepEqual(await snapshot(owner,foreign),{available:false});
  const metadata=await snapshot(owner,agent,true); assert.equal(metadata.available,true); assert.ok(!('cycles' in metadata));
  await sql('update public.agent_connections set revoked_at=now() where id=$1',[agent]);
  assert.deepEqual(await snapshot(),{available:false});
});
test('leases serialize refresh and generations reject late writes after disconnect',async () => {
  await connect(); const first=await lease(),second=await lease();
  assert.equal(first.ok,true); assert.equal(second.error,'deferred');
  await apply(owner,'disconnect');
  assert.equal((await commit(first)).error,'connection_changed');
  assert.equal((await apply(owner,'tokens',{...first,encrypted_tokens:'x'.repeat(40)})).ok,false);
  for (const table of ['whoop_credentials','whoop_oauth_states','whoop_cycle_summaries','whoop_agent_access']) assert.equal((await sql(`select count(*)::int n from public.${table}`))[0].n,0);
});
test('sync failure retains the last confirmed snapshot and respects Retry-After',async () => {
  await connect(); await commit(await lease());
  await sql('update public.whoop_connections set next_sync_at=now()');
  const l=await lease(); await apply(owner,'failure',{...l,error_code:'rate_limited',retry_seconds:900});
  assert.equal((await snapshot()).cycles.length,1);
  const c=(await sql('select * from public.whoop_connections'))[0];
  assert.equal(c.last_error_code,'rate_limited'); assert.ok(new Date(c.next_sync_at).getTime()>Date.now()+899000);
  assert.equal((await lease()).error,'deferred');
});
test('normalization-only persistence and failed audits roll mutations back',async () => {
  await connect(); const l=await lease();
  await assert.rejects(commit(l,[{...normalizeWhoopCycles([cycle()],[],[])[0],raw_token:'secret'}]),/normalized/);
  await db.exec("create function public.reject_whoop_audit() returns trigger language plpgsql as $$begin raise exception 'audit unavailable'; end$$; create trigger fail_audit before insert on public.whoop_audit_events for each row execute function public.reject_whoop_audit();");
  await assert.rejects(commit(l),/audit unavailable/);
  assert.equal((await sql('select count(*)::int n from public.whoop_cycle_summaries'))[0].n,0);
  assert.notEqual((await sql('select lease_token from public.whoop_connections'))[0].lease_token,null);
});
test('RLS isolates owners and ordinary browser/anonymous roles cannot read tokens or mutate access',async () => {
  await connect(); await commit(await lease());
  await sql("select set_config('request.jwt.claim.sub',$1,false)",[other]);
  await role('authenticated',async () => {
    await assert.rejects(sql('select * from public.whoop_cycle_summaries'),/permission denied/);
    await assert.rejects(sql('select * from public.whoop_credentials'),/permission denied/);
    await assert.rejects(apply(owner,'disconnect'),/permission denied/);
    await assert.rejects(sql('insert into public.whoop_agent_access values($1,$2,now())',[other,foreign]),/permission denied/);
  });
  await sql("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  // An OAuth agent with the SAME uid must not bypass sharing through REST.
  await role('authenticated',async () => { await assert.rejects(sql('select * from public.whoop_cycle_summaries'),/permission denied/); });
  await role('anon',async () => { await assert.rejects(sql('select * from public.whoop_cycle_summaries'),/permission denied/); });
});

// Tiny SQL-backed Supabase adapter: real migration/RPCs, no production account.
function adminAdapter() {
  return {
    rpc:async (name,args) => {
      if(name==='cleanup_whoop_storage') { await sql('select public.cleanup_whoop_storage()'); return {data:null,error:null}; }
      try {return {data:name==='apply_whoop_action'?await apply(args.p_user_id,args.p_action,args.p_payload):await snapshot(args.p_user_id,args.p_connection_id,args.p_metadata_only),error:null};}
      catch(error){return {data:null,error};}
    },
    from:(table) => {
      let columns='*',limit='',order='',single=false; const filters=[],values=[];
      const builder={select:(c) => {columns=c; return builder;},eq:(k,v) => {values.push(v);filters.push(`${k}=$${values.length}`);return builder;},
        is:(k,v) => {assert.equal(v,null);filters.push(`${k} is null`);return builder;},
        lte:(k,v) => {values.push(v);filters.push(`${k}<=$${values.length}`);return builder;},
        gte:(k,v) => {values.push(v);filters.push(`${k}>=$${values.length}`);return builder;},
        order:(k,o={}) => {order=` order by ${k} ${o.ascending===false?'desc':'asc'}${o.nullsFirst===false?' nulls last':''}`;return builder;},
        limit:(n) => {limit=` limit ${n}`;return builder;},maybeSingle:() => {single=true;return builder;},
        then:(resolve,reject) => sql(`select ${columns} from public.${table}${filters.length?' where '+filters.join(' and '):''}${order}${limit}`,values)
          .then(rows => resolve({data:single?rows[0]??null:rows,error:null}),error => resolve({data:null,error})).catch(reject),
      }; return builder;
    },
  };
}
const config={supabaseUrl:'https://project.supabase.co',appUrl:'https://ea.example',clientId:'client-id',clientSecret:'client-secret',encryptionKey:key,cronSecret:'cron-secret'};
const request=(action,extra={},headers={}) => new Request('https://project.supabase.co/functions/v1/whoop',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({action,...extra})});
test('HTTP status is owner-bound and excludes tokens, foreign agents and raw metrics payloads',async () => {
  await connect(); await commit(await lease());
  const h=createWhoopHandler({admin:adminAdapter(),config,authenticate:async () => owner});
  const r=await h(request('status',{userId:other})); assert.equal(r.status,200);
  const body=await r.json(); assert.equal(body.summary.latest.cycle_id,1); assert.equal(body.agents.length,2);
  assert.ok(!JSON.stringify(body).includes('access-secret')); assert.ok(!JSON.stringify(body).includes('encrypted_tokens'));
  const unauthed=createWhoopHandler({admin:adminAdapter(),config,authenticate:async () => null});
  assert.equal((await unauthed(request('status'))).status,401);
  assert.equal((await h(request('status',{}, {Origin:'https://evil.example'}))).status,403);
  assert.equal((await h(request('scheduled_sync'))).status,401);
});
test('OAuth completion requires the same owner, consumes one state and seals tokens',async () => {
  let exchanges=0;
  const h=createWhoopHandler({admin:adminAdapter(),config,authenticate:async () => owner,fetcher:async (url,init) => {
    exchanges++; assert.ok(String(url).includes('/oauth/oauth2/token')); assert.equal(init.redirect,'error');
    return Response.json({access_token:'a',refresh_token:'r',expires_in:3600,scope:WHOOP_SCOPES.join(' ')});
  }});
  const connectResponse=await (await h(request('connect',{connectionIds:[agent],returnUrl:'https://evil.example'}))).json();
  const auth=new URL(connectResponse.authorizationUrl); assert.equal(auth.origin,'https://api.prod.whoop.com');
  assert.equal(auth.searchParams.get('scope'),WHOOP_SCOPES.join(' '));
  assert.equal(auth.searchParams.get('redirect_uri'),'https://ea.example/profile?whoop=callback');
  const state=auth.searchParams.get('state');
  const otherHandler=createWhoopHandler({admin:adminAdapter(),config,authenticate:async () => other,fetcher:async () => {throw Error('Must never exchange a foreign owner code');}});
  assert.notEqual((await otherHandler(request('complete',{code:'once',state}))).status,200);
  const response=await h(request('complete',{code:'once',state})); assert.equal(response.status,200);
  await h(request('complete',{code:'once',state})); assert.equal(exchanges,1);
  assert.equal((await snapshot()).available,true);
});
test('full HTTP sync persists rotation before reading all three collections; incomplete reads retain snapshot',async () => {
  await connect([agent],tokens({expires_at:'2020-01-01T00:00:00Z'})); let calls=0;
  const h=createWhoopHandler({admin:adminAdapter(),config,authenticate:async () => owner,fetcher:async (url) => {
    const path=new URL(url).pathname;
    if(path.includes('/oauth/')) return Response.json({access_token:'rotated',refresh_token:'rotated-refresh',expires_in:3600,scope:WHOOP_SCOPES.join(' ')});
    calls++;
    const sealed=(await sql('select encrypted_tokens from public.whoop_credentials'))[0].encrypted_tokens;
    assert.equal((await decryptTokens(sealed,key,owner)).refresh_token,'rotated-refresh');
    return Response.json({records:path.endsWith('/cycle')?[cycle()]:path.endsWith('/recovery')?[recovery()]:[sleep()],next_token:null});
  }});
  assert.equal((await h(request('sync'))).status,200); assert.equal(calls,3); assert.equal((await snapshot()).cycles.length,1);
  await sql('update public.whoop_connections set next_sync_at=now()');
  const failing=createWhoopHandler({admin:adminAdapter(),config,authenticate:async () => owner,fetcher:async () => Response.json({records:[],next_token:'same'})});
  assert.equal((await failing(request('sync'))).status,503);
  assert.equal((await snapshot()).cycles.length,1);
  assert.equal((await sql('select last_error_code from public.whoop_connections'))[0].last_error_code,'incomplete_pagination');
});
test('MCP uses separate discovery and reads; no permission means no private summary',async () => {
  await connect(); await commit(await lease()); const admin=adminAdapter();
  assert.equal((await whoopDiscovery(admin,owner,agent)).available,true);
  assert.equal((await whoopDiscovery(admin,owner,unshared)).available,false);
  assert.equal(await readWhoopContext(admin,owner,unshared),null);
  assert.equal((await readWhoopContext(admin,owner,agent)).latest.cycle_id,1);
  const source=await readFile(new URL('../supabase/functions/executive-assistant-mcp/index.ts',import.meta.url),'utf8');
  assert.match(source,/name: 'get_personal_context'/); assert.match(source,/action:'personal.context'/);
});

test('retention cleanup works without an active provider grant and migration is repeatable',async () => {
  await connect(); await commit(await lease());
  await db.exec("update public.whoop_cycle_summaries set cycle_start=now()-interval '31 days'; update public.whoop_connections set status='reconnect_required'; update public.whoop_audit_events set created_at=now()-interval '91 days'");
  const h=createWhoopHandler({admin:adminAdapter(),config,authenticate:async () => null});
  assert.equal((await h(request('scheduled_sync',{}, {'x-cron-secret':'cron-secret'}))).status,200);
  assert.equal((await sql('select count(*)::int n from public.whoop_cycle_summaries'))[0].n,0);
  assert.equal((await sql('select count(*)::int n from public.whoop_audit_events'))[0].n,0);
  await db.exec(await readFile(new URL('../supabase/migrations/2026-10-26_055_whoop_personal_context.sql',import.meta.url),'utf8'));
  await role('authenticated',async () => {await assert.rejects(sql('select * from public.whoop_credentials'),/permission denied/);});
});
test('actual Edge entry verifies the user and refuses MCP tokens for provider management',async () => {
  const source=await readFile(new URL('../supabase/functions/whoop/index.ts',import.meta.url),'utf8');
  const js=ts.transpileModule(source.replace(/^import .*;\r?\n/gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText;
  let handler,valid=true;
  const env={SUPABASE_URL:config.supabaseUrl,SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service',APP_PUBLIC_URL:config.appUrl,
    WHOOP_CLIENT_ID:config.clientId,WHOOP_CLIENT_SECRET:config.clientSecret,WHOOP_TOKEN_ENCRYPTION_KEY:key};
  vm.runInNewContext(js,{Deno:{env:{get:n=>env[n]},serve:h=>handler=h},Response,atob,createWhoopHandler,
    createClient:(_url,key) => key==='service'?adminAdapter():{auth:{getUser:async () => ({data:{user:valid?{id:owner}:null},error:valid?null:new Error('bad signature')})}},
  });
  const jwt=claims=>`head.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
  assert.equal((await handler(request('status',{}, {Authorization:`Bearer ${jwt({role:'authenticated',client_id:'agent'})}`}))).status,401);
  assert.equal((await handler(request('status',{}, {Authorization:`Bearer ${jwt({role:'authenticated'})}`}))).status,200);
  valid=false; assert.equal((await handler(request('status',{}, {Authorization:`Bearer ${jwt({role:'authenticated'})}`}))).status,401);
});
test('private UI renders real zero, missing/unscored data and explicit cycle dates',async () => {
  const source=await readFile(new URL('../src/components/WhoopPanel.tsx',import.meta.url),'utf8');
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  let status={configured:true,summary:buildWhoopSummary({status:'connected',last_sync_at:new Date().toISOString()},normalizeWhoopCycles([cycle()],[recovery()],[sleep()])),agents:[],allowedConnectionIds:[]};
  const native=createRequire(import.meta.url),module={exports:{}};
  const require=name => name.includes('useWhoop')?{useWhoop:()=>({data:status,loading:false,error:null,reload:async()=>{}})}:
    name.includes('lib/whoop')?{whoopErrorMessage:()=>null}:name.includes('ui/Card')?{Card:({children})=>React.createElement('section',null,children)}:native(name);
  vm.runInNewContext(`(function(require,module,exports){${js}\n})`,{})(require,module,module.exports);
  const render=()=>renderToStaticMarkup(React.createElement(module.exports.WhoopPanel,{userId:owner,timezone:'America/New_York',compact:true}));
  const html=render(); assert.match(html,/0%/); assert.match(html,/physiological cycles|Physiological cycles/); assert.ok(!html.includes('NaN'));
  status={...status,summary:buildWhoopSummary({status:'connected',last_sync_at:new Date().toISOString()},normalizeWhoopCycles([cycle()],[],[]))};
  assert.match(render(),/Not scored/); assert.match(render(),/MISSING/);
});
