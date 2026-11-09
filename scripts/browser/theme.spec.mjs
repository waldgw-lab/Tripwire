import { test, expect } from './claims-fixture.mjs';

test('appearance switch is above Refresh, survives navigation/reload and works collapsed and on mobile', async ({ page }) => {
  await page.goto('/feed');
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  const dark = page.getByTestId('button-theme-dark');
  const refresh = page.getByTestId('button-refresh-feeds');
  await expect(dark).toBeVisible();
  expect((await dark.boundingBox()).y).toBeLessThan((await refresh.boundingBox()).y);
  await dark.click();
  await expect(root).toHaveClass(/dark/);
  await expect(dark).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('tripwire:theme'))).toBe('dark');
  await page.getByTestId('link-nav-claims').click();
  await expect(page.getByTestId('input-claim-search')).toBeVisible();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.getByTestId('button-theme-light').click();
  await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'light');
  await page.getByTestId('button-theme-dark').click();
  await page.getByTestId('button-toggle-sidebar').click();
  await page.getByTestId('button-theme-collapsed').click();
  await expect(root).toHaveAttribute('data-theme', 'light');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('button-theme-mobile').click();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
});

test('switching still works if browser storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
    Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
  });
  await page.goto('/feed');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByTestId('button-theme-dark').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByTestId('button-theme-light').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
