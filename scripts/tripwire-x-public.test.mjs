import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicX, XPublicPage } from '../artifacts/api-server/src/lib/tripwire-x-public.ts';
import { xAccess } from '../artifacts/api-server/src/lib/tripwire-x-api.ts';
import { publicHtml, publicPost, publicUser, publicEntry } from './fixtures/x-public-html.mjs';

test('public sample preserves exact post text, account, publication time and safe photo', () => {
  const p = publicPost('101');
  p.details.full_text = 'Exact <text> & https://t.co/example';
  const r = parsePublicX(publicHtml('BarakRavid', '1', [p]), '@barakravid');
  assert.equal(r.user.id, '1'); assert.equal(r.user.username, 'BarakRavid');
  assert.equal(r.user.profile_image_url, 'https://pbs.twimg.com/profile_images/1/fixture.jpg');
  assert.equal(r.page.data[0].text, p.details.full_text);
  assert.equal(r.page.data[0].created_at, '2026-11-09T12:34:56.000Z');
});
test('public parsing excludes pins, other authors and recommendations; deduplicates and caps at twenty', () => {
  const posts = Array.from({ length: 30 }, (_, i) => publicPost(String(200 + i)));
  posts.push(posts[0], publicPost('999', 'someoneElse', '2'));
  const r = parsePublicX(publicHtml('BarakRavid', '1', posts, [
    { __typename: 'TimelinePinEntry', entry: publicEntry(publicPost('500')) },
  ]), 'BarakRavid');
  assert.equal(r.page.data.length, 20);
  assert.equal(r.page.data[0].id, '229');
  assert.ok(!r.page.data.some(p => p.id === '999' || p.id === '500'));
  assert.equal(r.page.meta.next_token, undefined);
});
test('quote/reply relationships retain separate authors and text; truncation stays explicit', () => {
  const p = publicPost('101', 'BarakRavid', '1', {
    quoted_tweet_results: { result: publicPost('99', 'original', '2') },
    legacy: { truncated: true },
  });
  p.details.in_reply_to_status_id_str = '98';
  const r = parsePublicX(publicHtml('BarakRavid', '1', [p]), 'BarakRavid');
  assert.deepEqual(r.page.data[0].referenced_tweets, [{ id: '98', type: 'replied_to' }, { id: '99', type: 'quoted' }]);
  assert.equal(r.page.data[0].text_truncated, true);
  assert.equal(r.page.data[0].author_id, '1');
  assert.equal(r.page.includes.tweets[0].author_id, '2');
  assert.equal(r.page.includes.users.find(u => u.id === '2').username, 'original');
});
test('blocked/login/changed HTML is not treated as empty; identity mismatch and protected profiles are rejected', () => {
  for (const html of ['<html>Log in</html>', '<script>globalThis.pwned = true</script>', '<html>']) {
    assert.throws(() => parsePublicX(html, 'BarakRavid'), e => e.status === 'public-unreadable');
  }
  assert.equal(globalThis.pwned, undefined);
  assert.throws(() => parsePublicX(publicHtml('other', '1', []), 'BarakRavid'), e => e.status === 'account-unavailable');
  const user = publicUser(); user.privacy.protected = true;
  assert.throws(() => parsePublicX(publicHtml('BarakRavid', '1', [], [], user), 'BarakRavid'), e => e.status === 'account-unavailable');
  assert.equal(parsePublicX(publicHtml('BarakRavid', '1', []), 'BarakRavid').page.data.length, 0);
  const invalid = publicPost(); invalid.details.created_at_ms = 'bad';
  assert.throws(() => parsePublicX(publicHtml('BarakRavid', '1', [invalid]), 'BarakRavid'), e => e.status === 'invalid-response');
});
test('public fetching uses only fixed HTTPS profile pages with no credentials, redirects or scripts', async () => {
  let calls = 0, reserved = 0, returned;
  const client = new XPublicPage(async () => { reserved++; return async n => { returned = n; }; }, async (url, options) => {
    calls++;
    assert.equal(url, 'https://x.com/barakravid');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers.Cookie, undefined);
    return new Response(publicHtml(), { headers: { 'content-type': 'text/html' } });
  });
  assert.equal((await client.profile('BarakRavid')).page.data.length, 1);
  assert.equal(calls, 1); assert.equal(reserved, 1); assert.equal(returned, 1);
  await assert.rejects(client.profile('https://evil.example/account'), e => e.status === 'account-unavailable');
  assert.equal(calls, 1);
});
test('public transport enforces size, 429 delay and login redirect failures without settlement', async () => {
  for (const response of [
    new Response('blocked', { status: 429, headers: { 'retry-after': '3600' } }),
    new Response('', { status: 302, headers: { location: 'https://x.com/i/flow/login' } }),
    new Response('x'.repeat(2_000_001), { headers: { 'content-type': 'text/html' } }),
  ]) {
    let settled = false;
    const client = new XPublicPage(async () => async () => { settled = true; }, async () => response);
    await assert.rejects(client.profile('BarakRavid'), e => {
      if (response.status === 429) assert.ok(Date.parse(e.retryAt) >= Date.now() + 3_590_000);
      return ['rate-limited', 'public-blocked', 'public-unreadable'].includes(e.status);
    });
    assert.equal(settled, false);
  }
});
test('public mode requires approval and caps but no token; defaults remain API-gated', () => {
  const env = { X_COLLECTION_MODE: 'public-page', X_COLLECTION_APPROVED: 'true', X_DAILY_REQUEST_LIMIT: '9999', X_DAILY_POST_LIMIT: '99999' };
  assert.deepEqual(xAccess(env), { ready: true, approved: true, requestLimit: 1500, postLimit: 10000 });
  assert.equal(xAccess({ ...env, X_COLLECTION_APPROVED: 'false' }).ready, false);
  assert.equal(xAccess({ ...env, X_COLLECTION_MODE: 'api' }).ready, false);
});
