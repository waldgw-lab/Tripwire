import test from 'node:test';
import assert from 'node:assert/strict';
import { articleFocus, organizeArticleFocus } from '../artifacts/api-server/src/lib/article-focus.ts';
import { summariesForClaim, summaryForArticle, matchesClaimFilter, indexClaimsByArticle, groupClaimsByArticle, groupKey } from '../artifacts/tripwire/src/lib/claim-group-core.ts';
const now = Date.parse('2026-11-08T15:00:00Z');
const article = (id, title, more = {}) => ({ id, data: { kind: 'article', title, publishedAt: '2026-11-08T12:00:00Z', ...more } });
const claim = (id, title) => ({ id, data: { kind: 'claim', title } });
const summary = claimId => ({ claimId, attributions: 1, firstDate: '2026-11-08', lastDate: '2026-11-08', latestReportAt: '2026-11-08T12:00:00Z' });

test('an analyst home moves only one article without rewriting shared claims or source links', () => {
  const override = { categoryId: 'courts-legal', topicId: 'analyst-court', topicTitle: 'Court oversight — corrected label' };
  const rows = [article('a', 'Pete Hegseth faces possible removal', { focusOverride: override }),
    article('b', 'Pete Hegseth faces possible removal'), claim('shared', 'Congress opened an investigation.')];
  const links = [{ claim_id: 'shared', article_id: 'a' }, { claim_id: 'shared', article_id: 'b' }];
  const before = structuredClone({ rows, links });
  const [out] = organizeArticleFocus(rows, links, [summary('shared')], now);
  assert.equal(out.claimId, 'shared');
  assert.equal(out.placements.length, 2);
  assert.deepEqual(summaryForArticle(out, 'a').articleIds, ['a']);
  assert.equal(summaryForArticle(out, 'a').topicTitle, override.topicTitle);
  assert.equal(summaryForArticle(out, 'b').topicTitle, 'Pentagon leadership — Pete Hegseth');
  assert.deepEqual({ rows, links }, before);
  assert.equal(articleFocus({ ...rows[0].data, focusOverride: null }, 'a').topicTitle, 'Pentagon leadership — Pete Hegseth');
  assert.equal(articleFocus({ ...rows[0].data, focusOverride: { ...override, categoryId: 'not-real' } }, 'a').categoryId, 'leadership-staffing');
});

test('impeachment, confidence and incidental background stay under their article focus', () => {
  const rows = [article('a', 'House poised to impeach Pete Hegseth'), claim('c1', 'Congress opened an impeachment inquiry into Hegseth.'), claim('c2', 'The president expressed confidence in Pete Hegseth.'), claim('c3', 'The judge was appointed to the court by former President Barack Obama.')];
  const before = structuredClone(rows);
  const out = organizeArticleFocus(rows, rows.slice(1).map(c => ({ claim_id: c.id, article_id: 'a', proposition: c.data.title })), rows.slice(1).map(c => summary(c.id)), now);
  assert.deepEqual([...new Set(out.map(s => s.topicTitle))], ['Pentagon leadership — Pete Hegseth']);
  assert(out.every(s => s.categoryId === 'leadership-staffing' && s.articleIds[0] === 'a'));
  assert(out[0].developments.includes('Impeachment efforts'));
  assert(out[0].developments.includes('Leadership confidence'));
  assert.equal(out[2].placements[0].ongoing, false);
  assert.deepEqual(rows, before);
});

test('one shared claim keeps exact article-local homes, dates, filters and counts', () => {
  const rows = [article('a', 'Pete Hegseth faces possible removal'), article('b', 'Senator supports gun control on public health grounds', { publishedAt: null }), claim('shared', 'Congress is considering an investigation.'), claim('only-a', 'Pete Hegseth has the president’s confidence.')];
  const out = organizeArticleFocus(rows, [
    { claim_id: 'shared', article_id: 'a' }, { claim_id: 'shared', article_id: 'b' }, { claim_id: 'only-a', article_id: 'a' },
  ], [summary('shared'), summary('only-a')], now);
  assert.deepEqual(out[0].articleIds, ['a', 'b']);
  assert.equal(out[0].placements.length, 2);
  const byId = new Map(out.map(s => [s.claimId, s]));
  const idx = indexClaimsByArticle(out);
  const filter = category => ({ mode: 'with', categories: [category], topics: [] });
  assert.equal(matchesClaimFilter('a', filter('policy-rulemaking'), idx, byId), false);
  assert.equal(matchesClaimFilter('b', filter('policy-rulemaking'), idx, byId), true);
  assert.equal(summaryForArticle(out[0], 'b').latestReportAt, null);
  assert.equal(summaryForArticle(out[0], 'b').ongoing, false);
  assert.equal(summaryForArticle(out[0], 'a').ongoing, true);
  const placements = out.flatMap(s => summariesForClaim(s));
  const homes = new Map();
  for (const s of placements) for (const id of s.articleIds) {
    if (homes.has(id)) assert.equal(homes.get(id), groupKey(s));
    homes.set(id, groupKey(s));
  }
  const staff = new Map(placements.filter(s => s.categoryId === 'leadership-staffing').map(s => [s.claimId, s]));
  assert.equal(groupClaimsByArticle(rows.slice(2).map(c => ({ id: c.id })), staff).articleCount, 1);
  assert.deepEqual(summaryForArticle(out[0], 'b').articleIds, ['b']);
});

test('incidental HHS and hypothetical Ossoff resignation do not create staffing topics', () => {
  const rows = [article('hhs', 'South Carolina senator supports gun control on public health grounds'), article('ossoff', 'Jon Ossoff wins 2028 presidential straw poll'), claim('h', 'After Trump took office the advisory was removed from the Department of Health and Human Services website.'), claim('o', 'Ossoff’s term ends in 2032, meaning if elected as president he would have to resign his seat.')];
  const out = organizeArticleFocus(rows, [{ claim_id: 'h', article_id: 'hhs' }, { claim_id: 'o', article_id: 'ossoff' }], [summary('h'), summary('o')], now);
  assert.equal(out[0].topicTitle, 'Firearms — public-health policy');
  assert.equal(out[0].categoryId, 'policy-rulemaking');
  assert.equal(out[1].topicTitle, 'Jon Ossoff — 2028 presidential prospects');
  assert.equal(out[1].categoryId, 'elections-control');
  assert.equal(out[1].ongoing, false);
});

test('multi-topic roundup articles have one home; claims cannot vote them into separate categories', () => {
  const rows = [article('a', 'Democrats prepare to take Congress as GOP grapples with losses'), claim('h', 'President Trump may replace Pete Hegseth.'), claim('m', 'Stephen Miller was appointed chief of staff.'), claim('d', 'Harmeet Dhillon resigned from the Justice Department.')];
  const out = organizeArticleFocus(rows, rows.slice(1).map(c => ({ claim_id: c.id, article_id: 'a' })), rows.slice(1).map(c => summary(c.id)), now);
  assert.equal(new Set(out.map(s => s.topicId)).size, 1);
  assert(out.every(s => s.categoryId === 'elections-control'));
  assert(out[0].relatedSubjects.includes('Stephen Miller'));
  assert.equal(out[0].topicTitle, 'Congress — post-midterm balance of power');
});

test('unrecognized focus uses the real headline, not a name or sentence fragment', () => {
  const f = articleFocus({ title: 'What the next chapter could bring', summary: 'Barack Obama was mentioned in a historical aside.' }, 'id');
  assert.equal(f.topicTitle, 'What the next chapter could bring');
  assert.equal(f.topicId, 'article-id');
  assert.equal(f.categoryId, 'uncategorized');
});

test('an incidental Miller citation cannot pull an immigration article into White House staffing', () => {
  const f = articleFocus({ title: 'ICE unlikely to scale back crackdown, sources say, citing Stephen Miller',
    summary: 'White House chief of staff Stephen Miller supports the immigration policy.' }, 'immigration');
  assert.equal(f.topicId, 'immigration-enforcement');
  assert.equal(f.categoryId, 'operations-enforcement');
});

test('a secondary Hegseth mention cannot override a financial-market headline focus', () => {
  const f = articleFocus({ title: 'Wall Street explodes with its best day in months after blue tsunami as Trump denies he will fire Hegseth' }, 'markets');
  assert.equal(f.topicId, 'financial-markets');
  assert.equal(f.categoryId, 'resources-capabilities');
});

test('a conditional resignation is discussion, not a reported departure', () => {
  const rows = [article('a', 'House poised to impeach Pete Hegseth'), claim('c', 'If Hegseth resigns, I will not reintroduce impeachment articles.')];
  const [s] = organizeArticleFocus(rows, [{ claim_id: 'c', article_id: 'a' }], [summary('c')], now);
  assert(s.developments.includes('Departures & resignation discussions'));
  assert(!s.developments.includes('Reported departures'));
});
