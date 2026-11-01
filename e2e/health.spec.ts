import { expect, test } from '@playwright/test';

test('home page shows the backend is connected with a heartbeat time', async ({ page }, testInfo) => {
  await page.goto('/');
  const status = page.getByTestId('backend-status');
  await expect(status).toContainText('后端已连接');
  await expect(page.getByTestId('heartbeat-time')).not.toHaveText('—');
  await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true });
});
