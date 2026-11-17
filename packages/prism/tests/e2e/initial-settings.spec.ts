import { expect, test } from '@playwright/test';

for (const scenario of [
  { name: 'application defaults', path: '/test/initial-settings', saved: false, expected: 'rgb(2, 6, 23)' },
  {
    name: 'saved preference across providers',
    path: '/test/initial-settings?nested',
    saved: true,
    expected: 'rgb(240, 240, 248)',
  },
]) {
  test(`every painted application frame uses the ${scenario.name}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.addInitScript((saved) => {
      if (saved)
        localStorage.setItem(
          'prism-settings',
          JSON.stringify({ version: 1, state: { mode: 'light', preset: 'midnight' } })
        );
      const samples = new Set<string>();
      function sample() {
        const content = document.querySelector('main');
        if (content) samples.add(getComputedStyle(document.body).backgroundColor);
        if (content && document.documentElement.hasAttribute('data-finish-sampling')) {
          document.documentElement.setAttribute('data-frame-colors', [...samples].join(';'));
        } else {
          requestAnimationFrame(sample);
        }
      }
      requestAnimationFrame(sample);
    }, scenario.saved);
    await page.goto(scenario.path);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.locator('body')).toHaveCSS('background-color', scenario.expected);
    await page.evaluate(() => document.documentElement.setAttribute('data-finish-sampling', ''));
    await expect(page.locator('html')).toHaveAttribute('data-frame-colors', scenario.expected);
  });
}
