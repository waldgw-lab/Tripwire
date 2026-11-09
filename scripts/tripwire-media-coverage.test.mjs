import { test } from 'node:test';
import assert from 'node:assert/strict';
import { articleCredits, buildMediaCoverage, coverageAtOutlet, surnameKey, sortJournalists, xPostsAtOutlet, xAccountMatchesPost } from '../artifacts/tripwire/src/lib/media-coverage.ts';
import { parseByline } from '../artifacts/api-server/src/lib/tripwire-bylines.ts';

const article = (id, credits, extra = {}) => ({ id, title: id, kind: 'article', outlet: 'Outlet A', credits, publishedAt: '2026-11-05T12:00:00Z', ...extra });
const author = name => ({ name, role: 'author' });
const watch = (name, extra = {}) => ({ id: `watch-${name}`, kind: 'watch', watchType: 'journalist', title: name, outlet: 'Outlet A', ...extra });

test('RSS multi-author names, middle initials and suffixes are retained', () => {
  assert.deepEqual(parseByline('By Jane A. Doe, Martin Luther King, Jr. and John Smith').map(c => c.name), ['Jane A. Doe', 'Martin Luther King, Jr.', 'John Smith']);
});
test('explicit contributor roles stay separate from authors', () => {
  const credits = parseByline('By Jane Doe; Additional reporting by John Smith and Mary Jones; Research by Pat Lee');
  assert.deepEqual(credits.map(c => [c.name, c.role]), [['Jane Doe', 'author'], ['John Smith', 'reporting'], ['Mary Jones', 'reporting'], ['Pat Lee', 'research']]);
  assert.match(credits[1].attribution, /Additional reporting by/i);
});
test('explicit trailing contributed credit does not change the earlier author', () => {
  assert.deepEqual(parseByline('By Jane Doe; John Smith contributed to this report.').map(c => [c.name, c.role]), [['Jane Doe', 'author'], ['John Smith', 'contributor']]);
});
test('no extra roles are guessed from author-only bylines', () => {
  assert.deepEqual(parseByline('Jane Doe and John Smith').map(c => c.role), ['author', 'author']);
  assert.deepEqual(parseByline(''), []);
});
test('legacy suffix fragments are rejoined and never become profiles', () => {
  assert.deepEqual(articleCredits({ journalists: ['Martin Luther King', 'Jr.', 'Jane A. Doe'] }).map(c => c.name), ['Martin Luther King, Jr.', 'Jane A. Doe']);
});
test('structured credits are authoritative including intentionally empty credits', () => {
  assert.deepEqual(articleCredits({ journalists: ['Old author'], credits: [] }), []);
});
test('coauthored coverage links to each author and contributor exactly once', () => {
  const profiles = buildMediaCoverage([article('shared', [author('Jane Doe'), author('John Smith'), { name: 'Jane Doe', role: 'reporting' }, { name: 'Pat Lee', role: 'contributor' }])]);
  assert.equal(profiles.length, 3);
  for (const profile of profiles) assert.equal(profile.coverage.length, 1);
  assert.equal(profiles.find(p => p.name === 'Jane Doe').coverage[0].credits.length, 2);
});
test('the same journalist is linked to every actual publisher without cross-outlet leakage', () => {
  const [p] = buildMediaCoverage([watch('Jane Doe'), article('a', [author('Jane Doe')]), article('b', [author('Jane Doe')], { outlet: 'Outlet B' })]);
  assert.deepEqual(p.outlets.sort(), ['Outlet A', 'Outlet B']);
  assert.deepEqual(coverageAtOutlet(p, 'Outlet A').map(c => c.article.id), ['a']);
  assert.deepEqual(coverageAtOutlet(p, 'Outlet B').map(c => c.article.id), ['b']);
});
test('roster aliases merge identities while preserving observed byline spelling', () => {
  const profiles = buildMediaCoverage([watch('Alex Ward', { aliases: ['Alexander Ward'] }), article('a', [author('Alexander Ward')]), article('b', [author('Alex Ward')], { publishedAt: '2026-11-01T12:00:00Z' })]);
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].name, 'Alexander Ward');
  assert.equal(profiles[0].key, 'alex ward');
  assert.equal(profiles[0].coverage.length, 2);
});
test('unobserved tracked journalists remain visible with zero coverage', () => {
  const [p] = buildMediaCoverage([watch('Jane A. Doe')]);
  assert.equal(p.name, 'Jane A. Doe');
  assert.equal(p.coverage.length, 0);
});
test('last-name default sort preserves display names and ignores suffixes', () => {
  const profiles = buildMediaCoverage([watch('John Z. Smith'), watch('Jane A. Doe'), watch('Martin Luther King, Jr.')]);
  assert.deepEqual(profiles.map(p => p.name), ['Jane A. Doe', 'Martin Luther King, Jr.', 'John Z. Smith']);
  assert.equal(surnameKey('Martin Luther King, Jr.'), 'king');
  assert.equal(surnameKey('Maria de la Cruz'), 'de la cruz');
});
test('recent and item sorts use publication time and distinct articles', () => {
  const profiles = buildMediaCoverage([article('old', [author('Jane Doe')], { publishedAt: '2026-11-01T12:00:00Z' }), article('new', [author('John Smith')]), article('old2', [author('Jane Doe')], { publishedAt: '2026-11-02T12:00:00Z' })]);
  assert.equal(sortJournalists(profiles, 'recent')[0].name, 'John Smith');
  assert.equal(sortJournalists(profiles, 'items')[0].name, 'Jane Doe');
});
test('X posts do not silently create journalist article credits', () => {
  assert.equal(buildMediaCoverage([article('post', [author('Jane Doe')], { sourceType: 'x' })]).length, 0);
});

const account = (extra = {}) => ({ id: 'x:watch:janedoe', handle: 'JaneDoe', name: 'Jane A. Doe', aliases: ['Jane Doe'],
  accountType: 'reporter', outlet: 'Outlet A', outletId: 'outlet-a', url: 'https://x.com/JaneDoe', enabled: true, status: 'setup-required', ...extra });
const post = (id, extra = {}) => article(id, [], { sourceType: 'x', url: `https://x.com/JaneDoe/status/${id}`,
  xPost: { postId: id, watchId: 'x:watch:janedoe', handle: 'JaneDoe', references: [] }, ...extra });
test('explicit reporter aliases unify articles and social posts without adding article credits or counts', () => {
  const profiles = buildMediaCoverage([watch('Jane Doe'), article('article', [author('Jane Doe')]), post('100')], [account()]);
  assert.equal(profiles.length, 1);
  const [p] = profiles;
  assert.equal(p.name, 'Jane Doe', 'preserve the observed article byline');
  assert.equal(p.coverage.length, 1);
  assert.equal(p.xPosts.length, 1);
  assert.equal(p.xAccounts.length, 1);
  assert.deepEqual(articleCredits(p.xPosts[0]), []);
});
test('reporter profile is visible before collection and outlet accounts never become journalists', () => {
  const profiles = buildMediaCoverage([], [account(), account({ id: 'outlet', accountType: 'outlet', name: 'Outlet A' })]);
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].xPosts.length, 0);
  assert.equal(profiles[0].coverage.length, 0);
});
test('social activity does not affect article sorting or leak across outlet scopes', () => {
  const profiles = buildMediaCoverage([watch('Jane Doe'), post('100', { outlet: 'Outlet B', publishedAt: '2026-11-09T12:00:00Z' }),
    article('latest-article', [author('Other Person')])], [account()]);
  const p = profiles.find(p => p.name === 'Jane A. Doe');
  assert.equal(p.latest, 0);
  assert.equal(sortJournalists(profiles, 'recent')[0].name, 'Other Person');
  assert.equal(xPostsAtOutlet(p, 'Outlet A').length, 0);
  assert.equal(xPostsAtOutlet(p, 'Outlet B').length, 1);
  assert.equal(coverageAtOutlet(p, 'Outlet B').length, 0);
});
test('manual X imports link by exact status URLs, not lookalike hosts, prose mentions or quoted authors', () => {
  const a = account();
  assert.equal(xAccountMatchesPost(a, post('100', { xPost: undefined, url: 'https://twitter.com/janedoe/status/100?s=20' })), true);
  for (const url of ['https://evilx.com/JaneDoe/status/100', 'https://x.com.evil.test/JaneDoe/status/100',
    'https://x.com/JaneDoe', 'https://x.com/Other/status/100']) {
    assert.equal(xAccountMatchesPost(a, post('100', { xPost: undefined, url })), false);
  }
  assert.equal(xAccountMatchesPost(a, post('100', { xPost: { handle: 'Other', watchId: 'other',
    references: [{ type: 'quoted', handle: 'JaneDoe' }] }, url: 'https://x.com/Other/status/100' })), false);
  assert.equal(xAccountMatchesPost(a, article('news', [author('Jane Doe')], { url: a.url })), false);
});
test('distinct people with similar names are not fuzzily joined', () => {
  const profiles = buildMediaCoverage([watch('Jane Doe'), article('a', [author('Janet Doe')])], [account({ name: 'Jane A. Doe', aliases: [] })]);
  assert.equal(profiles.length, 3);
});
