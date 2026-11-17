import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { compareEmailCases, isOutlookMessageUrl, needsEmailReview } from '../supabase/functions/_shared/emailReview.ts';
import { actionKindMeta, planUndo } from '../src/lib/agentDesk.ts';

const db = new PGlite();
const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const connection = '00000000-0000-4000-8000-000000000003';
const run = '00000000-0000-4000-8000-000000000004';
const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const sql = async (query, values = []) => (await db.query(query, values)).rows;
// Preserve PostgreSQL microseconds, just like PostgREST's timestamp strings.
const cases = () => sql('select *, updated_at::text as updated_at from public.email_review_cases order by id');
const receipts = () => sql('select * from public.email_review_intakes order by created_at');
const audits = () => sql('select * from public.agent_actions order by created_at');
const evidence = (patch = {}) => ({ message_id: 'message-1', request_key: 'contact-preference', source_version: 'body-v1',
  source_url: 'https://outlook.office.com/mail/inbox/id/sample-message', received_at: '2026-10-24T14:00:00Z',
  category: 'contact_preference', customer_label: 'Sample customer', vehicle_context: 'Sample SUV',
  request_summary: 'Please do not have dealers contact me.', suggested_next_step: 'Human review of the contact preference; handling unverified.', ...patch });
const input = (key = 'run-1', findings = [evidence()], patch = {}) => ({ kind: 'email_review_intake', dedupeKey: `email:${key}`,
  rationale: 'Save approved customer evidence without changing mail.', cases: findings,
  intake: { mailbox: 'hello@autofinder.com', run_key: key, covered_from: '2026-10-23T04:00:00Z',
    covered_through: '2026-11-01T14:00:00Z', complete: true, message_count: findings.length ? 1 : 0,
    customer_reply_count: findings.length ? 1 : 0, pages: 1, limitations: ['Thread/version metadata omitted by provider.'],
    seen_messages: [...new Map(findings.map(c => [c.message_id, { message_id: c.message_id, source_version: c.source_version }])).values()], ...patch } });
async function role(name, callback) { await db.exec(`set role ${name}`); try { return await callback(); } finally { await db.exec('reset role'); } }
async function apply(payload = input(), overrides = {}) {
  return role('service_role', async () => (await sql('select public.apply_agent_email_review_intake($1,$2,$3,$4,$5) result',
    [overrides.user ?? owner, overrides.run ?? run, overrides.connection ?? connection, 'Test agent', payload]))[0].result);
}
async function session(user = owner, client = null) {
  await sql("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
    [user, JSON.stringify(client ? { client_id: client } : {})]);
}
async function decide(item, status = 'reviewed', note = '', user = owner) {
  await session(user);
  return role('authenticated', async () => (await sql('select c.*, c.updated_at::text as updated_at from public.review_email_case($1,$2,$3,$4) c',
    [item.id, item.updated_at, status, note]))[0]);
}
let latest;
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    create table public.profiles(user_id uuid primary key references auth.users);
    create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;`);
  for (const name of ['2026-08-10_041_agent_desk.sql','2026-08-17_045_agent_connections.sql','2026-08-17_046_oauth_agent_connections.sql']) await db.exec(await migration(name));
  latest = await migration('2026-11-12_057_email_review.sql'); await db.exec(latest);
});
beforeEach(async () => {
  await db.exec(`reset role; drop trigger if exists fail_audit on public.agent_actions;
    drop trigger if exists fail_history on public.email_review_events; truncate auth.users cascade;`);
  await sql('insert into auth.users values ($1),($2)', [owner, other]);
  await sql("insert into public.agent_connections(id,user_id,name,scopes) values($1,$2,'Test',array['workspace:write'])", [connection, owner]);
  await sql('insert into public.agent_runs(id,user_id,agent_connection_id) values($1,$2,$3)', [run, owner, connection]);
  await session();
});
after(() => db.close());

test('repeatable migration and atomic audited intake use verified identity', async () => {
  await db.exec(latest);
  const result = await apply();
  const [c] = await cases(); const [a] = await audits(); const [receipt] = await receipts();
  assert.equal(c.review_status, 'needs_review'); assert.equal(c.reviewed_at, null);
  assert.equal(c.user_id, owner); assert.equal(receipt.complete, true);
  assert.equal(a.id, result.actionId); assert.equal(result.targetId, receipt.id);
  assert.equal(a.agent_connection_id, connection); assert.equal(a.actor_name, 'Test agent');
  assert.equal(a.after.cases[0].source_version, 'body-v1'); assert.deepEqual(a.before.cases, []);
  assert.equal((await sql('select * from public.email_review_events')).length, 1);
});
test('interrupted retries deduplicate, and same-version overlaps never spam case history', async () => {
  const first = await apply();
  assert.equal((await apply()).actionId, first.actionId);
  assert.equal((await apply()).skipped, 'duplicate');
  const retry = await apply(input('run-2'));
  assert.equal(retry.casesChanged, 0); assert.equal((await cases()).length, 1);
  assert.equal((await receipts()).length, 2); assert.equal((await sql('select * from public.email_review_events')).length, 1);
});
test('separate intents in one email remain separate cases, not duplicate message counts', async () => {
  await apply(input('multi', [evidence(), evidence({ request_key: 'vehicle', category: 'vehicle_correction', request_summary: 'I want a used vehicle.' })]));
  assert.equal((await cases()).length, 2); assert.equal((await receipts())[0].customer_reply_count, 1);
  await assert.rejects(apply(input('duplicate', [evidence(), evidence()])), /Duplicate case/);
});
test('new evidence preserves human decisions but requires re-review; stale saves conflict', async () => {
  await apply(); const original = (await cases())[0];
  const reviewed = await decide(original, 'handled', 'Teammate confirmed handling in the source correspondence.');
  assert.equal(needsEmailReview(reviewed), false);
  await apply(input('changed', [evidence({ source_version: 'body-v2', request_summary: 'A changed customer request.' })], { covered_through: '2026-11-02T14:00:00Z' }));
  const updated = (await cases())[0];
  assert.equal(updated.review_status, 'handled'); assert.equal(updated.decision_note, reviewed.decision_note);
  assert.equal(updated.reviewed_source_version, 'body-v1'); assert.equal(needsEmailReview(updated), true);
  await assert.rejects(decide(reviewed, 'handled', 'Old form'), /Case changed/);
  assert.equal((await cases())[0].source_version, 'body-v2');
});
test('an older delayed intake cannot regress newer source evidence or a complete checkpoint', async () => {
  await apply(input('new', [evidence({ source_version: 'new' })], { covered_through: '2026-11-03T14:00:00Z' }));
  await apply(input('old', [evidence({ source_version: 'old' })]));
  assert.equal((await cases())[0].source_version, 'new');
  assert.equal((await sql('select max(covered_through) cp from public.email_review_intakes where complete'))[0].cp.toISOString(), '2026-11-03T14:00:00.000Z');
});
test('partial runs save findings without advancing complete coverage; gaps fail closed', async () => {
  await apply();
  const partial = input('partial', [evidence({ source_version: 'partial' })], { covered_from: '2026-11-02T00:00:00Z', covered_through: '2026-11-03T00:00:00Z', complete: false });
  await apply(partial);
  assert.equal((await sql('select max(covered_through) cp from public.email_review_intakes where complete'))[0].cp.toISOString(), '2026-11-01T14:00:00.000Z');
  const gap = input('gap', [], { covered_from: '2026-11-02T00:00:00Z', covered_through: '2026-11-04T00:00:00Z' });
  await assert.rejects(apply(gap), /not skip a gap/);
  assert.equal((await receipts()).length, 2);
  await apply(input('catch-up', [], { covered_from: '2026-11-01T00:00:00Z', covered_through: '2026-11-04T00:00:00Z' }));
});
test('audit or history failure rolls back findings, decisions and checkpoint together', async () => {
  await db.exec(`create function public.fail_test() returns trigger language plpgsql as $$ begin raise exception 'Test audit failure'; end $$;
    create trigger fail_audit before insert on public.agent_actions for each row execute function public.fail_test();`);
  await assert.rejects(apply(), /Test audit failure/);
  assert.equal((await cases()).length, 0); assert.equal((await receipts()).length, 0);
  await db.exec('drop trigger fail_audit on public.agent_actions'); await apply();
  await db.exec('create trigger fail_history before insert on public.email_review_events for each row execute function public.fail_test()');
  await assert.rejects(decide((await cases())[0], 'handled', 'Should roll back'), /Test audit failure/);
  assert.equal((await cases())[0].review_status, 'needs_review');
});
test('owner-only reads/decisions and service-only audited import cannot be bypassed', async () => {
  await apply(); const c = (await cases())[0];
  await session(other);
  assert.equal((await role('authenticated', () => sql('select * from public.email_review_cases'))).length, 0);
  await assert.rejects(decide(c, 'reviewed', '', other), /Case not found/);
  await session(owner, 'oauth-client');
  assert.equal((await role('authenticated', () => sql('select * from public.email_review_cases'))).length, 0);
  await assert.rejects(role('authenticated', () => sql('select public.review_email_case($1,$2,$3,$4)', [c.id, c.updated_at, 'handled', 'Not authorized'])), /owner session/);
  for (const name of ['anon', 'authenticated']) {
    await assert.rejects(role(name, () => sql('select public.apply_agent_email_review_intake($1,$2,$3,$4,$5)', [owner, run, connection, 'No', input()])), /permission denied/);
  }
  await session();
  await assert.rejects(role('authenticated', () => sql("update public.email_review_cases set review_status='handled'")), /permission denied/);
  await assert.rejects(role('authenticated', () => sql('delete from public.email_review_cases')), /permission denied/);
  await assert.rejects(apply(input('foreign'), { user: other }), /active owned/);
  for (const patch of ["scopes=array['context:read']", 'revoked_at=now()', "expires_at=now()-interval '1 day'"]) {
    await db.exec(`update public.agent_connections set scopes=array['workspace:write'],revoked_at=null,expires_at=null; update public.agent_connections set ${patch}`);
    await assert.rejects(apply(input('blocked')), /active owned/);
  }
});
test('closed decisions require human notes; agents cannot overwrite status or save raw bodies', async () => {
  await apply(); const c = (await cases())[0];
  await assert.rejects(decide(c, 'handled'), /Record what/);
  await assert.rejects(decide(c, 'no_action'), /Record what/);
  await assert.rejects(apply(input('overwrite', [evidence({ source_version: '2', review_status: 'handled' })])), /agents cannot change handling/);
  await assert.rejects(apply(input('body', [evidence({ source_version: '2', body: '<private raw body>' })])), /Unsupported case field/);
  await assert.rejects(apply(input('mailbox', [], { mailbox: 'someone-else@example.com' })), /Only hello/);
  await assert.rejects(apply(input('missing-identity', [evidence()], { seen_messages: [] })), /identities/);
  await assert.rejects(apply(input('raw-ledger', [], { seen_messages: [{ message_id: '1', source_version: 'v', raw_body: 'no' }] })), /compact/);
});
test('source links are restricted, unsafe input is rejected and plain customer intent is not opt-out', async () => {
  for (const url of ['javascript:alert(1)', 'https://evil.example/mail/id/a', 'https://outlook.office.com.evil.example/mail/a', 'https://a@outlook.office.com/mail/a', 'https://outlook.office.com:444/mail/a', 'https://outlook.office.com/mail/deeplink/compose', 'https://outlook.office.com/owa/?action=compose', 'https://outlook.office.com/owa/?ItemID=a&action=send']) {
    assert.equal(isOutlookMessageUrl(url), false);
    await assert.rejects(apply(input('bad-url', [evidence({ source_url: url })])));
  }
  assert.equal(isOutlookMessageUrl('https://outlook.office.com/owa/?ItemID=abc&exvsurl=1'), true);
  await apply(input('no-longer-shopping', [evidence({ category: 'no_longer_shopping', request_summary: 'I already bought a car.' })]));
  assert.equal((await cases())[0].category, 'no_longer_shopping');
});
test('contact preferences sort first, changed versions reopen attention, and audit undo is explicit', () => {
  const base = { id: 'a', received_at: '2026-11-01T12:00:00Z', review_status: 'needs_review', source_version: 'v1', reviewed_source_version: null };
  assert.ok(compareEmailCases({ ...base, category: 'contact_preference' }, { ...base, id: 'b', category: 'buying_question' }) < 0);
  assert.equal(needsEmailReview({ ...base, review_status: 'handled', reviewed_source_version: 'v0' }), true);
  assert.equal(actionKindMeta('email_review_intake').label, 'Saved email review');
  assert.match(planUndo({ kind: 'email_review_intake', status: 'applied' }).reason, /individual case/);
});
