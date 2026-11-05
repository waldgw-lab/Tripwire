import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureContent, mergeCaptures, mergeArticleContent, rssContent, plainText } from '../artifacts/api-server/src/lib/tripwire-content.ts';
import { publicAddress } from '../artifacts/api-server/src/lib/tripwire-fetch.ts';

test('RSS content is retained past the old summary cutoff without truncation', () => {
  const body = 'Earlier reporting. '.repeat(500) + 'During the first Trump administration, additional evidence emerged.';
  const content = rssContent({ contentSnippet: body }, 'https://example.com/article');
  assert.equal(content.fullText, body);
  assert.equal(content.retainedCharacters, body.length);
  assert.ok(content.fullText.length > 8800);
  assert.equal(content.retainedContent[0].raw, body);
});
test('all distinct available RSS fields and original markup are retained', () => {
  const content = rssContent({ content: '<p>A short excerpt.</p>', 'content:encoded': '<p>The complete body &amp; a quotation.</p>', contentSnippet: 'A short excerpt.' }, 'https://example.com/article');
  assert.equal(content.retainedContent.length, 3);
  assert.equal(content.fullText, 'The complete body & a quotation.');
  assert.equal(content.retainedContent[1].raw, '<p>A short excerpt.</p>');
});
test('capture deduplication preserves the original retrieval timestamp', () => {
  const first = captureContent('Exact body', 'rss:content', { capturedAt: '2026-01-01T00:00:00Z' });
  const later = captureContent('Exact body', 'rss:content', { capturedAt: '2026-02-01T00:00:00Z' });
  assert.deepEqual(mergeCaptures([first], [later]), [first]);
});
test('changed source content creates an additional retained version', () => {
  assert.equal(mergeCaptures([captureContent('Version one', 'rss')], [captureContent('Version two', 'rss')]).length, 2);
});
test('separate original documents remain accessible even when their extracted text is identical', () => {
  const pdf = captureContent('Identical article text', 'file', { uploadId: 'pdf-upload', fileName: 'article.pdf' });
  const doc = captureContent('Identical article text', 'file', { uploadId: 'doc-upload', fileName: 'article.doc' });
  assert.equal(mergeCaptures([pdf], [doc]).length, 2);
});
test('a shorter refresh does not replace a longer body', () => {
  const existing = { fullText: 'A much longer original article body', retainedContent: [captureContent('original', 'rss')] };
  const incoming = { fullText: 'Short', retainedContent: [captureContent('Short', 'rss')] };
  const merged = mergeArticleContent(existing, incoming);
  assert.equal(merged.fullText, existing.fullText);
  assert.equal(merged.retainedContent.length, 2);
  assert.equal(merged.fullTextComplete, false);
});
test('a richer refresh populates an older excerpt-only item', () => {
  const merged = mergeArticleContent({}, { fullText: 'Retained source body', retainedContent: [captureContent('Retained source body', 'rss')] });
  assert.equal(merged.fullText, 'Retained source body');
  assert.equal(merged.contentRetained, true);
  assert.equal(merged.fullTextComplete, false);
});
test('confirmed complete human-supplied text is not overwritten by RSS', () => {
  const merged = mergeArticleContent({ fullText: 'Complete', fullTextComplete: true }, { fullText: 'Much longer text with publisher navigation and unrelated content' });
  assert.equal(merged.fullText, 'Complete');
  assert.equal(merged.fullTextComplete, true);
});
test('markup becomes readable plain text while raw captures remain separate', () => {
  assert.equal(plainText('<script>alert(1)</script><p>Reporting &amp; evidence &#8212; &#x41;.</p><p>Next.</p>'), 'Reporting & evidence — A.\nNext.');
});
test('URL fetching blocks local, private, metadata and mapped addresses', () => {
  for (const address of ['127.0.0.1', '10.0.0.4', '172.31.0.5', '192.168.1.5', '169.254.169.254', '100.100.100.200', '::1', '::ffff:7f00:1', 'fd00::1', 'fe80::1']) assert.equal(publicAddress(address), false, address);
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(publicAddress(address), true, address);
});
