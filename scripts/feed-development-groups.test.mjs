import test from 'node:test';
import assert from 'node:assert/strict';
import { groupFeedArticles } from '../artifacts/tripwire/src/lib/feed-development-groups.ts';
const epoch = Date.parse('2026-11-09T15:00:00Z');
const a = (id, title, hour = 0, extra = {}) => ({ id, kind: 'article', title, outlet: 'Reuters', publishedAt: new Date(epoch-hour*3600000).toISOString(), createdAt: new Date(epoch).toISOString(), ...extra });
const ids = groups => groups.flatMap(g => g.articles.map(a => a.id)).sort();

test('lossless partition includes unlinked, low, unenriched, video, opinion and undated items exactly once', () => {
  const rows = [a('a', 'Pete Hegseth impeachment efforts grow'), a('b', 'Trump says he will not fire Hegseth', 1, { contentFormat: 'video' }),
    a('c', 'An unrelated headline', 2, { impact: 'low', contentType: 'opinion' }), a('d', 'No publication time', 0, { publishedAt: null })];
  assert.deepEqual(ids(groupFeedArticles([...rows, rows[0]])), ['a','b','c','d']);
  assert(groupFeedArticles(rows).some(g => g.articles.length === 2));
  assert.deepEqual(rows.map(r => r.id), ['a','b','c','d']);
});
test('headline-level development grouping works without Claims or complete article text', () => {
  const g = groupFeedArticles([a('a', 'Stephen Miller replacing Susie Wiles as Trump chief of staff'), a('b', 'Susie Wiles exit adds to list of women leaving top roles in Trump administration', 1)]);
  assert.equal(g.length, 1); assert.equal(g[0].articles.length, 2); assert.equal(g[0].claimLinks.length, 0);
});
test('different Millers, incidental finance references and first visits do not become staffing pressure', () => {
  const g = groupFeedArticles([a('s', 'Stephen Miller becomes White House chief of staff'), a('m', 'Matt Miller describes White House chief of staff role'),
    a('w', 'Wall Street rallies as Trump says he will not fire Hegseth'), a('f', 'Pete Hegseth makes first visit to a naval base')]);
  assert.equal(g.length, 4);
  assert(g.find(g => g.articles[0].id === 'f').kind === 'single');
});
test('military reporting and negotiation reporting are distinct, not a country-only cluster', () => {
  const g = groupFeedArticles([a('a', 'Iran missile attacks hit US base'), a('b', 'Iran peace talks resume in Qatar')]);
  assert.equal(g.length, 2); assert.notEqual(g[0].title, g[1].title);
});
test('72-hour windows cannot grow indefinitely by transitive chaining', () => {
  const g = groupFeedArticles([0, 71, 142].map((h,i) => a(String(i), 'Pete Hegseth impeachment efforts grow', h)));
  assert.equal(g.length, 2);
  assert(g.every(g => Date.parse(g.latestAt)-Date.parse(g.earliestAt) <= 72*3600000));
});
test('unknown publication dates remain standalone and are not replaced by creation or edit time', () => {
  const g = groupFeedArticles([a('a', 'Pete Hegseth impeachment efforts grow', 200), a('b', 'Pete Hegseth impeachment efforts grow', 0, { publishedAt: null, impact: 'critical' })]);
  assert.equal(g.length, 2); assert.equal(g[1].latestAt, null); assert.equal(g[1].articles[0].id, 'b');
});
test('recency dominates relevance; impact is a bounded, explainable boost', () => {
  const g = groupFeedArticles([a('old', 'Old consequential report', 48, {impact:'critical'}), a('new', 'Fresh consequential report', 0, {impact:'high'}), a('near', 'Recent critical report', 0.5, {impact:'critical'})]);
  assert.equal(g[0].articles[0].id, 'near'); assert.equal(g.at(-1).articles[0].id, 'old');
  assert.equal(groupFeedArticles(g.flatMap(g=>g.articles), {order:'newest'})[0].articles[0].id, 'new');
});
test('many outlets cannot push yesterday’s cluster over fresh reporting', () => {
  const old = Array.from({length:30},(_,i)=>a(`o${i}`, 'Pete Hegseth impeachment efforts grow', 24, {outlet:`Outlet ${i}`,impact:'critical'}));
  assert.equal(groupFeedArticles([...old, a('fresh','A fresh stand-alone accountability report',0,{impact:'high'})])[0].articles[0].id, 'fresh');
});
test('outlet aliases count once while their articles stay separate', () => {
  const [g] = groupFeedArticles([a('a','Pete Hegseth impeachment efforts grow',0,{outlet:'NBC'}),a('b','Pete Hegseth faces impeachment',1,{outlet:'NBC News'})]);
  assert.equal(g.outlets.length, 1); assert.equal(g.articles.length, 2);
});
test('tone counts reflect recorded fields, including unassessed; no inferred neutral or bias score', () => {
  const [g] = groupFeedArticles([a('a','Pete Hegseth impeachment efforts grow',0,{sentiment:'negative'}),a('b','Pete Hegseth impeachment response',1),a('c','Pete Hegseth impeachment debate',2,{sentiment:'mixed'})]);
  assert.deepEqual(g.tones, {positive:0, negative:1, neutral:0, mixed:1, unassessed:1});
  assert.equal(g.bias, undefined);
});
test('Claims links require an exact article link and honor source-specific placements', () => {
  const rows = [a('a','Pete Hegseth impeachment efforts grow'), a('b','A separate policy article')];
  const summaries = [{claimId:'c',articleIds:['a','b'],categoryId:'staff',topicId:'staff',topicTitle:'Staffing',placements:[
    {articleIds:['a'],categoryId:'staff',topicId:'staff',topicTitle:'Staffing'},
    {articleIds:['b'],categoryId:'policy',topicId:'policy',topicTitle:'Policy'}]}];
  const g = groupFeedArticles(rows,{summaries});
  assert.deepEqual(g.find(g=>g.articles[0].id==='a').claimLinks,[{categoryId:'staff',topicId:'staff',title:'Staffing',articleCount:1}]);
  assert.deepEqual(g.find(g=>g.articles[0].id==='b').claimLinks,[{categoryId:'policy',topicId:'policy',title:'Policy',articleCount:1}]);
  assert.deepEqual(ids(g), ids(groupFeedArticles(rows)));
});
test('input order cannot change the partition or its stable identifiers', () => {
  const rows = [a('a','Pete Hegseth impeachment efforts grow'), a('b','Pete Hegseth faces impeachment'),a('c','A separate policy article')];
  assert.deepEqual(groupFeedArticles(rows),groupFeedArticles([...rows].reverse()));
});
test('very similar headlines cluster conservatively, without changing original wording', () => {
  const rows = [a('a','Officials publish detailed safety audit findings for metropolitan railway network'),
    a('b','Officials publish detailed safety audit findings for metropolitan railway network today',1)];
  const [g] = groupFeedArticles(rows);
  assert.equal(g.kind,'similar-headlines'); assert.equal(g.articles[1].title,rows[1].title);
});
test('different explicit place names block a generic incident-headline match', () => {
  const g = groupFeedArticles([a('a','Explosion at warehouse kills eleven in Kansas'),a('b','Explosion at warehouse kills eleven in Boston',1)]);
  assert.equal(g.length,2);
});
test('flagged-first remains an explicit user ordering override', () => {
  const rows = [a('new','New reporting'),a('flag','Older flagged reporting',48,{flagged:true})];
  assert.equal(groupFeedArticles(rows,{flaggedFirst:true})[0].articles[0].id,'flag');
  const legacy = [rows[0], a('saved','Legacy saved article',50,{saved:true})];
  assert.equal(groupFeedArticles(legacy,{flaggedFirst:true})[0].articles[0].id,'saved');
  legacy[1].flagged = false;
  assert.equal(groupFeedArticles(legacy,{flaggedFirst:true})[0].articles[0].id,'new');
});
