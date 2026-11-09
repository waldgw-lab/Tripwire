import { test, expect, policy } from './claims-fixture.mjs';

test('unavailable claim links never hide reporting and retry restores exact filters', async ({ page, faults }) => {
  // Install before React creates its polling/retry timers.
  await page.clock.install();
  await page.goto('/feed');
  await page.getByTestId('button-feed-filters').click();
  await page.getByTestId('filter-claims-with').click();
  await expect(page.locator('li[data-testid^="row-article-"]')).toHaveCount(3);
  faults.summaries = 'error';
  await page.route('**/api/tripwire/provenance/summaries', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }));
  // Reload loses local filter state; unknown responses must still keep all articles visible.
  await page.reload();
  await page.getByTestId('button-feed-filters').click();
  await expect(page.getByTestId('button-claim-filter-retry')).toBeVisible();
  await expect(page.locator('li[data-testid^="row-article-"]')).toHaveCount(4);
  faults.summaries = 'ok';
  await page.unroute('**/api/tripwire/provenance/summaries');
  await page.getByTestId('button-claim-filter-retry').click();
  await expect(page.getByTestId('filter-claims-with')).toBeVisible();
  await page.getByTestId('filter-claims-with').click();
  await expect(page.locator('li[data-testid^="row-article-"]')).toHaveCount(3);
  // A failed background refresh retains known data and explicitly identifies it as stale.
  faults.summaries = 'error';
  await page.clock.fastForward(31_000);
  await page.clock.runFor(2000);
  await expect(page.getByTestId('notice-claim-filter-stale')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('li[data-testid^="row-article-"]')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('panel-feed-filters')).toHaveCount(0);
  await page.getByTestId('button-claim-filter-notice-clear').click();
  await expect(page.locator('li[data-testid^="row-article-"]')).toHaveCount(4);
  faults.summaries = 'ok';
  await page.getByTestId('button-feed-filters').click();
  await page.getByTestId('filter-claims-with').click();
  faults.summaries = 'unknown';
  await page.clock.fastForward(31_000);
  await page.clock.runFor(1000);
  await expect(page.getByTestId('notice-claim-filter-unavailable')).toBeVisible();
  await expect(page.locator('li[data-testid^="row-article-"]')).toHaveCount(4);
});

test('missing claims recover without selecting a different claim', async ({ page }) => {
  await page.goto('/claims?claim=missing-claim');
  await expect(page.getByTestId('button-claim-missing-clear')).toBeVisible();
  await expect(page.locator('[data-testid^="detail-claim-"]')).toHaveCount(0);
  await page.getByTestId('button-claim-missing-clear').click();
  await expect(page.getByTestId('button-claim-missing-clear')).toHaveCount(0);
  await expect(page.locator('[data-testid^="detail-focus-"]')).toHaveCount(1);
  await expect(page.locator('[data-testid^="detail-claim-"]')).toHaveCount(0);
});

test('a selected claim outside filters is pinned; missing article links never open another article', async ({ page, faults }) => {
  faults.omit = ['policy'];
  await page.goto('/claims?claim=staff-only&category=policy-rulemaking&topic=firearms-public-health');
  await expect(page.getByTestId('section-pinned-claim')).toBeVisible();
  await page.goto(`/claims?claim=shared&category=${policy.category}&topic=${policy.topic}`);
  const row = page.getByTestId(`row-article-${policy.topic}-policy`);
  await expect(row).toContainText('Article not in workspace');
  await row.getByTestId('link-article-feed-policy').click();
  await expect(page).toHaveURL(/article=policy/);
  await expect(page.locator('[data-testid^="reader-"]')).toHaveCount(0);
});
