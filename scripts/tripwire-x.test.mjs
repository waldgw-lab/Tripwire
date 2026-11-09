import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { X_ACCOUNTS, XApi, XFailure, nextXCursor, xAccess, xHandle, xProfileImage, xStatusId } from '../artifacts/api-server/src/lib/tripwire-x-api.ts';
import { X_REPORTERS, REPORTER_PORTRAITS, REPORTER_ALIASES } from '../artifacts/api-server/src/lib/tripwire-x-reporters.ts';
import { buildMediaCoverage } from '../artifacts/tripwire/src/lib/media-coverage.ts';
import { journalistRoster } from '../artifacts/api-server/src/lib/tripwire-config.ts';
import { canonicalUrl } from '../artifacts/api-server/src/lib/tripwire-headlines.ts';
import { GetXFeedsResponse, SaveRecordBody } from '@workspace/api-zod';

test('exact ten requested X identities under eight unchanged outlets', () => {
  assert.equal(X_ACCOUNTS.length, 10);
  assert.equal(new Set(X_ACCOUNTS.map(a => a[0])).size, 8);
  assert.deepEqual(X_ACCOUNTS.filter(a => a[0] === 'CNN').map(a => a[1]), ['CNN', 'cnnbrk']);
  assert.deepEqual(X_ACCOUNTS.filter(a => a[0] === 'The Wall Street Journal').map(a => a[1]), ['WSJ', 'WSJopinion']);
  assert.deepEqual(X_ACCOUNTS.map(a => a[1]), ['axios', 'washingtonpost', 'TheAtlantic', 'CNN', 'cnnbrk', 'WSJ', 'WSJopinion', 'nytimes', 'Reuters', 'CBSNews']);
});
test('normalization and stable post identity exclude lookalike domains', () => {
  for (const input of ['@CNN', 'cnn', 'https://twitter.com/CNN/', 'https://x.com/CNN?x=1']) assert.equal(xHandle(input), 'cnn');
  for (const input of ['https://evilx.com/CNN', 'https://x.com.evil.test/CNN', 'not a handle']) assert.equal(xHandle(input), undefined);
  for (const url of ['https://x.com/CNN/status/123?s=20', 'https://twitter.com/old/status/123', 'https://x.com/i/web/status/123']) {
    assert.equal(xStatusId(url), '123'); assert.equal(canonicalUrl(url), 'https://x.com/i/web/status/123');
  }
  assert.equal(xStatusId('https://evilx.com/CNN/status/123'), undefined);
});
test('approved full reporter shortlist adds 28 unique accounts under ten existing outlets', () => {
  assert.equal(X_REPORTERS.length, 28);
  assert.equal(new Set(X_REPORTERS.map(([, handle]) => xHandle(handle))).size, 28);
  assert.equal(new Set([...X_ACCOUNTS, ...X_REPORTERS].map(([outlet]) => outlet)).size, 10);
  assert.equal(new Set([...X_ACCOUNTS, ...X_REPORTERS].map(([, handle]) => xHandle(handle))).size, 38);
  assert.ok(X_REPORTERS.some(([outlet, handle]) => outlet === 'NBC' && handle === 'ckubeNBC'));
  assert.ok(X_REPORTERS.some(([outlet, handle]) => outlet === 'ABC' && handle === 'LMartinezABC'));
  assert.ok(X_REPORTERS.some(([outlet, handle]) => outlet === 'CBS' && handle === 'ellee_watson'));
  assert.ok(X_REPORTERS.some(([outlet, handle]) => outlet === 'Axios' && handle === 'axiosalex'));
  for (const [handle, portrait] of Object.entries(REPORTER_PORTRAITS)) {
    assert.ok(X_REPORTERS.some(([, h]) => xHandle(h) === handle));
    assert.equal(new URL(portrait.url).protocol, 'https:');
    assert.equal(new URL(portrait.source).protocol, 'https:');
  }
});
test('provider profile photos allow only HTTPS X profile images', () => {
  const url = 'https://pbs.twimg.com/profile_images/123/photo_normal.jpg';
  assert.equal(xProfileImage(url), url);
  for (const bad of ['http://pbs.twimg.com/profile_images/123/x.jpg', 'https://evil.test/photo.jpg',
    'https://pbs.twimg.com.evil.test/profile_images/photo.jpg', 'https://pbs.twimg.com/media/news.jpg',
    'https://user@pbs.twimg.com/profile_images/x.jpg', 'data:image/svg+xml,something']) assert.equal(xProfileImage(bad), undefined);
});
test('the approved reporters merge with the existing roster using explicit aliases, not duplicate profiles', () => {
  const watches=journalistRoster.flatMap(([outlet,names])=>names.map(title=>({kind:'watch',id:title,title,watchType:'journalist',outlet})));
  const accounts=X_REPORTERS.map(([outlet,handle,name])=>({id:`x:watch:${handle.toLowerCase()}`,name,handle,outlet,accountType:'reporter',aliases:REPORTER_ALIASES[handle.toLowerCase()]??[]}));
  const profiles=buildMediaCoverage(watches,accounts);
  for(const [outlet,handle,name] of X_REPORTERS){
    const match=profiles.filter(p=>p.xAccounts.some(a=>a.handle===handle));
    assert.equal(match.length,1,`${name} has one profile`);
    const rosterNames=journalistRoster.find(([o])=>o===outlet)?.[1]??[];
    const expected=rosterNames.some(n=>[name,...(REPORTER_ALIASES[handle.toLowerCase()]??[])].some(a=>a.toLowerCase()===n.toLowerCase()));
    if(expected)assert.ok(match[0].watch,`${name} shares the existing tracked profile`);
    assert.deepEqual(match[0].coverage,[]);
  }
});
test('credentials alone or unapproved/invalid limits never enable billable requests', () => {
  const base = { X_API_BEARER_TOKEN: 'fixture', X_DAILY_REQUEST_LIMIT: '100', X_DAILY_POST_LIMIT: '800' };
  assert.equal(xAccess(base).ready, false);
  assert.equal(xAccess({ ...base, X_COLLECTION_APPROVED: 'true' }).ready, true);
  assert.equal(xAccess({ ...base, X_COLLECTION_APPROVED: 'true', X_DAILY_POST_LIMIT: '79' }).ready, false);
  assert.equal(xAccess({ ...base, X_COLLECTION_APPROVED: 'true', X_DAILY_REQUEST_LIMIT: 'NaN' }).ready, false);
});
test('server fields cannot be supplied through generic record writes', () => {
  const parsed = SaveRecordBody.parse({ kind: 'watch', title: '@CNN', xPost: { postId: '1' }, since: '100', status: 'ok', userId: '55' });
  for (const key of ['xPost', 'since', 'status', 'userId']) assert.equal(key in parsed, false);
  assert.ok(GetXFeedsResponse.safeParse({ accounts: [], status: 'setup-required', message: 'setup', intervalMinutes: 10, requestsUsed: 0, postsReserved: 0 }).success);
});
test('initial sample is bounded; continuation keeps pinned since ID until final page', () => {
  const first = { data: [{ id: '200' }, { id: '190' }], meta: { next_token: 'older' } };
  assert.deepEqual(nextXCursor({}, first), { since: '200' });
  const pending = nextXCursor({ since: '100' }, first);
  assert.deepEqual(pending, { since: '100', newest: '200', token: 'older', pages: 1 });
  assert.deepEqual(nextXCursor(JSON.parse(JSON.stringify(pending)), { data: [{ id: '150' }], meta: {} }), { since: '200' });
  assert.deepEqual(nextXCursor({ since: '200' }, { meta: { result_count: 0 } }), { since: '200' });
});
test('official timeline adapter is incremental, reserves before read and rejects partial errors', async () => {
  const events = [];
  const api = new XApi('fixture', async n => { events.push(n); }, async (url, options) => {
    assert.equal(events[0], 80);
    const u = new URL(url); assert.equal(u.origin, 'https://api.x.com');
    assert.equal(u.searchParams.get('since_id'), '100'); assert.equal(u.searchParams.get('pagination_token'), 'next');
    assert.equal(u.searchParams.get('max_results'), '20');
    assert.equal(options.headers.Authorization, 'Bearer fixture');
    return Response.json({ data: [{ id: '200', author_id: '55', text: 'retained', created_at: '2026-11-08T12:00:00Z' }], meta: {} });
  });
  assert.equal((await api.timeline('55', '100', 'next')).data[0].text, 'retained');
  for (const response of [
    { data: [], errors: [{ detail: 'do not expose' }], meta: {} },
    { data: [{ id: '1', text: 'wrong author', author_id: '66', created_at: '2026-11-08T00:00:00Z' }], meta: {} },
    { data: [{ id: '1', text: 'no publication', author_id: '55' }], meta: {} },
  ]) {
    await assert.rejects(new XApi('fixture', async () => {}, async () => Response.json(response)).timeline('55'), e => e.status === 'invalid-response' && !e.message.includes('detail'));
  }
});
test('429, credential errors, network failures and budget rejection are explicit and sanitized', async () => {
  for (const [code, status] of [[429, 'rate-limited'], [401, 'access-denied'], [403, 'access-denied'], [503, 'unavailable']]) {
    const api = new XApi('fixture', async () => {}, async () => new Response('secret provider error', { status: code, headers: { 'retry-after': '1200' } }));
    await assert.rejects(api.timeline('55'), e => e.status === status && !!e.retryAt && !e.message.includes('secret'));
  }
  await assert.rejects(new XApi('fixture', async () => {}, async () => { throw Error('raw network secret'); }).timeline('55'), e => e.status === 'unavailable');
  let calls = 0;
  await assert.rejects(new XApi('fixture', async () => { throw new XFailure('budget-limited'); }, async () => { calls++; }).timeline('55'), e => e.status === 'budget-limited');
  assert.equal(calls, 0);
});
test('bounded user lookup retains valid users alongside unavailable handles and rejects unrelated identities', async () => {
  const make = payload => new XApi('fixture', async () => {}, async () => Response.json(payload));
  assert.deepEqual(await make({ data: [{ id: '1', username: 'axios' }], errors: [{ resource_id: 'missing' }] }).users(['axios','missing']),
    [{ id: '1', username: 'axios' }]);
  assert.deepEqual(await make({ errors: [{ resource_id: 'missing' }] }).users(['missing']), []);
  await assert.rejects(make({ data: [{ id: '2', username: 'unrelated' }] }).users(['axios']), e => e.status === 'invalid-response');
  await assert.rejects(make({}).users(Array(6).fill('axios')), e => e.status === 'invalid-response');
});
test('usage reconciliation counts returned and expanded resources, while failed calls retain reservations', async () => {
  const reserved=[],settled=[];
  const reserve=async (posts,users)=>{reserved.push([posts,users]);return async(p,u)=>{settled.push([p,u]);};};
  const tweet={id:'100',author_id:'1',text:'A retained statement',created_at:'2026-11-09T12:00:00Z'};
  const api=new XApi('fixture',reserve,async()=>Response.json({data:[tweet],meta:{},includes:{tweets:[{...tweet,id:'90'}],users:[{id:'1',username:'axios'},{id:'2',username:'someone'}]}}));
  await api.timeline('1');
  assert.deepEqual(reserved,[[80,80]]);
  assert.deepEqual(settled,[[2,2]]);
  await new XApi('fixture',reserve,async()=>Response.json({data:[{id:'1',username:'axios'}]})).users(['axios']);
  assert.deepEqual(reserved[1],[0,1]);
  assert.deepEqual(settled[1],[0,1]);
  await assert.rejects(new XApi('fixture',reserve,async()=>new Response('provider error',{status:429})).timeline('1'));
  assert.equal(reserved.length,3);
  assert.equal(settled.length,2,'failed request retains its full allowance');
});
test('isolated persistence: restarts, duplicates, pagination failure, limits and account overrides', async t => {
  if (!process.env.DATABASE_URL) return t.skip('Database unavailable');
  const { pool } = await import('@workspace/db');
  const schema = `tripwire_x_test_${randomUUID().replaceAll('-', '')}`;
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(`CREATE TABLE "${schema}".tripwire_records (LIKE public.tripwire_records INCLUDING ALL)`);
    await pool.query(`CREATE TABLE "${schema}".tripwire_content (LIKE public.tripwire_content INCLUDING ALL)`);
    const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./fixtures/x-persistence.mjs', import.meta.url))], {
      cwd: fileURLToPath(new URL('.', import.meta.url)), env: { ...process.env, PGOPTIONS: `-c search_path=${schema}` }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', d => output += d); child.stderr.on('data', d => output += d);
    const code = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
    assert.equal(code, 0, output);
  } finally {
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});
