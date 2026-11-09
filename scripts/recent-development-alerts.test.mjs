import test from 'node:test';
import assert from 'node:assert/strict';
import { recentDevelopmentAlerts } from '../artifacts/tripwire/src/lib/recent-development-alerts.ts';

const now = Date.parse('2026-11-09T18:00:00Z');
const article = (id, age, extra = {}) => ({
  id, kind: 'article', title: 'Pete Hegseth faces impeachment pressure', outlet: 'Reuters',
  publishedAt: new Date(now - age * 3_600_000).toISOString(),
  createdAt: new Date(now).toISOString(), ...extra,
});
const rows = groups => groups.flatMap(g => g.articles.map(a => a.id)).sort();

test('alerts use a strict publication-based 12-hour window including its boundary', () => {
  const input = [article('new', 0), article('boundary', 12), article('old', 12.001),
    article('future', -0.001), article('undated', 1, { publishedAt: null }),
    article('date-only', 0, { publishedAt: '2026-11-09' }),
    article('no-offset', 0, { publishedAt: '2026-11-09T17:00:00' }),
    article('invalid', 0, { publishedAt: '2026-11-09T28:00:00Z' }),
    article('impossible-date', 0, { publishedAt: '2026-02-30T18:00:00Z' }),
    article('hidden', 0, { hidden: true }), article('claim', 0, { kind: 'claim' })];
  assert.deepEqual(rows(recentDevelopmentAlerts(input, [], now)), ['boundary', 'new']);
  assert.deepEqual(rows(recentDevelopmentAlerts([article('offset', 0, { publishedAt: '2026-11-09T08:00:00-05:00' })], [], now)), ['offset']);
  assert.deepEqual(recentDevelopmentAlerts(input, [], now + 13 * 3_600_000), []);
});

test('noteworthy prompts use existing headline indicators or effective prominence, not routine intake', () => {
  const input = [
    article('headline', 1),
    article('routine', 0, { title: 'Pete Hegseth makes first visit to a naval base', impact: 'low' }),
    article('high', 0.5, { title: 'Consequential new funding announcement', impact: 'high', impactMode: 'manual' }),
    article('critical', 2, { title: 'Unusual institutional decision', impactMode: 'auto', automaticAssessment: { impact: 'critical' } }),
    article('stale-rating', 3, { title: 'Routine committee visit', impact: 'high', impactMode: 'auto', automaticAssessment: { impact: 'low' } }),
  ];
  const alerts = recentDevelopmentAlerts(input, [], now);
  assert.deepEqual(rows(alerts), ['critical', 'headline', 'high']);
  assert.equal(alerts[0].articles[0].id, 'high');
  assert.equal(alerts[1].articles[0].title, input[0].title);
  assert.equal(alerts[0].highestImpact, 'high');
});

test('deduplicate coverage, keep exact focus links, and never reuse older coverage as a fresh signal', () => {
  const fresh = article('one', 1);
  const summaries = [{ claimId: 'c', attributions: 3, firstDate: null, lastDate: null,
    placements: [{ categoryId: 'staff', topicId: 'hegseth', topicTitle: 'Pentagon leadership', articleIds: ['one'] },
      { categoryId: 'other', topicId: 'unrelated', topicTitle: 'Other', articleIds: ['old'] }] }];
  const alerts = recentDevelopmentAlerts([fresh, fresh, article('two', 2), article('old', 13)], summaries, now);
  assert.equal(alerts.length, 1);
  assert.deepEqual(rows(alerts), ['one', 'two']);
  assert.deepEqual(alerts[0].claimLinks, [{ categoryId: 'staff', topicId: 'hegseth', title: 'Pentagon leadership', articleCount: 1 }]);
  const routine = article('routine', 0, { title: 'Routine committee meeting' });
  assert.deepEqual(recentDevelopmentAlerts([routine, article('old', 13, { title: 'Routine committee meeting', impact: 'critical' })], [], now), []);
  assert.equal(recentDevelopmentAlerts([fresh], [], now)[0].claimLinks.length, 0);
});
