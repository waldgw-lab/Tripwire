import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultFeedFilters, emptyFeedFilters, filterSelectionCount, matchesFeedFilters } from '../artifacts/tripwire/src/lib/feed-filters.ts';

const article = { topic: 'Defense', outlet: 'Axios', reportingType: 'original', sentiment: 'negative', focus: 'performance' };
test('no checked categories include every item, including missing metadata', () => {
  assert.equal(matchesFeedFilters(article, 'critical', emptyFeedFilters()), true);
  assert.equal(matchesFeedFilters({}, undefined, emptyFeedFilters()), true);
});
test('multiple selections within a category are alternatives', () => {
  const filters = { ...emptyFeedFilters(), outlet: ['Axios', 'NBC'], impact: ['critical', 'high'] };
  assert.equal(matchesFeedFilters(article, 'critical', filters), true);
  assert.equal(matchesFeedFilters({ ...article, outlet: 'NBC' }, 'high', filters), true);
  assert.equal(matchesFeedFilters({ ...article, outlet: 'CNN' }, 'high', filters), false);
  assert.equal(matchesFeedFilters(article, 'low', filters), false);
});
test('categories combine as intersections', () => {
  const filters = { ...emptyFeedFilters(), outlet: ['Axios'], topic: ['Politics'], reporting: ['original'] };
  assert.equal(matchesFeedFilters(article, 'high', filters), false);
  assert.equal(matchesFeedFilters({ ...article, topic: 'Politics' }, 'high', filters), true);
});
test('reporting, sentiment and focus can all be multi-selected', () => {
  const filters = { ...emptyFeedFilters(), reporting: ['original', 'independent'], sentiment: ['negative', 'neutral'], focus: ['performance', 'replacement'] };
  assert.equal(matchesFeedFilters(article, 'critical', filters), true);
  assert.equal(matchesFeedFilters({ ...article, sentiment: 'positive' }, 'critical', filters), false);
});
test('missing assessments remain selectable as unassessed', () => {
  assert.equal(matchesFeedFilters({}, undefined, { ...emptyFeedFilters(), reporting: ['unassessed'], sentiment: ['unassessed'] }), true);
});
test('clearing one category preserves other restrictions', () => {
  const filters = { ...emptyFeedFilters(), outlet: ['Axios'], impact: ['critical'] };
  const cleared = { ...filters, outlet: [] };
  assert.equal(matchesFeedFilters({ ...article, outlet: 'NBC' }, 'critical', cleared), true);
  assert.equal(matchesFeedFilters(article, 'low', cleared), false);
});
test('empty filters supply fresh arrays and zero active count', () => {
  const previous = { ...emptyFeedFilters(), topic: ['Defense'], outlet: ['Axios', 'NBC'] };
  assert.equal(filterSelectionCount(previous), 3);
  const reset = emptyFeedFilters();
  assert.equal(filterSelectionCount(reset), 0);
  assert.equal(matchesFeedFilters(article, 'low', reset), true);
  reset.topic.push('Politics');
  assert.deepEqual(emptyFeedFilters().topic, []);
});
test('default and reset state select Critical and High, leaving Low unchecked and excluded', () => {
  const defaults = defaultFeedFilters();
  assert.deepEqual(defaults.impact, ['critical', 'high']);
  assert.equal(matchesFeedFilters(article, 'critical', defaults), true);
  assert.equal(matchesFeedFilters(article, 'high', defaults), true);
  assert.equal(matchesFeedFilters(article, 'low', defaults), false);
  assert.deepEqual(defaults.outlet, []);
  defaults.impact.push('low');
  assert.equal(matchesFeedFilters(article, 'low', defaults), true);
  assert.deepEqual(defaultFeedFilters().impact, ['critical', 'high']);
});
