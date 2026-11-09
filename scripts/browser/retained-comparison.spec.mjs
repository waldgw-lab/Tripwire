import { test, expect, staffing } from './claims-fixture.mjs';

test('historical comparison loads retained copies only and distinguishes absence from disproof', async ({ page }) => {
  const quote = 'Officials denied that the fictional northern command endangered troops.';
  const original = `😀 Original introduction.\n${quote}\nHistorical background.`;
  const start = original.indexOf(quote);
  const version = { evidenceId: 'comparison-evidence', captureId: 'entity-capture',
    scope: 'superseded', bodyHash: 'historical-hash', selectedBodyHash: 'selected-hash',
    source: 'paste', capturedAt: '2026-11-08T12:00:00Z', excerpt: quote, start, end: start + quote.length };
  const requests = [];
  await page.route('**/api/tripwire/**', async route => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname;
    if (req.method() !== 'GET') return route.fallback();
    if (p === '/api/tripwire/provenance') return route.fulfill({ json: {
      claims: [{ id: 'comparison-observation', claimId: 'shared', familyId: 'comparison-family',
        articleId: 'staff-new', proposition: quote, title: 'Pete Hegseth faces possible removal',
        outlet: 'Reuters', publishedAt: '2026-11-08T12:00:00Z', url: 'https://example.invalid/staff-new',
        direction: 'unassessed', evidenceScope: 'superseded', displayedEvidenceVersion: version,
        evidenceVersions: [version], evidenceId: version.evidenceId, captureId: version.captureId,
        excerpt: quote, start, end: version.end, sourceIds: [], reviews: [], supplied: false }],
      sources: [], matches: [], context: [],
      counts: { articles: 1, occurrences: 0, minimumAnonymousHumans: 0, independentPaths: null }, total: 1, offset: 0,
    } });
    if (p === '/api/tripwire/entity-captures') {
      requests.push('captures');
      return route.fulfill({ json: { items: [{ id: 'entity-capture', articleId: 'staff-new',
        captureId: 'retained-capture', hash: 'historical-hash', source: 'paste' }], total: 1 } });
    }
    if (p === '/api/tripwire/records/staff-new/content') {
      const capture = url.searchParams.get('capture');
      assertCapture(capture);
      requests.push(capture ?? 'selected');
      const text = capture ? original : 'A shorter selected copy with different wording.';
      return route.fulfill({ json: { text, raw: text, characters: text.length, rawCharacters: text.length } });
    }
    return route.fallback();
  });
  function assertCapture(capture) { expect([null, 'retained-capture']).toContain(capture); }
  await page.goto(`/claims?claim=shared&category=${staffing.category}&topic=${staffing.topic}`);
  await page.getByTestId('details-evidence-versions-comparison-observation').click();
  expect(requests).toEqual([], 'comparison must not fetch text until explicitly opened');
  await page.getByText('Compare retained copies', { exact: true }).click();
  const comparison = page.getByTestId('comparison-comparison-evidence');
  await expect(comparison).toContainText('Exact wording is absent from this selected copy');
  await expect(comparison).toContainText('This does not mean the claim is false or disproved');
  await expect(comparison.locator('mark')).toHaveText(quote);
  await expect(comparison).toContainText(`Original offsets ${start}–${version.end}`);
  expect(requests).toContain('retained-capture');
  expect(requests).toContain('selected');
  await page.screenshot({ path: '/tmp/tripwire-retained-comparison.png' });
});
