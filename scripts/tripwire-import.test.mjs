import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pdfFixture, docxFixture } from './tripwire-test-documents.mjs';
import { canonicalUrl, textCandidate, htmlCandidate, matchImport, documentText } from '../artifacts/api-server/src/lib/tripwire-import.ts';

test('URL matching ignores tracking, www and fragments', () => {
  assert.equal(canonicalUrl('https://www.example.com/article/?utm_source=x#one'), 'https://example.com/article');
  const records = [{ id: 'a', kind: 'article', title: 'A verified headline', url: 'https://www.example.com/article' }];
  assert.equal(matchImport({ title: 'New publisher headline', url: 'https://example.com/article/?utm_medium=x' }, records).record.id, 'a');
});
test('pasted source identifies outlet, byline, type and complete retained body', () => {
  const text = 'A uniquely reported defense policy review\nThe Washington Post\nBy Jane Reporter and John Correspondent\nPublished: 2026-11-05T14:30:00Z\n\n' + 'Evidence. '.repeat(100) + 'FINAL MARKER';
  const result = textCandidate(text);
  assert.equal(result.outlet, 'The Washington Post');
  assert.equal(result.title, 'A uniquely reported defense policy review');
  assert.equal(result.credits.length, 2);
  assert.equal(result.fullText, text);
  assert.equal(result.fullTextComplete, false);
  assert.equal(result.publishedAt, '2026-11-05T14:30:00.000Z');
});
test('article match is cautious about ambiguous titles and different publishers', () => {
  const records = [{ id: 'a', kind: 'article', title: 'The defense policy review', outlet: 'Reuters' }, { id: 'b', kind: 'article', title: 'The defense policy review', outlet: 'Axios' }];
  assert.equal(matchImport({ title: 'The defense policy review' }, records).ambiguous, true);
  assert.equal(matchImport({ title: 'The defense policy review', outlet: 'Axios' }, records).record.id, 'b');
  assert.equal(matchImport({ title: 'The defense policy review', outlet: 'NBC' }, records).record, undefined);
});
test('HTML article metadata and all available body text are extracted without executing scripts', () => {
  const body = 'Documents establish a new review of defense policy and additional reporting. '.repeat(15);
  const html = `<html><head><meta property="og:title" content="A primary report"><meta property="article:published_time" content="2026-11-05T14:30:00Z"><script type="application/ld+json">${JSON.stringify({ '@type': 'NewsArticle', headline: 'A primary report', author: [{ name: 'Jane Reporter' }], articleBody: body })}</script></head><body><article><h1>A primary report</h1><p>${body}</p></article></body></html>`;
  const result = htmlCandidate(html, 'https://www.reuters.com/example/article');
  assert.equal(result.title, 'A primary report');
  assert.equal(result.outlet, 'Reuters');
  assert.equal(result.fullText, body.trim());
  assert.equal(result.byline, 'Jane Reporter');
  assert.equal(result.fullTextComplete, false);
});
test('PDF extraction retains the final passage beyond the old summary cutoff', async () => {
  const text = await documentText(pdfFixture(), 'verification.pdf');
  assert.ok(text.length > 450);
  assert.ok(text.includes('FINAL PDF EVIDENCE RETAINED'));
});
test('DOCX extraction retains the final passage beyond the old summary cutoff', async () => {
  const text = await documentText(docxFixture(), 'verification.docx');
  assert.ok(text.length > 450);
  assert.ok(text.includes('FINAL RETAINED EVIDENCE'));
});
test('unsupported binary uploads fail explicitly', async () => {
  await assert.rejects(documentText(Buffer.from('not a real PDF'), 'fake.pdf'), /not a supported/);
});
