import test from 'node:test';
import assert from 'node:assert/strict';
import { developmentSnapshot } from '../artifacts/tripwire/src/lib/feed-snapshot.ts';
const now = Date.parse('2026-11-09T16:00:00Z');
const article = (id, age, extra = {}) => ({id,title:`Reporting ${id}`,publishedAt:age===null?null:new Date(now-age*3600000).toISOString(),...extra});
test('publication windows include boundaries, exclude future and unknown dates, and never use edit time',()=>{
  const s=developmentSnapshot([article('a',0),article('b',6),article('c',6.01),article('d',24),article('e',24.01,{updatedAt:new Date(now).toISOString()}),article('f',null),article('g',-1)],now);
  assert.deepEqual([s.last6h,s.previous18h,s.last24h,s.earlier,s.undated,s.future],[2,2,4,1,1,1]);
  assert.equal(s.source.id,'a');assert.equal(s.status,'current');
});
test('overview deduplicates source identities and preserves source summary uncertainty rather than synthesizing facts',()=>{
  const a=article('a',1,{summary:'Officials may consider a change. The spokesperson denies that a decision has been made.'});
  const s=developmentSnapshot([a,a],now);
  assert.equal(s.last24h,1);assert.equal(s.excerpt,a.summary);assert.equal(s.excerptKind,'summary');
});
test('missing or repeated summary falls back to the original attributed headline',()=>{
  const s=developmentSnapshot([article('a',20,{title:'A tentative proposal',summary:'A tentative proposal'})],now);
  assert.equal(s.excerptKind,'headline');assert.equal(s.excerpt,'A tentative proposal');assert.equal(s.status,'recent');
});
test('older or undated coverage is not presented as current',()=>{
  assert.equal(developmentSnapshot([article('a',25)],now).status,'earlier');
  const s=developmentSnapshot([article('b',null)],now);
  assert.equal(s.status,'undated');assert.equal(s.last24h,0);
  assert.equal(developmentSnapshot([article('c',-2)],now).status,'future-dated');
});
test('long excerpts truncate without changing the retained source',()=>{
  const a=article('a',1,{summary:'The outlet reports a possible change. '.repeat(30)});
  const original=a.summary;const s=developmentSnapshot([a],now);
  assert(s.truncated);assert(s.excerpt.length<=421);assert(s.excerpt.endsWith('…'));assert.equal(a.summary,original);
});
