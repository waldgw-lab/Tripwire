import { test, expect, policy, staffing } from './claims-fixture.mjs';

const topicId = h => `button-topic-${h.category}-${h.topic}`;
const articleId = (h, id) => `button-article-${h.topic}-${id}`;
const articleRow = (page, h, id) => page.getByTestId(`row-article-${h.topic}-${id}`);
const topicList = (page, h) => page.getByTestId(`list-topic-articles-${h.category}-${h.topic}`);
const articleOrder = (page, home) => topicList(page, home).locator(':scope > li')
  .evaluateAll(rows => rows.map(row => row.getAttribute('data-testid')));

async function location(page, home, sort = 'newest') {
  await expect(page.getByTestId('detail-claim-shared')).toBeVisible();
  await expect(page.getByTestId('select-claim-category')).toHaveValue(home.category);
  await expect(page.getByTestId('select-claim-topic')).toHaveValue(home.topic);
  await expect(page.getByTestId('select-claim-sort')).toHaveValue(sort);
  await expect(page.getByTestId('text-claim-breadcrumb')).toContainText(home.label);
  await expect(page.getByTestId('button-claim-topic-filter')).toHaveText(home.title);
  await expect(page.getByTestId('section-pinned-claim')).toHaveCount(0);
  await expect.poll(() => {
    const p = new URL(page.url()).searchParams;
    return [p.get('claim'), p.get('category'), p.get('topic'), p.get('sort') ?? 'newest'];
  }).toEqual(['shared', home.category, home.topic, sort]);
  const ids = home === policy ? ['policy'] : ['staff-new', 'staff-old'];
  await expect(topicList(page, home).locator(':scope > li')).toHaveCount(ids.length);
  await expect(topicList(page, home).getByTestId('button-claim-shared')).toHaveAttribute('aria-current', 'true');
}

test('article-first tree keeps a shared claim in the clicked home through reload and history', async ({ page }) => {
  await page.goto('/claims');
  await expect(page.getByTestId(`text-category-counts-${staffing.category}`)).toHaveText('2 articles · 3 claims');
  await expect(page.getByTestId(`text-category-counts-${policy.category}`)).toHaveText('1 article · 1 claim');
  for (const home of [staffing, policy]) {
    const button = page.getByTestId(topicId(home));
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
  }
  await expect(topicList(page, staffing).locator(':scope > li')).toHaveCount(2);
  await expect.poll(() => articleOrder(page, staffing)).toEqual([
    `row-article-${staffing.topic}-staff-new`, `row-article-${staffing.topic}-staff-old`,
  ]);
  await expect(topicList(page, policy).locator(':scope > li')).toHaveCount(1);
  await expect(topicList(page, policy)).not.toContainText('Pete Hegseth faces possible removal');
  await page.getByTestId(articleId(policy, 'policy')).click();
  await expect(articleRow(page, policy, 'policy').getByTestId('button-claim-shared')).toBeVisible();
  await expect(articleRow(page, policy, 'policy').getByTestId('button-claim-staff-only')).toHaveCount(0);
  await articleRow(page, policy, 'policy').getByTestId('button-claim-shared').click();
  await location(page, policy);
  // Clicking the breadcrumb itself must not redirect to the representative staffing home.
  await page.getByTestId('button-claim-topic-filter').click();
  await location(page, policy);
  await page.reload();
  await location(page, policy);

  // Filter changes replace the current history entry; explicit claim selection pushes one.
  await page.getByTestId('select-claim-category').selectOption(staffing.category);
  await expect(page.getByTestId('select-claim-topic')).toHaveValue('');
  await page.getByTestId('select-claim-topic').selectOption(staffing.topic);
  await page.getByTestId('select-claim-sort').selectOption('oldest');
  await expect.poll(() => articleOrder(page, staffing)).toEqual([
    `row-article-${staffing.topic}-staff-old`, `row-article-${staffing.topic}-staff-new`,
  ]);
  await page.getByTestId('select-claim-sort').selectOption('linked');
  await expect.poll(() => articleOrder(page, staffing)).toEqual([
    `row-article-${staffing.topic}-staff-new`, `row-article-${staffing.topic}-staff-old`,
  ]);
  await location(page, staffing, 'linked');
  await page.reload();
  await location(page, staffing, 'linked');
  // Reset retains the selected claim but exposes both homes.
  await page.getByTestId('button-reset-claim-filters').click();
  await page.getByTestId(topicId(policy)).click();
  await page.getByTestId(articleId(policy, 'policy')).click();
  await articleRow(page, policy, 'policy').getByTestId('button-claim-shared').click();
  await location(page, policy);
  await page.goBack();
  await expect(page.getByTestId('select-claim-category')).toHaveValue('');
  await expect(page.getByTestId('text-claim-breadcrumb')).toContainText(staffing.label);
  await page.goForward();
  await location(page, policy);
});

test('feed article links preserve the non-representative home on Claims and the return trip', async ({ page }) => {
  await page.goto('/feed');
  await page.getByTestId('button-expand-policy').click();
  await expect(page.getByTestId('reader-policy')).toBeVisible();
  await expect(page).toHaveURL(/article=policy/);
  await page.getByTestId('button-toggle-article-claims').click();
  const linked = page.getByTestId('section-article-claims');
  await expect(linked.getByTestId('text-article-claims-count')).toHaveText('Linked claims · 1 in 1 topic');
  await expect(linked).toContainText(policy.label);
  await expect(linked).not.toContainText(staffing.title);
  await page.getByTestId(`button-article-claim-topic-${policy.category}::${policy.topic}`).click();
  const link = page.getByTestId('link-article-claim-shared');
  const expected = new URLSearchParams({ claim: 'shared', category: policy.category, topic: policy.topic });
  await expect(link).toHaveAttribute('href', `/claims?${expected}`);
  await link.click();
  await location(page, policy);
  await page.reload();
  await location(page, policy);
  await page.goBack();
  await expect(page.getByTestId('reader-policy')).toBeVisible();
  await page.goForward();
  await location(page, policy);
  await page.getByTestId('link-article-feed-policy').click();
  await expect(page.getByTestId('reader-policy')).toBeVisible();
  await expect(page).toHaveURL(/\/feed\?article=policy$/);
  await page.reload();
  await expect(page.getByTestId('reader-policy')).toBeVisible();
});

test('feed category and focus filters include only articles in their own homes', async ({ page }) => {
  await page.goto('/feed');
  const rows = () => page.locator('li[data-testid^="row-article-"]');
  await expect(rows()).toHaveCount(4);
  await page.getByTestId('button-feed-filters').click();
  await page.getByTestId('filter-claims-with').click();
  await expect(rows()).toHaveCount(3);
  await page.getByTestId(`filter-option-claim-category-${policy.category}`).check();
  await page.getByTestId(`filter-option-claim-topic-${policy.category}::${policy.topic}`).check();
  await expect(rows()).toHaveCount(1);
  await expect(page.getByTestId('row-article-policy')).toBeVisible();
  await expect(page.getByTestId('row-article-staff-new')).toHaveCount(0);
  await page.getByTestId('filter-clear-claim-topics').click();
  await expect(rows()).toHaveCount(3);
  await page.getByTestId(`filter-option-claim-category-${staffing.category}`).check();
  await page.getByTestId(`filter-option-claim-topic-${staffing.category}::${staffing.topic}`).check();
  await expect(rows()).toHaveCount(2);
  await expect(page.getByTestId('row-article-staff-new')).toBeVisible();
  await expect(page.getByTestId('row-article-staff-old')).toBeVisible();
  await expect(page.getByTestId('row-article-policy')).toHaveCount(0);
  await page.getByTestId('filter-claims-without').click();
  await expect(page.getByTestId('text-claim-topics-disabled')).toBeVisible();
  await expect(rows()).toHaveCount(1);
  await expect(page.getByTestId('row-article-unlinked')).toBeVisible();
  await page.getByTestId('button-reset-feed-filters').click();
  await expect(rows()).toHaveCount(4);
});
