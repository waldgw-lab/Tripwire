import { test, expect, records } from './claims-fixture.mjs';

const extra = Array.from({ length: 5 }, (_, i) => ({
  id: `group-fixture-${i}`, kind: 'article',
  title: `Pete Hegseth faces impeachment pressure — fixture ${i}`,
  outlet: ['CNN','Axios','CBS','Reuters','NBC'][i], entities: [],
  url: `https://example.invalid/group-${i}`,
  publishedAt: `2026-11-08T1${3+i}:00:00Z`,
  createdAt: '2026-11-08T18:00:00Z', updatedAt: '2026-11-08T18:00:00Z',
  impact: 'high', impactMode: 'manual',
}));
const expectedIds = [...records.filter(r=>r.kind==='article'), ...extra].map(r=>r.id).sort();

async function fixture(page) {
  // Page-scoped read-only override; the parent fixture still rejects all writes,
  // external requests and unrecognized API reads. No test content is persisted.
  await page.route('**/api/tripwire/workspace', route => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({json:{
      records: [...records, ...extra, {...extra[0],id:'low-fixture',title:'A low-impact fixture article',impact:'low'}],
      stats:{articles:10,claims:3,journalists:0,watches:0,flagged:0},lastRefreshed:null,
    }});
  });
}
const groupedIds = page => page.locator('[data-testid^="row-group-article-"]').evaluateAll(nodes=>
  nodes.map(n=>n.getAttribute('data-testid').slice('row-group-article-'.length)).sort());

test('grouped layouts preserve all eligible reporting, expand fully, restore URL and keep chronology default', async ({page})=>{
  await fixture(page);
  await page.goto('/feed');
  await expect(page.getByTestId('button-view-chronological')).toHaveAttribute('aria-checked','true');
  await expect(page.locator('[data-testid^="row-article-"]')).toHaveCount(9);
  await expect(page.getByTestId('row-article-low-fixture')).toHaveCount(0);
  await page.getByTestId('button-view-grouped').click();
  for (const layout of ['briefing','compare','board']) {
    await page.getByTestId(`button-layout-${layout}`).click();
    await expect(page.getByTestId(`grouped-feed-${layout}`)).toBeVisible();
    await expect(page.getByTestId('text-layout-explainer')).toHaveCount(0);
    await expect(page.getByText('How grouping works',{exact:true})).toHaveCount(0);
    await expect(page.locator('[data-testid^="button-group-basis-"]')).toHaveCount(0);
    if (layout !== 'board') await expect(page.locator('[data-testid^="overview-group-"]').first()).toBeVisible();
    const more = page.locator('[data-testid^="button-group-showall-"]');
    if (await more.count()) await more.click();
    await expect.poll(()=>groupedIds(page)).toEqual(expectedIds);
    await expect(page.getByTestId('row-group-article-unlinked')).toBeVisible();
    await expect(page.getByTestId('row-group-article-low-fixture')).toHaveCount(0);
    await expect(page.getByTestId('link-group-source-unlinked')).toHaveAttribute('href','https://example.invalid/unlinked');
  }
  await page.reload();
  await expect(page.getByTestId('grouped-feed-board')).toBeVisible();
  await page.getByTestId('button-view-chronological').click();
  await expect(page.locator('[data-testid^="row-article-"]')).toHaveCount(9);
  expect(new URL(page.url()).searchParams.has('view')).toBe(false);
  await page.goto('/feed');
  await expect(page.getByTestId('button-view-chronological')).toHaveAttribute('aria-checked','true');
});

test('Feed methodology is organized beneath the actual view types in Dashboard',async({page})=>{
  await page.goto('/dashboard?tab=methodology');
  const feed=page.getByTestId('section-methodology-feed');
  await expect(feed).toBeVisible();
  for(const view of ['chronological','briefing','compare','board']){
    await expect(feed.getByTestId(`section-methodology-feed-${view}`)).toBeVisible();
  }
  await expect(feed.getByTestId('section-methodology-feed-briefing')).toContainText('How grouping works');
  await expect(feed.getByTestId('section-methodology-feed-compare')).toContainText('Last 6h is included in Last 24h');
  await expect(feed.getByTestId('section-methodology-feed-board')).toContainText('not a verified shared claim');
  await expect(page.getByTestId('section-methodology-principles')).not.toContainText('Chronological and Grouped views');
});

test('grouped cards open the shared reader; narrow and reader-width grids do not overflow', async ({page})=>{
  await fixture(page);
  await page.goto('/feed?view=grouped&layout=board');
  await expect(page.getByTestId('grouped-feed-board')).toBeVisible();
  await page.getByTestId('button-group-open-unlinked').click();
  await expect(page.getByRole('heading',{name:'An article with no claim attributions',exact:true})).toBeVisible();
  expect(new URL(page.url()).searchParams.get('article')).toBe('unlinked');
  const more = page.locator('[data-testid^="button-group-showall-"]');
  if (await more.count()) await more.click();
  const overflow = () => page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  await expect.poll(overflow).toBeLessThanOrEqual(1);
  // Inspect the grouped pane on a phone without the reader overlay obscuring it.
  await page.goto('/feed?view=grouped&layout=board');
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByTestId('grouped-feed-board')).toBeVisible();
  await expect.poll(overflow).toBeLessThanOrEqual(1);
});
