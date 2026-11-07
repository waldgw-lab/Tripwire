import test from 'node:test';
import assert from 'node:assert/strict';
import { claimDevelopments, developmentKind } from '../artifacts/api-server/src/lib/claim-developments.ts';
import { orderClaims } from '../artifacts/tripwire/src/lib/claim-order.ts';
const now = Date.parse('2026-11-07T18:00:00Z');
const article = (id, publishedAt, title = 'White House leadership reporting', extra = {}) =>
  ({ id, data: { kind: 'article', title, publishedAt, ...extra } });
const claim = (id, title) => ({ id, data: { kind: 'claim', title } });

test('leadership reports, denials and appointments remain attributed development topics', () => {
  for (const text of ['President Trump is considering firing Hegseth or Caine.',
    'Trump denied that he had decided to replace Hegseth.',
    'Stephen Miller would replace Susie Wiles as White House chief of staff.',
    'Miller is set to take over the role Monday, replacing Susie Wiles.'])
    assert.equal(developmentKind(text, 'White House chief of staff reporting', now), 'Leadership & staffing');
});
test('background statistics and a different Miller campaign do not become White House developments', () => {
  assert.equal(developmentKind('Since 1934 the sitting president gained seats three times.', 'Election results', now), null);
  assert.equal(developmentKind('Miller defied calls to end his campaign so Republicans could replace him on the ballot.', 'Trump midterm results', now), null);
  assert.equal(developmentKind('In 2018 President Trump fired his chief of staff.', 'White House history', now), null);
});
test('combat, ship fires and under-fire wording are not personnel firings', () => {
  for (const text of ['President Trump said two oil tankers caught fire in the strait.',
    'President Trump said the ships caught on fire.', 'The Pentagon said Iran fired missiles at ships.',
    'President Trump said shots were fired.', 'The defense secretary came under fire from critics.'])
    assert.notEqual(developmentKind(text, 'Pentagon developments', now), 'Leadership & staffing', text);
  assert.equal(developmentKind('President Trump may fire his defense secretary.', 'Pentagon developments', now), 'Leadership & staffing');
});
test('a leadership mention elsewhere in a copied block cannot promote non-personnel replacement or removal', () => {
  assert.notEqual(developmentKind("The Iranian supreme leader's adviser said Iran is an architect of security in the Middle East. Referring to geopolitical changes across the region, he described a new regional order and a reality that cannot be erased or replaced.", 'Trump Iran reporting', now), 'Leadership & staffing');
  assert.notEqual(developmentKind("The judge ordered the government to give notice before deporting Iranians. The administration maintained contacts with Iranian officials during the war over the removals, specifically for submitting travel documents and figuring out possible avenues for removal.", 'Trump Iran reporting', now), 'Leadership & staffing');
});
test('pending policy and institutional relationships qualify without requiring firing language', () => {
  assert.equal(developmentKind('The president is considering new military strikes.', 'Foreign policy', now), 'Decisions & policy');
  assert.equal(developmentKind('Pentagon officials described disagreements with presidential advisers.', 'Cabinet reporting', now), 'Institutional relationships');
});
test('recent linked publications qualify; save, ingestion and observation timestamps cannot revive stale claims', () => {
  const records = [claim('c', 'President Trump is considering firing Hegseth.'),
    article('a', '2026-11-06T12:00:00Z')];
  const d = claimDevelopments(records, [{ claim_id: 'c', article_id: 'a' }], now).get('c');
  assert.equal(d.ongoing, true); assert.equal(d.latestReportAt, '2026-11-06T12:00:00Z');
  for (const date of ['2025-11-06T12:00:00Z', '2026-11-09T12:00:00Z', '2026-02-30', undefined]) {
    records[1] = article('a', date, 'White House', { createdAt: '2026-11-07T12:00:00Z' });
    assert.equal(claimDevelopments(records, [{ claim_id: 'c', article_id: 'a' }], now).get('c').ongoing, false);
  }
});
test('hidden/unlinked sources cannot promote a claim, including a hidden workspace override', () => {
  const rows = [claim('c', 'Trump may replace Hegseth.'), article('workspace:a', '2026-11-06', 'White House', { hidden: true, baseId: 'a' })];
  const result = claimDevelopments(rows, [{ claim_id: 'c', article_id: 'a' }], now).get('c');
  assert.equal(result.ongoing, false); assert.equal(result.latestReportAt, null);
});
test('source proposition, not an unrelated edited family title, determines prominence', () => {
  const rows = [claim('c', 'Trump considering firing Hegseth'), article('a', '2026-11-06', 'President Trump midterms')];
  assert.equal(claimDevelopments(rows, [{ claim_id: 'c', article_id: 'a', proposition: 'There are 435 House seats.' }], now).get('c').ongoing, false);
});
test('ongoing comes first, then actual reporting dates, never bulk-save order; input remains unchanged', () => {
  const rows = [{ id: 'stats', title: 'Statistics', updatedAt: '2099-01-01' },
    { id: 'older', title: 'Older leadership reporting' }, { id: 'newer', title: 'Latest appointment reporting' }];
  const summaries = new Map([
    ['stats', { ongoing: false, lastDate: '2026-11-07' }],
    ['older', { ongoing: true, lastDate: '2026-11-05' }],
    ['newer', { ongoing: true, lastDate: '2026-11-06' }],
  ]);
  assert.deepEqual(orderClaims(rows, summaries).map(c => c.id), ['newer', 'older', 'stats']);
  assert.equal(rows[0].id, 'stats');
  assert.deepEqual(orderClaims(rows, new Map()).map(c => c.id).sort(), rows.map(c => c.id).sort());
});
test('leadership changes lead other ongoing policy reporting', () => {
  const rows = [{ id: 'policy', title: 'Latest policy report' }, { id: 'staff', title: 'Chief of staff reporting' }];
  const summaries = new Map([
    ['policy', { ongoing: true, developmentType: 'Decisions & policy', lastDate: '2026-11-07' }],
    ['staff', { ongoing: true, developmentType: 'Leadership & staffing', lastDate: '2026-11-06' }],
  ]);
  assert.equal(orderClaims(rows, summaries)[0].id, 'staff');
});
