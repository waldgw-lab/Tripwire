import assert from 'node:assert/strict';
import { db, pool, tripwireRecords } from '@workspace/db';
import { and, eq, sql } from 'drizzle-orm';
import { seedXAccounts, getXFeeds, refreshXFeeds, updateXWatch } from '../../artifacts/api-server/src/lib/tripwire-x.ts';
import { writeRecord, removeRecord, recordsFor } from '../../artifacts/api-server/src/lib/tripwire-store.ts';
import { dismissArticle } from '../../artifacts/api-server/src/lib/tripwire-feedback.ts';
import { X_ACCOUNTS } from '../../artifacts/api-server/src/lib/tripwire-x-api.ts';
import { X_REPORTERS } from '../../artifacts/api-server/src/lib/tripwire-x-reporters.ts';
import { prepareXTrial, reserveX, xInterval, xTrial } from '../../artifacts/api-server/src/lib/tripwire-x-budget.ts';
import { publicHtml, publicPost } from './x-public-html.mjs';

const isolation = await db.execute(sql`select current_schema() as schema, current_setting('search_path') as path`);
assert.match(isolation.rows[0].schema, /^tripwire_x_test_/);
assert.equal(isolation.rows[0].path, isolation.rows[0].schema);
process.env.X_COLLECTION_APPROVED = 'true';
process.env.X_COLLECTION_MODE = 'api'; // Do not inherit an operator's active public collector mode.
process.env.X_DAILY_REQUEST_LIMIT = '100';
process.env.X_DAILY_POST_LIMIT = '8000';
process.env.X_API_BEARER_TOKEN = 'isolated-fixture-not-a-credential';
let calls = [], mode = 'initial';
const ids = new Map([...X_ACCOUNTS, ...X_REPORTERS].map((a, i) => [a[1].toLowerCase(), String(i + 1)]));
const post = (id, user = '1', text = `fixture text ${id}`) => ({ id, author_id: user, text, created_at: '2026-11-08T12:34:56Z' });
const response = (data, meta = {}, includes) => Response.json({ data, meta: { result_count: data.length, ...meta }, includes });
globalThis.fetch = async url => {
  calls.push(url);
  const u = new URL(url);
  if (u.pathname.endsWith('/users/by')) {
    assert.equal(u.searchParams.get('user.fields'), 'profile_image_url');
    assert.ok(u.searchParams.get('usernames').split(',').length <= 5);
    if (mode === 'partial-lookup') {
      return Response.json({ data: u.searchParams.get('usernames').split(',').filter(h => h.toLowerCase() !== 'nytimes')
        .map(handle => ({ id: ids.get(handle.toLowerCase()), username: handle })),
        errors: [{ resource_id: 'nytimes', detail: 'unavailable account; private provider detail' }] });
    }
    return response(u.searchParams.get('usernames').split(',').map(handle => ({ id: ids.get(handle.toLowerCase()), username: handle,
      profile_image_url: `https://pbs.twimg.com/profile_images/${ids.get(handle.toLowerCase())}/fixture.jpg` })));
  }
  const user = /users\/(\d+)\/tweets/.exec(u.pathname)[1];
  if (mode === 'partial-lookup' && user === ids.get('reuters')) return response([post('900', user)]);
  if (mode === 'partial-lookup' && user === ids.get('cbsnews')) return response([post('901', user)]);
  if (user !== '1') return response([]);
  if (mode === '429') return new Response('raw provider secret', { status: 429, headers: { 'retry-after': '1800' } });
  if (mode === 'forbidden') return new Response('raw provider secret', { status: 403 });
  if (mode === 'initial') return response([post('200'), post('190')], { next_token: 'historical' });
  if (mode === 'chain') return response([post('400')], { next_token: 'continuation' });
  if (mode === 'page-failure') return Response.json({ errors: [{ detail: 'failure' }], meta: {} });
  if (mode === 'rollback') return response([post('550'), post('not-numeric')]);
  if (mode === 'complete') {
    assert.equal(u.searchParams.get('since_id'), '200');
    assert.equal(u.searchParams.get('pagination_token'), 'continuation');
    return response([post('350')], {}, { tweets: [] });
  }
  if (mode === 'manual') return response([post('600')]);
  if (mode === 'dismissed') return response([post('650')]);
  if (mode === 'relationships') return response([{ ...post('700'), note_tweet: { text: 'Full returned note' }, referenced_tweets: [{ id: '699', type: 'quoted' }] }], {},
    { tweets: [post('699', '20', 'original quote')], users: [{ id: '20', username: 'original' }] });
  if (mode === 'db-failure') return response([post('800'), post('801')]);
  return response([]);
};
async function getWatch() { return (await db.select().from(tripwireRecords).where(eq(tripwireRecords.id, 'x:watch:axios')))[0].data; }
async function resetDue() {
  await db.execute(sql`update tripwire_records set data=data - 'nextCheck' where kind='x-watch'`);
  await db.execute(sql`update tripwire_records set data=data - 'retryAt' - 'status' where kind='x-control'`);
}
async function collectorRestart() {
  // Reload server module, keeping only durable DB state (no in-memory checkpoints).
  return (await import(`../../artifacts/api-server/src/lib/tripwire-x.ts?restart=${Date.now()}`)).refreshXFeeds();
}
try {
  const outletNames = [...new Set([...X_ACCOUNTS, ...X_REPORTERS].map(a => a[0]))];
  for (const [i, title] of outletNames.entries()) await db.insert(tripwireRecords).values({ id: `original-outlet-${i}`, owner: 'public', kind: 'outlet', data: { kind: 'outlet', title } });
  // Legacy case/profile reconciliation and preserved pause.
  await writeRecord('workspace', { id: 'legacy-cnn', kind: 'watch', watchType: 'x-account', title: 'https://twitter.com/CNN', enabled: false });
  await seedXAccounts(); await seedXAccounts();
  let feeds = await getXFeeds();
  assert.equal(feeds.accounts.length, 38); assert.equal(new Set(feeds.accounts.map(a => a.outletId)).size, 10);
  assert.equal(feeds.accounts.filter(a => a.accountType === 'reporter').length, 28);
  assert.equal(feeds.accounts.find(a => a.handle === 'BarakRavid').name, 'Barak Ravid');
  assert.ok(feeds.accounts.find(a => a.handle === 'BarakRavid').profileImageUrl);
  assert.ok(feeds.accounts.every(a => a.outletId.startsWith('original-outlet-')));
  assert.equal(feeds.accounts.find(a => a.handle === 'CNN').enabled, false);
  for (const account of feeds.accounts.filter(a => a.handle !== 'axios' && a.handle !== 'CNN')) await updateXWatch(account.id, false);
  // Reseeding metadata never resets reporter pause or a removed reporter.
  await updateXWatch('x:watch:tomnovelly');
  await seedXAccounts();
  assert.equal((await getXFeeds()).accounts.find(a => a.handle === 'BarakRavid').enabled, false);
  assert.ok(!(await getXFeeds()).accounts.some(a => a.handle === 'TomNovelly'));
  delete process.env.X_API_BEARER_TOKEN;
  assert.equal((await refreshXFeeds()).status, 'setup-required'); assert.equal(calls.length, 0);
  process.env.X_API_BEARER_TOKEN = 'isolated-fixture-not-a-credential';
  await Promise.all([refreshXFeeds(), refreshXFeeds()]);
  assert.equal(calls.filter(u => u.includes('/users/1/tweets')).length, 1);
  assert.equal((await getWatch()).since, '200');
  assert.equal((await getWatch()).token, undefined);
  assert.equal((await getXFeeds()).accounts.find(a => a.handle === 'axios').profileImageUrl, 'https://pbs.twimg.com/profile_images/1/fixture.jpg');
  let rows = (await recordsFor('workspace')).filter(r => r.kind === 'article');
  assert.equal(rows.length, 2); assert.equal(rows[0].publishedAt, '2026-11-08T12:34:56Z');
  const before = calls.length; await refreshXFeeds(); assert.equal(calls.length, before);
  await resetDue(); mode = 'chain'; await refreshXFeeds();
  let w = await getWatch(); assert.equal(w.since, '200'); assert.equal(w.newest, '400'); assert.equal(w.token, 'continuation');
  await resetDue(); mode = 'page-failure'; await collectorRestart();
  w = await getWatch(); assert.equal(w.since, '200'); assert.equal(w.token, 'continuation'); assert.equal(w.status, 'invalid-response');
  await resetDue(); mode = 'complete'; await collectorRestart();
  w = await getWatch(); assert.equal(w.since, '400'); assert.equal(w.token, undefined);
  await writeRecord('workspace', { id: 'manual-600', kind: 'article', sourceType: 'x', url: 'https://twitter.com/old/status/600?s=1', title: 'Manual edit wins', fullText: 'analyst supplied text', flagged: true });
  await resetDue(); mode = 'manual'; await refreshXFeeds();
  rows = (await recordsFor('workspace')).filter(r => r.kind === 'article');
  const manual = rows.filter(r => r.url?.includes('/600'));
  assert.equal(manual.length, 1); assert.equal(manual[0].title, 'Manual edit wins'); assert.equal(manual[0].flagged, true); assert.equal(manual[0].xPost.postId, '600');
  assert.equal(manual[0].fullText, 'analyst supplied text');
  assert.ok(manual[0].retainedContent.some(c => c.source === 'x:timeline' && c.text === 'fixture text 600'));
  await Promise.all([writeRecord('workspace', { kind: 'article', sourceType: 'x', title: 'same status', url: 'https://x.com/new/status/600' }), writeRecord('workspace', { kind: 'article', sourceType: 'x', title: 'same again', url: 'https://twitter.com/new/status/600' })]);
  rows = (await recordsFor('workspace')).filter(r => r.kind === 'article');
  assert.equal(rows.filter(r => r.url?.includes('/600')).length, 1);
  await writeRecord('workspace', { id: 'dismiss-650', kind: 'article', sourceType: 'x', title: 'dismissed fixture', url: 'https://x.com/axios/status/650' });
  await dismissArticle('workspace', 'dismiss-650', { reason: 'Irrelevant item', requestId: 'fixture-dismiss' });
  await resetDue(); mode = 'dismissed'; await refreshXFeeds();
  assert.ok(!(await recordsFor('workspace')).some(r => r.id === 'dismiss-650'));
  assert.equal((await getWatch()).since, '650');
  await resetDue(); mode = 'relationships'; await refreshXFeeds();
  const relation = (await recordsFor('workspace')).find(r => r.xPost?.postId === '700');
  assert.equal(relation.fullText, 'Full returned note'); assert.equal(relation.fullTextComplete, false);
  assert.equal(relation.xPost.references[0].handle, 'original'); assert.equal(relation.xPost.references[0].text, 'original quote');
  assert.deepEqual(relation.credits, []); assert.equal(relation.retainedContent[0].source, 'x:timeline');
  // A persistence error on the second record rolls back the first and checkpoint.
  await db.execute(sql`create function reject_fixture() returns trigger language plpgsql as $$ begin if NEW.data->>'title' = 'fixture text 801' then raise exception 'isolated persistence failure'; end if; return NEW; end $$`);
  await db.execute(sql`create trigger reject_fixture before insert on tripwire_records for each row execute function reject_fixture()`);
  await resetDue(); mode = 'db-failure'; await refreshXFeeds();
  assert.equal((await getWatch()).since, '700');
  assert.ok(!(await recordsFor('workspace')).some(r => r.xPost?.postId === '800'));
  await db.execute(sql`drop trigger reject_fixture on tripwire_records`);
  await resetDue(); await refreshXFeeds(); assert.equal((await getWatch()).since, '801');
  await resetDue(); mode = '429'; await refreshXFeeds();
  assert.equal((await getXFeeds()).status, 'rate-limited'); assert.equal((await getWatch()).since, '801');
  let count = calls.length; await refreshXFeeds(); assert.equal(calls.length, count);
  await resetDue(); process.env.X_DAILY_REQUEST_LIMIT = '1'; await refreshXFeeds();
  assert.equal((await getXFeeds()).status, 'budget-limited'); assert.equal(calls.length, count);
  process.env.X_DAILY_REQUEST_LIMIT = '100';
  await resetDue(); process.env.X_DAILY_POST_LIMIT = '80'; await refreshXFeeds();
  assert.equal((await getXFeeds()).status, 'budget-limited'); assert.equal(calls.length, count);
  process.env.X_DAILY_POST_LIMIT = '8000';
  await resetDue(); await updateXWatch('x:watch:axios', false); await seedXAccounts();
  assert.equal((await getWatch()).enabled, false); mode = 'empty'; await refreshXFeeds();
  assert.equal(calls.filter(u => u.includes('/users/1/tweets')).length, count ? calls.slice(0, count).filter(u => u.includes('/users/1/tweets')).length : 0);
  await updateXWatch('x:watch:axios', true);
  await updateXWatch('x:watch:axios'); await seedXAccounts();
  assert.ok(!(await getXFeeds()).accounts.some(a => a.handle === 'axios'));
  await removeRecord('workspace', 'legacy-cnn'); await seedXAccounts();
  assert.ok(!(await getXFeeds()).accounts.some(a => a.handle === 'CNN'));
  await updateXWatch('x:watch:nytimes', true); await resetDue(); await refreshXFeeds();
  assert.ok((await getXFeeds()).accounts.some(a => a.status === 'empty'));
  assert.ok((await recordsFor('workspace')).some(r => r.xPost?.postId === '700'));
  // One unavailable unresolved handle cannot block either a cached ID or a
  // valid newly resolved account in the same bounded cycle.
  await updateXWatch('x:watch:reuters', true);
  await updateXWatch('x:watch:cbsnews', true);
  await db.execute(sql`update tripwire_records set data=data - 'userId'
    where id in ('x:watch:nytimes','x:watch:cbsnews')`);
  await db.execute(sql`update tripwire_records set data=jsonb_set(data,'{userId}',${JSON.stringify(ids.get('reuters'))}::jsonb)
    where id='x:watch:reuters'`);
  await resetDue(); mode = 'partial-lookup';
  const beforePartial = calls.length;
  await refreshXFeeds();
  const partialFeeds = await getXFeeds();
  assert.equal(partialFeeds.status, 'ready');
  assert.equal(partialFeeds.accounts.find(a => a.handle === 'nytimes').status, 'account-unavailable');
  assert.ok(!partialFeeds.accounts.find(a => a.handle === 'nytimes').message.includes('private provider'));
  const partialRecords = await recordsFor('workspace');
  assert.ok(partialRecords.some(r => r.xPost?.postId === '900'));
  assert.ok(partialRecords.some(r => r.xPost?.postId === '901'));
  assert.ok(!calls.slice(beforePartial).some(url => url.includes(`/users/${ids.get('nytimes')}/tweets`)));
  // The approved reporter-only trial is prepared idempotently, without
  // activating merely because a credential happens to exist.
  delete process.env.X_PROVIDER_LIMIT_CONFIRMED;
  await prepareXTrial(); await prepareXTrial();
  let trialFeeds = await getXFeeds();
  assert.equal(trialFeeds.trial.phase, 'prepared');
  assert.equal(trialFeeds.trial.budgetUsd, 25);
  assert.equal(trialFeeds.trial.startedAt, undefined);
  assert.equal(trialFeeds.intervalMinutes, 30);
  assert.ok(trialFeeds.accounts.filter(a => a.accountType === 'outlet').every(a => !a.enabled));
  assert.equal(trialFeeds.accounts.find(a => a.handle === 'BarakRavid').enabled, false, 'preparation preserves reporter pauses');
  let beforeTrial = calls.length;
  await refreshXFeeds(); assert.equal(calls.length, beforeTrial);
  assert.equal((await xTrial()).startedAt, undefined);
  process.env.X_PROVIDER_LIMIT_CONFIRMED = 'true';
  await updateXWatch('x:watch:barakravid', true);
  // A direct attempt to resume an outlet cannot bypass the reporter-only gate.
  await updateXWatch('x:watch:reuters', true);
  mode = 'empty';
  await refreshXFeeds();
  assert.ok(!calls.slice(beforeTrial).some(url => url.includes(`/users/${ids.get('reuters')}/tweets`)));
  trialFeeds = await getXFeeds();
  assert.equal(trialFeeds.trial.phase, 'active');
  assert.equal(Date.parse(trialFeeds.trial.endsAt) - Date.parse(trialFeeds.trial.startedAt), 7 * 86_400_000);
  assert.equal(trialFeeds.trial.postsReturned, 0);
  assert.equal(trialFeeds.trial.usersReturned, 1);
  assert.equal(trialFeeds.trial.estimatedUsd, 0.01);
  assert.equal(trialFeeds.trial.reservedUsd, 0.01, 'empty timeline releases its worst-case reservation');
  assert.equal(trialFeeds.trial.unreconciledRequests, 0);
  const originalDeadline = trialFeeds.trial.endsAt;
  beforeTrial = calls.length;
  await prepareXTrial(); await collectorRestart();
  assert.equal(calls.length, beforeTrial, 'immediate restart/manual refresh respects thirty-minute gate');
  assert.equal((await getXFeeds()).trial.endsAt, originalDeadline);
  assert.equal(xInterval(await xTrial(), { X_POLL_INTERVAL_MINUTES: '5' }), 30);
  assert.equal(xInterval(await xTrial(), { X_POLL_INTERVAL_MINUTES: '60' }), 60);
  const settle = await reserveX(80, 80);
  assert.equal((await getXFeeds()).trial.reservedUsd, 1.21);
  await settle(0, 0); await settle(0, 0);
  assert.equal((await getXFeeds()).trial.reservedUsd, 0.01);
  await reserveX(80, 80); // Simulated crash/unknown response: no refund.
  assert.equal((await getXFeeds()).trial.reservedUsd, 1.21);
  assert.equal((await getXFeeds()).trial.unreconciledRequests, 1);
  // A new UTC day never resets the lifetime trial allowance or start/end time.
  await db.execute(sql`update tripwire_records set data=jsonb_set(data,'{day}','"2000-01-01"'::jsonb) where kind='x-control'`);
  assert.equal((await getXFeeds()).trial.reservedUsd, 1.21);
  await db.execute(sql`update tripwire_records set data=jsonb_set(data,'{reservedUnits}','4760'::jsonb) where kind='x-trial'`);
  const concurrent = await Promise.allSettled([reserveX(80, 80), reserveX(80, 80)]);
  assert.equal(concurrent.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(concurrent.filter(r => r.status === 'rejected').length, 1);
  assert.equal((await getXFeeds()).status, 'trial-budget-limited');
  beforeTrial = calls.length; await refreshXFeeds(); assert.equal(calls.length, beforeTrial);
  await db.execute(sql`update tripwire_records set data=jsonb_set(data,'{endsAt}',to_jsonb('2000-01-01T00:00:00Z'::text)) where kind='x-trial'`);
  await prepareXTrial(); await collectorRestart();
  assert.equal((await getXFeeds()).status, 'trial-ended');
  assert.equal(calls.length, beforeTrial);

  // The user's free public-page mode is independent of the unused/expired
  // paid trial. No bearer, provider billing confirmation or API calls occur.
  const paidBeforePublic = JSON.stringify(await xTrial());
  process.env.X_COLLECTION_MODE = 'public-page';
  delete process.env.X_API_BEARER_TOKEN;
  delete process.env.X_PROVIDER_LIMIT_CONFIRMED;
  await db.execute(sql`update tripwire_records set data=jsonb_set(data,'{enabled}','false'::jsonb) where kind='x-watch'`);
  await updateXWatch('x:watch:barakravid', true);
  await updateXWatch('x:watch:reuters', true); // Public scope still excludes outlet accounts.
  await db.execute(sql`update tripwire_records set data=(data-'nextCheck') ||
    '{"since":"777","token":"api-continuation","pages":2}'::jsonb where id='x:watch:barakravid'`);
  await writeRecord('workspace', { id: 'public-manual-overlap', kind: 'article', sourceType: 'x',
    title: 'Reviewed manual post', url: 'https://twitter.com/BarakRavid/status/1000',
    fullText: 'Reviewed manual wording', outlet: 'Axios' });
  let publicCalls = 0, publicMode = 'ok';
  const publicId = ids.get('barakravid');
  globalThis.fetch = async (url, opts) => {
    publicCalls++;
    assert.equal(url, 'https://x.com/barakravid');
    assert.equal(opts.headers.Authorization, undefined);
    await new Promise(resolve => setTimeout(resolve, 20));
    if (publicMode === 'blocked') return new Response('private error', { status: 429, headers: { 'retry-after': '3600' } });
    const html = publicMode === 'login' ? '<html>Log in</html>' : publicHtml('BarakRavid', publicId,
      (publicMode === 'older' ? ['998', '1001'] : ['1000', '1001']).map(id => publicPost(id, 'BarakRavid', publicId)));
    return new Response(html, { headers: { 'content-type': 'text/html' } });
  };
  await Promise.all([refreshXFeeds(), refreshXFeeds()]);
  assert.equal(publicCalls, 1, 'overlapping refreshes share the collector lock');
  let publicFeeds = await getXFeeds();
  assert.equal(publicFeeds.mode, 'public-page'); assert.equal(publicFeeds.status, 'ready');
  assert.equal(publicFeeds.trial, undefined);
  assert.equal(publicFeeds.accounts.find(a => a.handle === 'Reuters').status, 'outside-scope');
  assert.equal(publicFeeds.accounts.find(a => a.handle === 'BarakRavid').status, 'sampled');
  let publicRows = (await recordsFor('workspace')).filter(r => ['1000', '1001'].includes(r.xPost?.postId));
  assert.equal(publicRows.length, 2, 'manual overlap does not duplicate status IDs');
  assert.equal(publicRows.find(r => r.xPost.postId === '1000').fullText, 'Reviewed manual wording');
  assert.equal(publicRows.find(r => r.xPost.postId === '1001').xPost.origin, 'x-public-page');
  assert.equal(publicRows.find(r => r.xPost.postId === '1001').fullTextComplete, false);
  const publicWatch = async () => (await db.select().from(tripwireRecords).where(eq(tripwireRecords.id, 'x:watch:barakravid')))[0].data;
  assert.equal((await publicWatch()).since, '777');
  assert.equal((await publicWatch()).token, 'api-continuation');
  assert.equal((await publicWatch()).publicNewest, '1001');
  assert.equal(JSON.stringify(await xTrial()), paidBeforePublic, 'free collection never changes the paid trial');
  await assert.rejects(reserveX(1), e => e.status === 'setup-required');
  await collectorRestart();
  assert.equal(publicCalls, 1, 'restart and immediate manual check respect the interval');
  const publicDue = () => db.execute(sql`update tripwire_records set data=data-'nextCheck' where id='x:watch:barakravid'`);
  publicMode = 'older'; await publicDue(); await refreshXFeeds();
  assert.ok((await recordsFor('workspace')).some(r => r.xPost?.postId === '998'), 'later-visible older IDs are not skipped by a sample watermark');
  publicMode = 'login'; await publicDue(); await refreshXFeeds();
  assert.equal((await getXFeeds()).accounts.find(a => a.handle === 'BarakRavid').status, 'public-unreadable');
  assert.equal((await publicWatch()).publicNewest, '1001', 'failed page leaves the sample marker intact');
  const beforePause = publicCalls;
  await updateXWatch('x:watch:barakravid', false); await publicDue(); await refreshXFeeds();
  assert.equal(publicCalls, beforePause);
  await seedXAccounts();
  assert.equal((await getXFeeds()).accounts.find(a => a.handle === 'BarakRavid').enabled, false);
  await updateXWatch('x:watch:barakravid', true);
  publicMode = 'blocked'; await publicDue(); await refreshXFeeds();
  assert.equal((await getXFeeds()).status, 'rate-limited');
  const blockedCalls = publicCalls; await publicDue(); await refreshXFeeds();
  assert.equal(publicCalls, blockedCalls, 'manual checks cannot bypass durable public backoff');
  await db.execute(sql`update tripwire_records set data=(data-'retryAt'-'status') || '{"requests":100,"posts":0}'::jsonb where id='x:public:collector'`);
  await publicDue(); await refreshXFeeds();
  assert.equal(publicCalls, blockedCalls, 'daily public request cap is enforced before network access');
  assert.equal((await getXFeeds()).status, 'budget-limited');
  await updateXWatch('x:watch:barakravid'); await seedXAccounts();
  assert.ok(!(await getXFeeds()).accounts.some(a => a.handle === 'BarakRavid'));
  assert.equal(JSON.stringify(await xTrial()), paidBeforePublic);
} finally { await pool.end(); }
