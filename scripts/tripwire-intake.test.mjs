import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intakeSources, publisherUrl, sitemapItems, feedFreshness, retryAfter, discoveryTitle, titleKey, parseRssItems } from '../artifacts/api-server/src/lib/tripwire-intake.ts';
import { fetchPublicDocument } from '../artifacts/api-server/src/lib/tripwire-fetch.ts';

test('all twelve outlets have HTTPS intake and an alternate route or discovery fallback', () => {
  const titles = ['The Washington Post', 'The New York Times', 'Axios', 'CBS', 'The Atlantic', 'The Wall Street Journal', 'Reuters', 'ABC', 'CNN', 'Washington Examiner', 'Daily Mail', 'NBC'];
  for (const title of titles) {
    const sources = intakeSources(title);
    assert.ok(sources.length >= 2 || title === 'Reuters');
    assert.ok(sources.every(s => new URL(s.url).protocol === 'https:'));
  }
  assert.equal(intakeSources('Reuters')[0].kind, 'google-news');
});
test('dead legacy defaults are replaced without overriding custom feeds', () => {
  assert.match(intakeSources('The Washington Post', 'https://feeds.washingtonpost.com/rss/politics')[0].url, /arcio/);
  assert.equal(intakeSources('CNN', 'https://rss.cnn.com/rss/cnn_allpolitics.rss')[0].kind, 'sitemap');
  const custom = intakeSources('CNN', 'https://example.com/custom.xml');
  assert.equal(custom[0].url, 'https://example.com/custom.xml');
  assert.ok(custom.slice(1).every(s => s.role === 'fallback'));
});
test('publisher links must use HTTPS and the exact publisher domain or subdomain', () => {
  assert.ok(publisherUrl('https://edition.cnn.com/2026/story', 'CNN'));
  for (const url of ['http://www.cnn.com/story', 'https://cnn.com.evil.test/story', 'https://evilcnn.com/story', 'https://user@cnn.com/story', 'https://cnn.com:8000/story', 'file:///cnn.com']) {
    assert.equal(publisherUrl(url, 'CNN'), false);
  }
});
const sitemap = (body) => `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${body}</urlset>`;
test('publisher news sitemap supplies title and original publication, never lastmod', () => {
  const xml = sitemap(`<url><loc>https://www.cnn.com/2026/11/06/politics/story</loc><lastmod>2026-11-06T12:00:00Z</lastmod><news:news><news:title>Trump &amp; defense</news:title><news:publication_date>2026-11-05T08:00:00Z</news:publication_date></news:news></url>`);
  const [item] = sitemapItems(xml, 'CNN');
  assert.equal(item.title, 'Trump & defense');
  assert.equal(item.isoDate, '2026-11-05T08:00:00.000Z');
  assert.match(item.raw, /lastmod/);
});
test('sitemap never invents headlines from URL slugs or publication from modification time', () => {
  const xml = sitemap(`<url><loc>https://cnn.com/no-title</loc><lastmod>2026-11-06T12:00:00Z</lastmod></url><url><loc>https://cnn.com/title-only</loc><news:news><news:title>Defense review</news:title></news:news></url><url><loc>https://other.test/story</loc><news:news><news:title>Foreign article</news:title></news:news></url>`);
  const items = sitemapItems(xml, 'CNN');
  assert.equal(items.length, 1);
  assert.equal(items[0].isoDate, undefined);
});
test('reject HTML, sitemap indexes and document type declarations', () => {
  for (const xml of ['<html>Access denied</html>', '<sitemapindex></sitemapindex>', '<!DOCTYPE urlset [<!ENTITY x "value">]><urlset/>']) {
    assert.throws(() => sitemapItems(xml, 'CNN'));
  }
});
test('old and undated feeds cannot masquerade as live feeds', () => {
  const now = Date.parse('2026-11-06T12:00:00Z');
  assert.equal(feedFreshness(['2025-01-27T12:00:00Z'], now).stale, true);
  assert.equal(feedFreshness([undefined, 'bad'], now).stale, true);
  assert.equal(feedFreshness(['2026-11-06T10:00:00Z'], now).stale, false);
  assert.equal(feedFreshness(['2030-01-01T00:00:00Z'], now).stale, true);
});
test('failure backoff increases and is bounded', () => {
  assert.equal(Date.parse(retryAfter(1, 0)), 30 * 60_000);
  assert.equal(Date.parse(retryAfter(2, 0)), 60 * 60_000);
  assert.equal(Date.parse(retryAfter(100, 0)), 12 * 3_600_000);
});
test('Google publisher suffix is removed only at the end; normalized headlines can reconcile later', () => {
  assert.equal(discoveryTitle('Trump visits Pentagon - The Washington Post', 'The Washington Post'), 'Trump visits Pentagon');
  assert.equal(discoveryTitle('Reuters - analysis of defense', 'Reuters'), 'Reuters - analysis of defense');
  assert.equal(titleKey('Trump’s “review”'), titleKey("Trump's review"));
});
test('RSS parser retains publisher source URL attributes and all available article content', async () => {
  const text = 'Retained publisher paragraph. '.repeat(300);
  const xml = `<rss version="2.0"><channel><title>Feed</title><item><title>Defense review - Reuters</title><link>https://news.google.com/rss/articles/example</link><source url="https://www.reuters.com">Reuters</source><description>${text}</description><pubDate>Fri, 06 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
  const [item] = await parseRssItems(xml);
  assert.equal(item.publisherSource[0].$.url, 'https://www.reuters.com');
  assert.equal(item.publisherSource[0]._, 'Reuters');
  assert.ok(item.content.length >= 8000);
});
test('RSS parser rejects HTML access pages and external entity declarations', async () => {
  await assert.rejects(parseRssItems('<html><body>Access denied</body></html>'));
  await assert.rejects(parseRssItems('<!DOCTYPE rss><rss/>'), /Document type/);
});
test('secure intake rejects insecure and private URLs before connecting', async () => {
  await assert.rejects(fetchPublicDocument('http://example.com/feed', 0, { httpsOnly: true }), /requires HTTPS/);
  await assert.rejects(fetchPublicDocument('https://127.0.0.1/feed', 0, { httpsOnly: true }), /Private and local/);
});
