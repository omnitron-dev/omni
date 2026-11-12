import { expect } from '@playwright/test';
import { createBrowserTest } from './browser-fixture.js';

const test = createBrowserTest('diagrams.html');

for (const width of [320, 1440]) {
  test(`pagination mirrors arrows and keeps single neighbours in place at ${width}px`, async ({ page, cliSiteUrl }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(cliSiteUrl);
    for (const direction of ['ltr', 'rtl']) {
      await page.evaluate(value => { document.documentElement.dir = value; }, direction);
      for (const kind of ['both', 'previous', 'next']) {
        const group = page.locator(`[data-pagination="${kind}"]`);
        await group.scrollIntoViewIfNeeded();
        const nav = group.getByRole('navigation', { name: 'Docs pagination' });
        const bounds = await nav.boundingBox();
        const prev = nav.locator('a[rel=prev]'); const next = nav.locator('a[rel=next]');
        await expect(prev).toHaveCount(kind === 'next' ? 0 : 1);
        await expect(next).toHaveCount(kind === 'previous' ? 0 : 1);
        for (const [link, previous] of [[prev, true], [next, false]]) {
          if (!await link.count()) continue;
          const arrow = await link.locator('.lumen-pagination-arrow').boundingBox();
          const label = await link.locator('.lumen-pagination-label').boundingBox();
          const box = await link.boundingBox();
          const onLeft = previous === (direction === 'ltr');
          if (onLeft) {
            expect(box.x).toBeCloseTo(bounds.x, 0);
            expect(arrow.x + arrow.width).toBeLessThan(label.x);
          } else {
            expect(box.x).toBeGreaterThan(bounds.x + bounds.width / 2);
            expect(label.x + label.width).toBeLessThan(arrow.x);
          }
          await link.focus(); await expect(link).toBeFocused();
        }
        expect(await nav.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      }
    }
  });
}

test('filetree disclosures, markers and annotations work without client JavaScript at 320px', async ({ browser, cliSiteUrl }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 900 } });
  try {
    const page = await context.newPage(); await page.goto(cliSiteUrl);
    const tree = page.locator('.lumen-file-tree');
    await expect(tree.locator('figcaption')).toHaveText('sample/');
    const directory = tree.locator('details').first();
    const child = tree.getByText('fileTreeSearchToken.ts', { exact: true });
    await expect(child).toBeVisible();
    const summary = directory.locator(':scope > summary');
    await summary.focus(); await page.keyboard.press('Enter'); await expect(child).toBeHidden();
    await page.keyboard.press('Space'); await expect(child).toBeVisible();
    await expect(tree.getByText('entry point', { exact: false })).toBeVisible();
    await expect(tree.locator('a')).toHaveCount(0);
    const bounds = await tree.boundingBox(); expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
    expect(await tree.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const marker = await tree.locator('svg').first().boundingBox();
    expect(marker.width).toBe(16); expect(marker.height).toBe(16);
  } finally { await context.close(); }
});

test('filetree content is present in the built Pagefind index', async ({ page, cliSiteUrl }) => {
  await page.goto(cliSiteUrl);
  const results = await page.evaluate(async () => {
    const pagefind = await import('/pagefind/pagefind.js');
    const result = await pagefind.search('fileTreeSearchToken');
    return Promise.all(result.results.map(async item => (await item.data()).url));
  });
  expect(results).toEqual(['/docs']);
});
