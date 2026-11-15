import { expect } from '@playwright/test';
import { createBrowserTest } from './browser-fixture.js';

const test = createBrowserTest('search.html', { source: true });
for (const viewport of [{ width: 1440, height: 1000 }, { width: 360, height: 740 }, { width: 640, height: 320 }]) {
  test(`search keeps its geometry through loading, results, empty and failed queries (${viewport.width}×${viewport.height})`, async ({ page, url }, info) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: viewport.width === 360 ? 'dark' : 'light', reducedMotion: 'reduce' });
    let release;
    await page.route('**/search-fixture?*', async route => {
      const query = new URL(route.request().url()).searchParams.get('q');
      if (query === 'slow') await new Promise(resolve => { release = resolve; });
      await route.fulfill({ status: query === 'failure' ? 503 : 200, json: query === 'empty' ? [] :
        Array.from({ length: query === 'many' ? 24 : 1 }, (_, index) => ({ documentId: String(index), title: `${query} guide ${index + 1}`,
          path: '#guide', snippet: 'A long result with <mark>matched text</mark> and enough detail to exercise wrapping and scrolling.' })) });
    });
    await page.goto(url);
    const trigger = page.getByRole('button', { name: 'Search documentation', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Search documentation' });
    const query = dialog.getByRole('searchbox', { name: 'Search query' });
    const results = dialog.getByRole('tabpanel');
    await expect(query).toBeFocused();
    // Wait for the ordinary MUI entry transition before measuring layout.
    await expect(dialog).toHaveCSS('opacity', '1');
    const bounds = await dialog.boundingBox();
    const field = await query.boundingBox();
    const stable = async () => {
      for (const [locator, baseline] of [[dialog, bounds], [query, field]]) {
        const actual = await locator.boundingBox();
        for (const key of ['x', 'y', 'width', 'height']) expect(Math.abs(actual[key] - baseline[key])).toBeLessThan(1.5);
      }
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    };
    await query.fill('many');
    await expect(dialog.getByRole('link')).toHaveCount(24);
    await stable();
    expect(await results.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await query.press('ArrowDown');
    await expect(dialog.getByRole('link').first()).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(query).toBeFocused();
    await query.press('ArrowUp');
    await expect(dialog.getByRole('link').last()).toBeFocused();
    await expect(query).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(query).toBeFocused();
    await query.fill('slow');
    await expect(results).toHaveAttribute('aria-busy', 'true');
    await expect(dialog.getByRole('list', { name: 'Search results' })).toHaveAttribute('inert', '');
    await stable();
    await expect.poll(() => typeof release).toBe('function');
    await query.fill('empty');
    await expect(dialog).toContainText('No results found');
    release();
    await stable();
    await expect(dialog.getByRole('link')).toHaveCount(0);
    await query.fill('failure');
    await expect(dialog.getByRole('alert')).toContainText('Search service unavailable');
    await stable();
    await query.clear();
    await expect(dialog.getByRole('status')).toHaveText('Type to search the documentation');
    await stable();
    await query.fill('one');
    await expect(dialog.getByRole('link')).toHaveCount(1);
    await stable();
    await page.screenshot({ path: info.outputPath(`search-${viewport.width}.png`) });
    await query.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}
