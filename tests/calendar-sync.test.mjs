import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { actionKindMeta, planUndo } from '../src/lib/agentDesk.ts';
import { dedupeOccurrences, generateOccurrences } from '../src/lib/recurrence.ts';

// Execute the actual Edge helper under Node; translate only Deno's import URLs.
const source = await readFile(new URL('../supabase/functions/_shared/outlookCalendar.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  .replace(/npm:date-fns@3/g, import.meta.resolve('date-fns'))
  .replace(/npm:date-fns-tz@3/g, import.meta.resolve('date-fns-tz'))
  .replace(/npm:ical.js@2.0.1/g, import.meta.resolve('ical.js'));
const { parseOutlookFeed, fetchOutlookFeed, refreshOutlookCalendar, importBounds, allowedIcsUrl } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
const today = new Date('2026-09-21T12:00:00Z');
const event = (body) => `BEGIN:VEVENT\r\n${body}\r\nEND:VEVENT`;
const feed = (...events) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n${events.join('\r\n')}\r\nEND:VCALENDAR`;
const one = 'UID:one\r\nDTSTART:20260921T140000Z\r\nDTEND:20260921T150000Z\r\nSUMMARY:Planning';
const parse = (text, tz = 'America/New_York', now = today) => parseOutlookFeed(text, tz, now);

test('calendar UI preserves distinct Outlook identities and skips retired occurrences', () => {
  const base = {id:'one',title:'Planning',start_at:'2026-09-21T14:00:00Z',duration_minutes:60,timezone:'UTC',source:'outlook_ics',recurrence:'none',outlook_source_key:'one'};
  const range = [new Date('2026-09-21T00:00:00Z'),new Date('2026-09-22T00:00:00Z')];
  const first = generateOccurrences(base,...range);
  const second = generateOccurrences({...base,id:'two',outlook_source_key:'two'},...range);
  assert.equal(dedupeOccurrences([...first,...first,...second]).length,2);
  assert.equal(generateOccurrences({...base,outlook_cancelled_at:today.toISOString()},...range).length,0);
});

test('UID survives title/start changes; distinct same-slot meetings are not conflated', () => {
  const first = parse(feed(event(one))).rows[0];
  const changed = parse(feed(event(one.replace(/140000/g, '160000').replace(/150000/g, '170000').replace('Planning', 'New title')))).rows[0];
  assert.equal(first.outlook_source_key, changed.outlook_source_key);
  assert.equal(changed.start_at, '2026-09-21T16:00:00.000Z');
  assert.equal(parse(feed(event(one), event(one.replace('UID:one', 'UID:two')))).rows.length, 2);
});
test('old recurring series expands beyond the former 400-occurrence limit', () => {
  const rows = parse(feed(event('UID:old\r\nDTSTART:20200101T140000Z\r\nDURATION:PT1H\r\nRRULE:FREQ=DAILY\r\nSUMMARY:Standup'))).rows;
  assert.equal(rows.length, 28);
  assert.ok(rows.some(r => r.start_at === '2026-10-05T14:00:00.000Z'));
  assert.equal(new Set(rows.map(r => r.outlook_source_key)).size, rows.length);
});
test('moved and cancelled recurrence exceptions override master, including moved-in dates', () => {
  const master = event('UID:series\r\nDTSTART:20260901T140000Z\r\nDURATION:PT1H\r\nRRULE:FREQ=WEEKLY;BYDAY=MO\r\nSUMMARY:Weekly');
  const moved = event('UID:series\r\nRECURRENCE-ID:20260921T140000Z\r\nDTSTART:20260922T160000Z\r\nDTEND:20260922T170000Z\r\nSUMMARY:Moved');
  const cancelled = event('UID:series\r\nRECURRENCE-ID:20260928T140000Z\r\nSTATUS:CANCELLED');
  const movedIn = event('UID:series\r\nRECURRENCE-ID:20260907T140000Z\r\nDTSTART:20260923T160000Z\r\nDTEND:20260923T170000Z\r\nSUMMARY:Moved in');
  const rows = parse(feed(master, moved, cancelled, movedIn)).rows;
  assert.equal(rows.filter(r => r.title === 'Moved').length, 1);
  assert.equal(rows.find(r => r.title === 'Moved').outlook_source_key, '["series","2026-09-21T14:00:00.000Z"]');
  assert.ok(rows.some(r => r.title === 'Moved in'));
  assert.ok(!rows.some(r => ['2026-09-21T14:00:00.000Z', '2026-09-28T14:00:00.000Z'].includes(r.start_at)));
  assert.equal(parse(feed(master.replace('SUMMARY:Weekly','STATUS:CANCELLED'), moved)).rows.length, 0);
});
test('floating/all-day dates use profile timezone, and the window spans DST', () => {
  const floating = parse(feed(event(one.replaceAll('Z', '')))).rows[0];
  assert.equal(floating.start_at, '2026-09-21T18:00:00.000Z');
  const allDay = parse(feed(event('UID:day\r\nDTSTART;VALUE=DATE:20260921\r\nDTEND;VALUE=DATE:20260922'))).rows[0];
  assert.equal(allDay.duration_minutes, 1440);
  const bounds = importBounds('America/New_York', new Date('2026-11-01T16:00:00Z'));
  assert.equal(bounds.from.toISOString(), '2026-10-19T04:00:00.000Z');
  assert.equal(bounds.to.toISOString(), '2026-11-16T05:00:00.000Z');
});
test('EXDATE exclusions, repeated identical components, and newest sequence are respected', () => {
  const recurring = one + '\r\nRRULE:FREQ=WEEKLY\r\nEXDATE:20260928T140000Z';
  const rows = parse(feed(event(recurring), event(recurring))).rows;
  assert.equal(rows.length, 2);
  assert.ok(!rows.some(r => r.start_at.startsWith('2026-09-28')));
  const revised = one.replace('Planning', 'Revised') + '\r\nSEQUENCE:2';
  assert.equal(parse(feed(event(one), event(revised))).rows[0].title, 'Revised');
});
test('embedded Outlook timezone definitions expand recurrence correctly across DST', () => {
  const zone = `BEGIN:VTIMEZONE\r\nTZID:Eastern Standard Time\r\nBEGIN:STANDARD\r\nDTSTART:19701101T020000\r\nRRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU\r\nTZOFFSETFROM:-0400\r\nTZOFFSETTO:-0500\r\nEND:STANDARD\r\nBEGIN:DAYLIGHT\r\nDTSTART:19700308T020000\r\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU\r\nTZOFFSETFROM:-0500\r\nTZOFFSETTO:-0400\r\nEND:DAYLIGHT\r\nEND:VTIMEZONE`;
  const rows = parse(feed(zone, event('UID:dst\r\nDTSTART;TZID=Eastern Standard Time:20261026T090000\r\nDTEND;TZID=Eastern Standard Time:20261026T100000\r\nRRULE:FREQ=WEEKLY\r\nSUMMARY:Weekly')),
    'America/New_York', new Date('2026-11-01T16:00:00Z')).rows;
  assert.ok(rows.some(r => r.start_at === '2026-10-26T13:00:00.000Z'));
  assert.ok(rows.some(r => r.start_at === '2026-11-02T14:00:00.000Z'));
  assert.ok(rows.every(r => r.duration_minutes === 60));
});
test('empty full calendar is valid; malformed/partial/unsupported snapshots fail closed', () => {
  assert.deepEqual(parse(feed()).rows, []);
  for (const text of ['', '<html>login</html>', feed(event(one)).replace('END:VCALENDAR',''),
    feed(event(one.replace('UID:one\r\n',''))), feed(event(one.replace('Planning','Other')), event(one)),
    feed(event(one + '\r\nRRULE:FREQ=SECONDLY')), feed(event(one)).replace('VERSION:2.0','METHOD:REQUEST'),
    feed(event(one.replace('DTSTART:20260921T140000Z', 'DTSTART;TZID=Unknown:20260921T140000')))]) {
    assert.throws(() => parse(text));
  }
});
test('fetch restricts hosts and redirects, bounds response size, and hides private URL errors', async () => {
  assert.ok(allowedIcsUrl('https://outlook.office365.com/secret/calendar.ics'));
  assert.ok(!allowedIcsUrl('https://outlook.office365.com.evil.test/'));
  assert.ok(!allowedIcsUrl('http://outlook.office.com/'));
  const url = 'https://outlook.office.com/private-secret';
  let calls = 0;
  await assert.rejects(fetchOutlookFeed(url, async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://evil.test/' } }); }), /published Outlook/);
  assert.equal(calls, 1);
  await assert.rejects(fetchOutlookFeed(url, async () => new Response('x'.repeat(5_000_001))), /too large/);
  await assert.rejects(fetchOutlookFeed(url, async () => { throw new Error(url); }), /Could not download/);
  assert.equal(await fetchOutlookFeed(url, async (_url, options) => {
    assert.equal(options.redirect, 'manual'); assert.ok(options.signal); return new Response(feed());
  }), feed());
});
test('refresh status is explicit; no RPC after missing settings, read-only scope, fetch/parse failures', async () => {
  let rpcCalls = 0;
  const profile = { outlook_ics_url: 'https://outlook.office.com/private', timezone: 'UTC', outlook_ics_last_synced_at: '2026-09-20T12:00:00Z' };
  const admin = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile }) }) }) }),
    rpc: async () => { rpcCalls++; return { data: { status: 'synced', lastSyncedAt: today.toISOString() } }; } };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('<html>Login</html>');
    assert.equal((await refreshOutlookCalendar(admin, 'user', { connectionId: 'c', scopes: ['context:read'] })).status, 'not_authorized');
    const failed = await refreshOutlookCalendar(admin, 'user');
    assert.equal(failed.status, 'failed'); assert.equal(failed.lastSyncedAt, profile.outlook_ics_last_synced_at);
    assert.match(failed.message, /Saved events were retained/);
    assert.equal(rpcCalls, 0);
    globalThis.fetch = async () => new Response(feed(event(one)));
    assert.equal((await refreshOutlookCalendar(admin, 'user')).status, 'synced');
    assert.equal(rpcCalls, 1);
    profile.outlook_ics_url = null;
    assert.equal((await refreshOutlookCalendar(admin, 'user')).status, 'not_configured');
  } finally { globalThis.fetch = originalFetch; }
});

const db = new PGlite();
const user = '00000000-0000-4000-8000-000000000001';
const otherUser = '00000000-0000-4000-8000-000000000002';
const connection = '00000000-0000-4000-8000-000000000003';
const url = 'https://outlook.office.com/private';
const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const sql = async (query, params = []) => (await db.query(query, params)).rows;
async function asRole(role, callback) {
  await db.exec(`set role ${role}`);
  try { return await callback(); } finally { await db.exec('reset role'); }
}
const snapshot = parse(feed(event(one)));
const apply = (rows = snapshot.rows, options = {}) => asRole(options.role ?? 'service_role', async () => (await sql(
  'select public.apply_outlook_calendar_snapshot($1,$2,$3,$4,coalesce($5::timestamptz,clock_timestamp()),$6,$7,$8) as result',
  [options.user ?? user, options.manual ? null : connection, options.url ?? url, 'America/New_York', options.startedAt ?? null,
    options.from ?? snapshot.from, options.to ?? snapshot.to, JSON.stringify(rows)]))[0].result);
const events = () => sql('select * from public.events order by id');
const audits = () => sql('select * from public.agent_actions order by created_at');
let latestMigration;
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create table public.profiles (user_id uuid primary key references auth.users, timezone text);
    create table public.notes (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users,
      content text, content_blocks jsonb, updated_at timestamptz default now());
    create function public.set_updated_at() returns trigger language plpgsql as
      $$ begin new.updated_at = now(); return new; end $$;`);
  for (const name of ['2026-04-17_004_events.sql', '2026-04-17_005_outlook_ics_sync.sql',
    '2026-05-22_029_event_assistant_flags.sql', '2026-05-22_030_meeting_debrief.sql', '2026-05-22_039_meeting_notes.sql',
    '2026-08-10_041_agent_desk.sql', '2026-08-17_045_agent_connections.sql', '2026-08-17_046_oauth_agent_connections.sql']) {
    await db.exec(await migration(name));
  }
  await db.exec('create table public.tasks (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users, linked_event_id uuid references public.events on delete set null)');
  latestMigration = await migration('2026-09-21_053_safe_calendar_sync.sql');
  await db.exec(latestMigration);
});
beforeEach(async () => {
  await db.exec('reset role; truncate auth.users cascade; drop trigger if exists reject_calendar_audit on public.agent_actions');
  await sql('insert into auth.users values ($1),($2)', [user, otherUser]);
  await sql("insert into profiles (user_id,timezone,outlook_ics_url) values ($1,'America/New_York',$3),($2,'America/New_York',$3)", [user, otherUser, url]);
  await sql("insert into agent_connections (id,user_id,name) values ($1,$2,'Test agent')", [connection, user]);
});
after(() => db.close());

async function link(eventId) {
  await sql('insert into tasks (user_id,linked_event_id) values ($1,$2)', [user,eventId]);
  await sql("insert into notes (user_id,linked_event_id,linked_occurrence_start_at,content,content_blocks) values ($1,$2,$3,'Keep my agenda','[{\"type\":\"paragraph\"}]')", [user,eventId,snapshot.rows[0].start_at]);
  await sql("insert into meeting_debrief_states (user_id,event_id,occurrence_start_at,notes) values ($1,$2,$3,'Keep my debrief')", [user,eventId,snapshot.rows[0].start_at]);
  await sql('update events set prep_required=false,allow_back_to_back=true,debrief_required=false where id=$1', [eventId]);
}
test('SQL migration repeats; sync is idempotent and preserves IDs, flags and links', async () => {
  await db.exec(latestMigration);
  const first = await apply(); assert.equal(first.inserted, 1);
  const [saved] = await events(); await link(saved.id);
  const before = await events(); const second = await apply();
  assert.equal(second.updated, 0); assert.equal(second.inserted, 0);
  assert.deepEqual(await events(), before);
  assert.equal((await sql('select linked_event_id from tasks'))[0].linked_event_id, saved.id);
  const audit = (await audits())[0];
  assert.equal(audit.agent_connection_id, connection); assert.equal(audit.actor_name, 'Test agent');
  assert.equal(audit.after.events[0].id, saved.id); assert.ok(!JSON.stringify(audit).includes(url));
  assert.equal(actionKindMeta('calendar_sync').label, 'Calendar synced');
  assert.match(planUndo(audit).reason, /Outlook/);
});
test('reschedule updates in place and moves linked occurrence keys, not content', async () => {
  await apply(); const [saved] = await events(); await link(saved.id);
  const changed = { ...snapshot.rows[0], title: 'Moved meeting', start_at: '2026-09-22T16:00:00Z', duration_minutes: 90 };
  await apply([changed]); const [updated] = await events();
  assert.equal(updated.id, saved.id); assert.equal(updated.prep_required, false);
  const [note] = await sql('select * from notes'); const [debrief] = await sql('select * from meeting_debrief_states');
  assert.equal(note.content, 'Keep my agenda'); assert.deepEqual(note.content_blocks,[{type:'paragraph'}]);
  assert.equal(note.linked_occurrence_start_at.toISOString(), '2026-09-22T16:00:00.000Z');
  assert.equal(debrief.occurrence_start_at.toISOString(), '2026-09-22T16:00:00.000Z');
  assert.equal(debrief.notes, 'Keep my debrief');
});
test('cancellation retains every linked row and restoration reuses the same ID', async () => {
  await apply(); const [saved] = await events(); await link(saved.id);
  assert.equal((await apply([])).removed, 1);
  assert.ok((await events())[0].outlook_cancelled_at);
  assert.equal((await sql('select * from notes'))[0].linked_event_id, saved.id);
  assert.equal((await sql('select * from meeting_debrief_states')).length, 1);
  await apply(); assert.equal((await events())[0].id, saved.id);
  assert.equal((await events())[0].outlook_cancelled_at, null);
});
test('week rollover retains past IDs/history; manual and other-user events are untouched', async () => {
  await apply(); const [saved] = await events(); await link(saved.id);
  await sql("insert into events (user_id,title,start_at,timezone,source) values ($1,'Manual',$3,'UTC','manual'),($2,'Private',$3,'UTC','outlook_ics')", [user,otherUser,saved.start_at]);
  const before = await events();
  await apply([], { from:'2026-10-01T00:00:00Z',to:'2026-10-29T00:00:00Z' });
  assert.deepEqual(await events(), before);
});
test('legacy imports adopt stable identities without changing ID or flags', async () => {
  const r = snapshot.rows[0];
  const [old] = await sql("insert into events (user_id,title,start_at,timezone,source,duration_minutes,prep_required) values ($1,$2,$3,$4,'outlook_ics',$5,false) returning id", [user,r.title,r.start_at,r.timezone,r.duration_minutes]);
  await link(old.id); await apply();
  assert.equal((await events())[0].id, old.id); assert.equal((await events())[0].outlook_source_key,r.outlook_source_key);
});
test('audit failure rolls back events, linked lookups and last-success timestamp together', async () => {
  await apply(); const [saved] = await events(); await link(saved.id);
  const before = await events(); const profile = await sql('select * from profiles');
  await db.exec(`create function public.reject_calendar_audit() returns trigger language plpgsql as
    $$ begin raise exception 'Audit unavailable'; end $$;
    create trigger reject_calendar_audit before insert on agent_actions for each row execute function public.reject_calendar_audit();`);
  await assert.rejects(apply([{...snapshot.rows[0],start_at:'2026-09-22T16:00:00Z'}]), /Audit unavailable/);
  assert.deepEqual(await events(),before); assert.deepEqual(await sql('select * from profiles'),profile);
  assert.equal((await sql('select linked_occurrence_start_at from notes'))[0].linked_occurrence_start_at.toISOString(),snapshot.rows[0].start_at);
  await db.exec('drop trigger reject_calendar_audit on agent_actions; drop function public.reject_calendar_audit()');
});
test('stale overlapping response and settings change cannot overwrite a newer import', async () => {
  await apply(); const before = await events(); const count = (await audits()).length;
  assert.equal((await apply([], { startedAt:'2020-01-01T00:00:00Z' })).status,'superseded');
  assert.equal((await apply([], {url:'https://outlook.office.com/different'})).status,'superseded');
  assert.deepEqual(await events(), before); assert.equal((await audits()).length,count);
});
test('invalid batches roll back fully; service-only and owned active write-scope checks', async () => {
  await assert.rejects(apply([...snapshot.rows,{...snapshot.rows[0]}]),/duplicate/);
  await assert.rejects(apply([{...snapshot.rows[0],duration_minutes:-1}]),/Invalid/);
  for (const role of ['anon','authenticated']) await assert.rejects(apply(snapshot.rows,{role}),/permission denied/);
  await assert.rejects(apply(snapshot.rows,{user:otherUser}),/active owned/);
  for (const patch of ["revoked_at=now()","expires_at=now()-interval '1 day'","scopes=array['context:read']"]) {
    await db.exec(`update agent_connections set revoked_at=null,expires_at=null,scopes=array['workspace:write']; update agent_connections set ${patch}`);
    await assert.rejects(apply(),/active owned/);
  }
  assert.equal((await events()).length,0); assert.equal((await audits()).length,0);
});
test('ambiguous legacy rows refuse the whole sync instead of breaking meeting links', async () => {
  const r = snapshot.rows[0];
  for (let i=0;i<2;i++) await sql("insert into events (user_id,title,start_at,timezone,source,duration_minutes) values ($1,$2,$3,$4,'outlook_ics',$5)", [user,r.title,r.start_at,r.timezone,r.duration_minutes]);
  const before = await events();
  await assert.rejects(apply(), /Ambiguous legacy/);
  assert.deepEqual(await events(), before); assert.equal((await audits()).length, 0);
});

// Exercise the actual HTTP handler as well as the shared importer and SQL.
const edgeSource = await readFile(new URL('../supabase/functions/codex-api/index.ts', import.meta.url), 'utf8');
const edgeJs = ts.transpileModule(edgeSource.replace(/^import .*;\r?\n/gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
function contextHandler({ syncStatus = 'synced', eventsError = false, validUser = true, activeGrant = true } = {}) {
  const calls = [];
  let handler;
  const createClient = () => ({
    auth: { getUser: async () => ({ data: { user: validUser ? {id:user} : null }, error: null }) },
    from(table) {
      if (table === 'events') calls.push('read-events');
      const q = {
        select() { return q; }, eq() { return q; }, is(field, value) { if(table === 'events') calls.push([field,value]); return q; },
        gte() { return q; }, lte() { return q; }, order() { return q; }, limit() { return q; }, or() { return q; }, update() { return q; },
        maybeSingle: async () => ({ data: table === 'agent_connections' ? (activeGrant ? {id:connection,name:'Agent',scopes:['context:read','workspace:write']} : null) : {timezone:'UTC'} }),
        then(resolve) { return Promise.resolve({ data: [], error: table === 'events' && eventsError ? {message:'unavailable'} : null }).then(resolve); },
      };
      return q;
    },
  });
  vm.runInNewContext(edgeJs, {
    Deno: { env: { get: () => 'test-config' }, serve: fn => {handler = fn;} }, createClient, Response, atob,
    localDateString: () => '2026-09-21',
    refreshOutlookCalendar: async (_admin, owner, principal) => {
      assert.equal(owner,user); assert.equal(principal.connectionId,connection);
      calls.push('refresh-start'); await Promise.resolve(); calls.push('refresh-finished');
      return {status:syncStatus,lastSyncedAt:'2026-09-20T12:00:00Z',message:'Test status'};
    },
  });
  const jwt = `test.${Buffer.from(JSON.stringify({client_id:'client'})).toString('base64url')}.test`;
  return { calls, run: () => handler(new Request('https://test.invalid', {method:'POST',headers:{Authorization:`Bearer ${jwt}`},body:JSON.stringify({action:'context',userId:otherUser})})) };
}
test('context awaits refresh before reading events, reports failure freshness, and uses verified identity', async () => {
  for (const syncStatus of ['synced','failed']) {
    const h = contextHandler({syncStatus}); const response = await h.run();
    assert.equal(response.status,200);
    assert.equal((await response.json()).context.calendarSync.status,syncStatus);
    assert.ok(h.calls.indexOf('read-events') > h.calls.indexOf('refresh-finished'));
    assert.ok(h.calls.some(c => Array.isArray(c) && c[0] === 'outlook_cancelled_at' && c[1] === null));
  }
});
test('context DB failures are not an empty successful calendar; invalid auth/grants never sync', async () => {
  assert.equal((await contextHandler({eventsError:true}).run()).status,500);
  for (const options of [{validUser:false},{activeGrant:false}]) {
    const h = contextHandler(options); assert.equal((await h.run()).status,401); assert.equal(h.calls.length,0);
  }
});
