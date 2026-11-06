import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordImpact, criticalIntakeItems, compareRetrievalPriority, automaticRetrievalAllowed, needsArticleText } from '../artifacts/api-server/src/lib/tripwire-priority.ts';
import { impactRating } from '../artifacts/tripwire/src/lib/article-signals.ts';

const now = Date.parse('2026-11-06T15:00:00Z');
const article = (id, fields = {}) => ({ id, kind: 'article', title: id, createdAt: new Date(now - 1000).toISOString(), ...fields });
const watch = { id: 'watch', kind: 'watch', title: 'Donald Trump', aliases: ['Trump'], watchType: 'position', tier: 1, enabled: true };
const watches = [watch];

test('retrieval impact agrees with the feed for overrides, original reporting, watchlist and accountability', () => {
  const samples = [
    { title: 'Trump responds' }, { title: 'Donald Trump responds', impact: 'low' },
    { title: 'Other story', reportingType: 'original' }, { title: 'Other', reportingType: 'independent' },
    { title: 'Other', focus: 'replacement' }, { title: 'Other', summary: 'Donald Trump spoke' },
    { title: 'Other', entities: ['Donald Trump'] }, { title: 'A trumpet sounds' },
    { title: 'Other', impact: 'critical' }, { title: 'Other', impact: 'high' }, { title: 'Other' },
  ];
  for (const a of samples) assert.equal(recordImpact(a, watches), impactRating(a, watches).value);
  assert.equal(recordImpact({ title: 'Trump responds' }, [{ ...watch, enabled: false }]), 'low');
});
test('Critical precedes High regardless of outlet fairness and recency', () => {
  const a = article('critical', { impact: 'critical', outlet: 'busy', publishedAt: '2026-11-01T00:00:00Z' });
  const b = article('high', { impact: 'high', outlet: 'new', publishedAt: '2026-11-06T14:59:00Z' });
  assert.ok(compareRetrievalPriority(a, b, watches, new Map([['busy', 500]])) < 0);
  assert.ok(compareRetrievalPriority(b, article('low', { impact: 'low' }), watches, new Map()) < 0);
});
test('automatic Low requests stop but a deliberate single-item request is allowed once', () => {
  const low = article('low', { impact: 'low', retainedContent: [{ source: 'rss:content', textLength: 500 }] });
  assert.equal(automaticRetrievalAllowed(low, watches), false);
  assert.equal(automaticRetrievalAllowed({ ...low, retrieval: { manualRequested: true } }, watches), true);
  assert.equal(low.retainedContent[0].textLength, 500);
  assert.equal(automaticRetrievalAllowed(article('complete', { impact: 'critical', fullTextComplete: true }), watches), false);
});
test('queue is based on ingestion/discovery time, not publication or later edits', () => {
  const records = [
    watch,
    article('new-old-story', { impact: 'critical', publishedAt: '2020-01-01T00:00:00Z' }),
    article('stale-ingestion', { impact: 'critical', createdAt: new Date(now - 13 * 3600000).toISOString(), publishedAt: new Date(now).toISOString() }),
    article('old-discovery-new-shadow', { impact: 'critical', discoveredAt: new Date(now - 13 * 3600000).toISOString() }),
    article('boundary', { impact: 'critical', createdAt: new Date(now - 12 * 3600000).toISOString() }),
    article('future', { impact: 'critical', createdAt: new Date(now + 1000).toISOString() }),
    article('high', { impact: 'high' }),
  ];
  assert.deepEqual(criticalIntakeItems(records, now).map(a => a.id), ['new-old-story', 'boundary']);
});
test('RSS-only partials need article text, enriched copies and full articles do not', () => {
  const rss = article('rss', { summary: 'summary', retainedContent: [{ source: 'rss:content', textLength: 800 }] });
  assert.equal(needsArticleText(rss), true);
  for (const source of ['paste', 'file', 'url', 'page:publisher article paragraphs']) {
    assert.equal(needsArticleText({ ...rss, retainedContent: [{ source, textLength: 1000 }] }), false);
  }
  assert.equal(needsArticleText({ ...rss, retainedContent: [{ source: 'page:response', rawLength: 50000, textLength: 0 }] }), true);
  assert.equal(needsArticleText({ ...rss, fullTextComplete: true }), false);
});
