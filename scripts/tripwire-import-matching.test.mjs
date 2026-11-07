import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchImport, resolveImportMatch } from '../artifacts/api-server/src/lib/tripwire-import.ts';
import { mergeHeadlines, observeHeadline, publisherIdentityUpdate } from '../artifacts/api-server/src/lib/tripwire-headlines.ts';
import { captureContent } from '../artifacts/api-server/src/lib/tripwire-content.ts';

const selected = { id: 'selected', kind: 'article', title: 'Earlier publisher headline', outlet: 'CNN', url: 'https://www.cnn.com/2026/11/05/politics/video/earlier-clip' };
const other = { id: 'other', kind: 'article', title: 'A different headline for a later video', outlet: 'CNN', url: 'https://www.cnn.com/2026/11/06/politics/video/later-clip' };
const records = [selected, other];
test('verified source URL takes precedence over a headline matching another record', () => {
  const result = resolveImportMatch({ title: other.title, url: selected.url + '/?utm_source=clipboard#player', outlet: 'CNN' }, records, selected, true);
  assert.equal(result.existing.id, selected.id);
  assert.equal(result.conflict, false);
  assert.equal(result.reason, 'Matching source URL');
});
test('www, tracking parameters and headline changes do not defeat URL identity', () => {
  assert.equal(matchImport({ title: 'Entirely revised headline', url: selected.url.replace('www.', '') + '?utm_campaign=updated', outlet: 'CNN' }, records).record.id, selected.id);
});
test('interactive mismatch produces a preview bound to the exact matching record, not the selected one', () => {
  const result = resolveImportMatch({ title: other.title, outlet: 'CNN' }, records, selected, true);
  assert.equal(result.conflict, true);
  assert.equal(result.existing.id, other.id);
});
test('unattended enrichment retains strict mismatch protection and cannot silently retarget', () => {
  const result = resolveImportMatch({ title: other.title, outlet: 'CNN' }, records, selected);
  assert.equal(result.conflict, true);
  assert.equal(result.existing.id, selected.id);
});
test('similar subjects are not sufficient to merge two distinct URLs or headlines', () => {
  assert.equal(matchImport({ title: 'A later headline covering similar events', outlet: 'CNN' }, records).record, undefined);
});
test('duplicate title matches stay ambiguous instead of selecting an arbitrary record', () => {
  const result = resolveImportMatch({ title: other.title, outlet: 'CNN' }, [...records, { ...other, id: 'duplicate' }]);
  assert.equal(result.ambiguous, true);
  assert.equal(result.existing, undefined);
});
const alias = 'Publisher earlier headline for the same source';
const observation = (article, title = alias) => observeHeadline({ ...article, title },
  captureContent('', 'headline:rss', { raw: `<title>${title}</title>`, sourceUrl: 'https://www.cnn.com/politics/feed', capturedAt: '2026-11-06T14:48:05.960Z' }), 'publisher-rss');
test('Dashboard can match a verified earlier headline with publisher and no URL', () => {
  const revised = { ...selected, title: 'Curated display title', verifiedHeadlines: observation(selected) };
  assert.equal(matchImport({ title: alias, outlet: 'CNN' }, [revised]).record.id, selected.id);
  assert.equal(matchImport({ title: alias }, [revised]).record, undefined);
  assert.equal(matchImport({ title: alias, outlet: 'Axios' }, [revised]).record, undefined);
});
test('a distinct supplied URL never falls back to a reused headline or alias', () => {
  const revised = { ...selected, verifiedHeadlines: observation(selected) };
  assert.equal(matchImport({ title: alias, outlet: 'CNN', url: other.url }, [revised]).record, undefined);
  assert.equal(matchImport({ title: selected.title, outlet: 'CNN', url: other.url }, [revised]).record, undefined);
});
test('reused alias and current-headline collisions require review rather than first-match selection', () => {
  const first = { ...selected, verifiedHeadlines: observation(selected) };
  const second = { ...other, verifiedHeadlines: observation(other) };
  assert.equal(matchImport({ title: alias, outlet: 'CNN' }, [first, second]).ambiguous, true);
  assert.equal(matchImport({ title: alias, outlet: 'CNN' }, [first, { ...other, title: alias }]).ambiguous, true);
  assert.equal(matchImport({ title: alias, outlet: 'CNN', url: other.url }, [first, second]).record.id, other.id);
});
test('per-item alias review can offer another destination; unattended resolution cannot retarget', () => {
  const first = { ...selected, verifiedHeadlines: observation(selected) };
  const interactive = resolveImportMatch({ title: alias, outlet: 'CNN' }, [first, other], other, true);
  assert.equal(interactive.conflict, true);
  assert.equal(interactive.existing.id, first.id);
  const strict = resolveImportMatch({ title: alias, outlet: 'CNN' }, [first, other], other);
  assert.equal(strict.conflict, true);
  assert.equal(strict.existing.id, other.id);
});
test('observations require publisher provenance, bind to canonical URL, and retain source versions', () => {
  const observed = observation(selected);
  assert.equal(observed[0].observedAt, '2026-11-06T14:48:05.960Z');
  assert.equal(observed[0].articleUrl, selected.url.replace('www.', ''));
  assert.deepEqual(mergeHeadlines(other, observed), []);
  assert.deepEqual(observeHeadline(selected, captureContent('', 'paste', { sourceUrl: 'https://example.org/news' }), 'publisher-page'), []);
  const versions = mergeHeadlines(selected, observed, observed, observation(selected, 'Revised publisher headline'));
  assert.equal(versions.length, 2);
  assert.equal(versions[0].title, alias);
});
test('publisher promotion resolves a Google shadow identity before merging verified headlines', () => {
  const shadow = { ...selected, url: 'https://news.google.com/rss/articles/discovery', discoveryOnly: true, title: 'Curated title', flagged: true };
  const shared = { ...selected, discoveryOnly: false, verifiedHeadlines: observation(selected) };
  const projected = { ...shadow, ...publisherIdentityUpdate(shadow, shared) };
  assert.equal(projected.url, selected.url);
  assert.equal(projected.discoveryOnly, false);
  assert.equal(projected.title, shadow.title);
  assert.equal(projected.flagged, true);
  assert.equal(matchImport({ title: alias, outlet: 'CNN' }, [projected]).record.id, selected.id);
});
