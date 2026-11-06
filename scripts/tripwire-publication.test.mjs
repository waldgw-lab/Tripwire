import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicationUpdate, discoveryPublication } from '../artifacts/api-server/src/lib/tripwire-publication.ts';
import { feedPublication } from '../artifacts/tripwire/src/lib/feed-format.ts';

const google = { publishedAt: '2026-11-06T14:24:12.000Z', publicationSource: 'google-news', publicationSourceUrl: 'https://news.google.com/rss/search?q=example' };
test('retained Google RSS timestamps are available for display with provenance', () => {
  const value = discoveryPublication(JSON.stringify({ pubDate: 'Fri, 06 Nov 2026 14:24:12 GMT' }), google.publicationSourceUrl);
  assert.deepEqual(value, google);
  assert.equal(feedPublication(value.publishedAt, new Date('2026-11-06T15:00:00Z')).label, '06 NOV · 0924');
});
test('ET formatting follows daylight saving time for discovery timestamps', () => {
  const value = discoveryPublication(JSON.stringify({ isoDate: '2026-07-06T14:24:12Z' }));
  assert.equal(feedPublication(value.publishedAt, new Date('2026-11-06T15:00:00Z')).time, '1024');
});
test('publisher metadata can replace the feed timestamp even when a date already exists', () => {
  const publisher = { publishedAt: '2026-11-06T13:50:00Z', publicationSource: 'publisher', publicationSourceUrl: 'https://washingtonpost.com/story' };
  assert.deepEqual(publicationUpdate(google, publisher), { ...publisher, publishedAt: '2026-11-06T13:50:00.000Z' });
});
test('index refresh cannot overwrite publisher or manually edited dates', () => {
  for (const publicationSource of ['publisher', 'manual', undefined]) {
    assert.deepEqual(publicationUpdate({ publishedAt: '2026-11-06T12:00:00Z', publicationSource }, google), {});
  }
});
test('publisher refresh cannot overwrite a manually entered date', () => {
  assert.deepEqual(publicationUpdate({ ...google, publicationSource: 'manual' }, { ...google, publicationSource: 'publisher' }), {});
});
test('a second index discovery does not silently move the original feed timestamp', () => {
  assert.deepEqual(publicationUpdate(google, { ...google, publishedAt: '2026-11-06T15:00:00Z' }), {});
});
test('missing or invalid dates never fall back to ingestion time', () => {
  for (const raw of ['invalid json', '{}', '{"pubDate":"bad"}', '{"isoDate":123}']) assert.deepEqual(discoveryPublication(raw), {});
  assert.deepEqual(publicationUpdate(google, { publishedAt: 'bad', publicationSource: 'publisher' }), {});
});
test('valid original pubDate remains usable when an isoDate field is malformed', () => {
  assert.equal(discoveryPublication('{"isoDate":"bad","pubDate":"Fri, 06 Nov 2026 14:24:12 GMT"}').publishedAt, google.publishedAt);
});
