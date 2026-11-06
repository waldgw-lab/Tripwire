import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlCandidate } from '../artifacts/api-server/src/lib/tripwire-import.ts';
import { sitemapItems } from '../artifacts/api-server/src/lib/tripwire-intake.ts';
import { needsArticleText } from '../artifacts/api-server/src/lib/tripwire-priority.ts';
import { readFileSync, existsSync } from 'node:fs';

const url = 'https://www.cnn.com/2026/11/06/politics/video/bolduan-kight-hegseth-impeachment-midterms-cnc';
const description = "CNN News Central's Kate Bolduan speaks with Axios Politics Reporter Stef Kight about what could be in store for Defense Secretary Pete Hegseth next week on Capitol Hill amid growing calls for his impeachment, as Republicans blame him for their midterm wipeout.";
const video = { '@type': 'VideoObject', name: 'A publisher video', description, uploadDate: '2026-11-06T12:17:08.685Z', mainEntityOfPage: { '@type': 'WebPage', url, datePublished: '2026-11-06T14:48:05.960Z' } };
const page = (nodes, meta = '<meta property="og:type" content="video.other">') => `<html><head>${meta}<script type="application/ld+json">${JSON.stringify(nodes)}</script></head><body><nav>Unrelated related headlines</nav></body></html>`;

test('standalone video retains description without a readable article or transcript', () => {
  const result = htmlCandidate(page(video), url);
  assert.equal(result.fullText, description);
  assert.equal(result.summary, description);
  assert.equal(result.title, video.name);
  assert.equal(result.contentFormat, 'video');
  assert.equal(result.extractionMethod, 'video description');
  assert.equal(result.fullTextComplete, false);
  assert.equal(result.publishedAt, video.mainEntityOfPage.datePublished);
  assert.deepEqual(result.journalists, undefined);
});
test('video metadata fallback works with invalid/missing JSON-LD and is not navigation text', () => {
  const result = htmlCandidate(page({}, `<meta property="og:type" content="video.other"><meta property="og:title" content="Video headline"><meta name="description" content="${description}">`), url);
  assert.equal(result.fullText, description);
  assert.equal(result.title, 'Video headline');
});
test('an embedded video does not displace an article body with its own video description', () => {
  const articleBody = 'This is the actual article reporting and its substantive evidence. '.repeat(10);
  const result = htmlCandidate(page({ '@graph': [{ '@type': 'NewsArticle', headline: 'An article with an embedded clip', articleBody }, video] }, '<meta property="og:type" content="article">'), 'https://www.cnn.com/2026/11/06/politics/article');
  assert.equal(result.fullText, articleBody.trim());
  assert.notEqual(result.contentFormat, 'video');
});
test('multiple video objects select the one explicitly attached to the requested page', () => {
  const result = htmlCandidate(page({ '@graph': [{ ...video, description: 'An unrelated video description that should not be retained as this item.', mainEntityOfPage: { url: 'https://www.cnn.com/other/video/clip' } }, video] }), url);
  assert.equal(result.fullText, description);
});
test('publisher video-sitemap descriptions are exposed for direct intake retention', () => {
  const xml = `<urlset xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"><url><loc>${url}</loc><video:video><video:title>Video headline</video:title><video:description>${description}</video:description><video:publication_date>2026-11-06T14:48:05.960Z</video:publication_date></video:video></url></urlset>`;
  const [item] = sitemapItems(xml, 'CNN');
  assert.equal(item.contentSnippet, description);
  assert.equal(item.title, 'Video headline');
  assert.equal(item.isoDate, '2026-11-06T14:48:05.960Z');
  assert.match(item.raw, /video:description/);
});
test('short retained video descriptions count as enrichment, not confirmed completeness', () => {
  const item = { kind: 'article', title: 'Video', contentFormat: 'video', fullTextComplete: false, retainedContent: [{ source: 'page:video description', textLength: 120 }] };
  assert.equal(needsArticleText(item), false);
  assert.equal(item.fullTextComplete, false);
});
if (existsSync('/tmp/tripwire-cnn-video.html')) test('actual retrieved CNN HTML retains the exact publisher description, with no unrelated page prose', () => {
  const html = readFileSync('/tmp/tripwire-cnn-video.html', 'utf8');
  assert.ok(html.length > 3_000_000);
  const result = htmlCandidate(html, url);
  assert.equal(result.fullText, description);
  assert.equal(result.title, 'Defiant Pete Hegseth posts new video as effort to impeach him grows');
  assert.equal(result.publishedAt, '2026-11-06T14:48:05.960Z');
  assert.equal(result.contentFormat, 'video');
});
