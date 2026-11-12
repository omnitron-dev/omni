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

const scrollports = '.lumen-code-block,.lumen-doc table,.lumen-file-tree,.lumen-diagram-content';
const transparentThumb = 'rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)';

async function prepareScrollports(page, url) {
  await page.goto(url);
  await expect(page.locator('.lumen-diagram-content svg')).toBeVisible();
  // Constrain ordinary emitted blocks, without supplying any scrollbar rules.
  // The file tree normally wraps, but consumers can bound a long tree's height.
  await page.locator(scrollports).evaluateAll(elements => {
    for (const element of elements) {
      element.style.cssText += ';display:block;max-width:200px;max-height:100px;overflow:auto';
    }
  });
}

test('internal scrollbars reveal on hover and keyboard focus without resizing their scrollports', async ({ page, cliSiteUrl }) => {
  await prepareScrollports(page, cliSiteUrl);
  for (const mode of ['light', 'dark']) {
    await page.locator('.lumen-shell').evaluateAll((elements, value) => {
      for (const element of elements) element.setAttribute('data-theme', value);
    }, mode);
    for (const block of await page.locator(scrollports).all()) {
      await block.scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await expect(block).toHaveCSS('scrollbar-color', transparentThumb);
      await expect(block).toHaveCSS('scrollbar-width', 'thin');
      const before = await block.evaluate(element => [element.clientWidth, element.clientHeight]);
      await block.hover();
      await expect(block).not.toHaveCSS('scrollbar-color', transparentThumb);
      expect(await block.evaluate(element => [element.clientWidth, element.clientHeight])).toEqual(before);
    }
    const tree = page.locator('.lumen-file-tree');
    await page.mouse.move(0, 0);
    await tree.locator('summary').first().focus();
    await expect(tree).not.toHaveCSS('scrollbar-color', transparentThumb);
    await page.keyboard.press('Tab');
    await expect(tree.locator('summary').nth(1)).toBeFocused();
    await page.locator('button').first().focus();
    await expect(tree).toHaveCSS('scrollbar-color', transparentThumb);
  }
});

test('touch and forced-colors keep visible native scrollbar indications', async ({ browser, cliSiteUrl }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await prepareScrollports(page, cliSiteUrl);
    expect(await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches)).toBe(false);
    for (const block of await page.locator(scrollports).all()) {
      await expect(block).toHaveCSS('scrollbar-width', 'thin');
      await expect(block).not.toHaveCSS('scrollbar-color', transparentThumb);
    }
    await page.emulateMedia({ forcedColors: 'active' });
    for (const block of await page.locator(scrollports).all()) {
      await expect(block).toHaveCSS('scrollbar-color', 'auto');
      await expect(block).toHaveCSS('scrollbar-width', 'auto');
    }
  } finally { await context.close(); }
});
