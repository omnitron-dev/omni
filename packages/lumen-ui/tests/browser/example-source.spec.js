import { expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createBrowserTest } from './browser-fixture.js';

const test = createBrowserTest('diagrams.html');

test('one declared source survives disabled scripts, lazy mounting and the public Markdown mirror', async ({ browser, cliSiteUrl, request }) => {
  const source = await readFile(new URL('./cli-site/source-example.jsx', import.meta.url), 'utf8');
  const url = new URL('docs/source.html', cliSiteUrl).href;
  const mirror = await request.get(new URL('docs/source.md', cliSiteUrl).href);
  expect(mirror.status()).toBe(200);
  const markdown = await mirror.text();
  expect(markdown).toContain(source);
  expect(markdown).not.toContain('Protected');
  expect(markdown).not.toContain('example="private"');

  for (const javaScriptEnabled of [false, true]) {
    const context = await browser.newContext({ javaScriptEnabled, viewport: { width: 320, height: 740 } });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(url);
      const example = page.locator('[data-example="source"]');
      await expect(example.getByRole('figure', { name: 'Declared observation' })).toBeVisible();
      const full = example.locator('pre code');
      await expect(full).toHaveCount(1);
      await expect(full).not.toBeVisible();
      await example.getByText('Source code', { exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(full).toBeVisible();
      expect(await full.textContent()).toBe(source);
      await example.locator('pre').focus();
      await expect(example.locator('pre')).toBeFocused();
      if (javaScriptEnabled) {
        await example.getByRole('button', { name: 'Load observation' }).click();
        await example.getByRole('button', { name: 'Observed 0' }).click();
        await expect(example.getByRole('button', { name: 'Observed 1' })).toBeVisible();
        await expect(full).toBeVisible();
        expect(await full.textContent()).toBe(source);
      }
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  }
});
