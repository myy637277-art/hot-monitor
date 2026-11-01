import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';

const sections = [
  { label: '热点', path: '/', heading: '热点' },
  { label: '监控', path: '/watch', heading: '关键词监控' },
  { label: '日报', path: '/digest', heading: '定时日报' },
  { label: '发现', path: '/discover', heading: '兴趣发现' },
  { label: '设置', path: '/settings', heading: '设置' },
];

const navFor = (page: Page) =>
  page.getByRole('navigation', { name: (page.viewportSize()?.width ?? 0) < 640 ? '底部导航' : '主导航' });

test('navigation reaches every section and marks the active link', async ({ page }) => {
  await page.goto('/');
  for (const s of sections) {
    await navFor(page).getByRole('link', { name: s.label }).click();
    await expect(page).toHaveURL(s.path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(s.heading);
    await expect(navFor(page).getByRole('link', { name: s.label })).toHaveAttribute('aria-current', 'page');
  }
});

test('no horizontal overflow on any section', async ({ page }) => {
  for (const s of sections) {
    await page.goto(s.path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `overflow on ${s.path}`).toBeLessThanOrEqual(0);
  }
});

test('skip link is the first focus stop and is visible', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: '跳到主要内容' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
});

test('settings shows all 3 original agents with 4 expressions each', async ({ page }) => {
  await page.goto('/settings');
  for (const id of ['lynx', 'echo', 'blaze']) {
    await expect(page.locator(`svg[data-agent="${id}"][role="img"]`)).toHaveCount(4);
  }
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('hot feed has no radar sweep', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('radar-sweep')).toHaveCount(0);
  });
});

test('acceptance screenshot of the hot feed', async ({ page }) => {
  const dir = process.env.M1_SHOT_DIR;
  test.skip(!dir, 'set M1_SHOT_DIR to save acceptance screenshots');
  await page.goto('/');
  await expect(page.getByTestId('backend-status')).toContainText('后端已连接');
  await page.evaluate(() => document.fonts.ready);
  const { width, height } = page.viewportSize()!;
  // Grow the viewport instead of fullPage so the fixed bottom nav renders at the bottom, not mid-page.
  const docHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width, height: Math.max(height, docHeight) });
  await page.screenshot({ path: join(dir!, `m1-${width}.png`) });
});
