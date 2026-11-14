import { expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
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
          const word = previous ? 'Previous' : 'Next';
          await expect(link).toHaveAccessibleName(`${word} ${word} documentation page`);
          await expect(link.locator('.lumen-pagination-direction')).toHaveText(word);
          await expect(link.locator('svg[aria-hidden="true"]')).toBeVisible();
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

test('localized document pagination works from server HTML using the keyboard and no JavaScript', async ({ browser, cliSiteUrl }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 740 } });
  try {
    const page = await context.newPage();
    await page.goto(cliSiteUrl);
    const nav = page.getByRole('navigation', { name: 'Documentos' });
    const previous = nav.getByRole('link', { name: 'Anterior Inicio' });
    const next = nav.getByRole('link', { name: 'Siguiente Detalles' });
    await previous.focus();
    await page.keyboard.press('Tab');
    await expect(next).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#native-cli-document$/);
  } finally { await context.close(); }
});

test('the component example exposes its real module without scripting and restores state when activated', async ({ browser, cliSiteUrl }) => {
  const source = await readFile(new URL('./cli-site/counter-example.js', import.meta.url), 'utf8');
  for (const javaScriptEnabled of [false, true]) {
    const context = await browser.newContext({ javaScriptEnabled, viewport: { width: 320, height: 740 } });
    try {
      const page = await context.newPage();
      await page.goto(cliSiteUrl);
      const example = page.getByRole('figure', { name: 'Counter example' });
      const reset = example.getByRole('button', { name: 'Reset example' });
      if (javaScriptEnabled) await expect(reset).toBeVisible();
      else await expect(reset).toHaveCount(0);
      const summary = example.getByText('Source code', { exact: true });
      await summary.focus();
      await page.keyboard.press('Enter');
      const code = example.locator('details code');
      await expect(code).toBeVisible();
      expect(await code.textContent()).toBe(source);
      const count = example.getByRole('button', { name: 'Count 0' });
      await expect(count).toBeVisible();
      if (javaScriptEnabled) {
        await count.click();
        await expect(example.getByRole('button', { name: 'Count 1' })).toBeVisible();
        await reset.click();
        await expect(count).toBeVisible();
        await expect(code).toBeVisible();
      }
    } finally { await context.close(); }
  }
});

test('a failing island shows its runtime error while the static document and adjacent interactive island survive', async ({ page, cliSiteUrl }) => {
  await page.goto(cliSiteUrl);
  const counter = page.getByRole('figure', { name: 'Counter example' });
  await expect(counter.getByRole('button', { name: 'Reset example' })).toBeVisible();
  await counter.getByRole('button', { name: 'Count 0' }).click();
  const failed = page.locator('[data-lumen-island="failure-preview"]');
  await expect(failed).toHaveText('Recorded preview');
  await failed.click();
  await expect(failed.getByRole('alert')).toHaveText('FailurePreview could not render. Preview data is unavailable');
  await counter.getByRole('button', { name: 'Count 1' }).click();
  await expect(counter.getByRole('button', { name: 'Count 2' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'CLI browser boundary' })).toBeVisible();
  await failed.evaluate(element => { element.dataset.props = JSON.stringify({ ready: true }); });
  await expect(failed).toHaveText('Data restored');
  await expect(counter.getByRole('button', { name: 'Count 2' })).toBeVisible();
});

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
    const codeBlocks = page.locator('.lumen-code-block');
    await expect(codeBlocks).toHaveCount(2); // Document code and the initially closed example source.
    for (const code of await codeBlocks.all()) {
      await expect(code).toHaveAttribute('tabindex', '0');
    }
    await expect(page.getByRole('table')).toHaveAttribute('tabindex', '0');
    await expect(page.locator('pre.lumen-diagram-source')).toHaveAttribute('tabindex', '0');
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

const scrollports = '.lumen-code-block,.lumen-doc table,.lumen-file-tree,.lumen-diagram-content,.lumen-api-explorer-list-container';
const transparentThumb = 'rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)';

async function prepareScrollports(page, url, includeApi = false) {
  await page.goto(url);
  await expect(page.locator('.lumen-diagram-content svg')).toBeVisible();
  // Include the source of the live example as a scrollport. Closed native
  // disclosures keep their code in the DOM, but cannot be hovered or tabbed to.
  const source = page.getByRole('figure', { name: 'Counter example' }).locator('details');
  await source.evaluate(element => { element.open = true; });
  await expect(source.locator('code')).toBeVisible();
  if (includeApi) {
    await page.getByRole('button', { name: 'Open API explorer' }).click();
    await expect(page.getByRole('listbox', { name: 'API symbols' })).toBeVisible();
  }
  // Constrain ordinary emitted blocks, without supplying any scrollbar rules.
  // The file tree normally wraps, but consumers can bound a long tree's height.
  await page.locator(scrollports).evaluateAll(elements => {
    for (const element of elements) {
      element.style.cssText += ';display:block;max-width:200px;max-height:40px;overflow:auto';
    }
  });
}

test('internal scrollbars reveal on hover and keyboard focus without resizing their scrollports', async ({ page, cliSiteUrl }) => {
  await prepareScrollports(page, cliSiteUrl, true);
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
    const symbols = page.getByRole('listbox', { name: 'API symbols' });
    await symbols.focus();
    await expect(symbols).not.toHaveCSS('scrollbar-color', transparentThumb);
    expect(await symbols.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await page.locator('button').first().focus();
  }
});

test('touch and forced-colors keep visible native scrollbar indications', async ({ browser, cliSiteUrl }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await prepareScrollports(page, cliSiteUrl, true);
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

test('Tab reaches native code, table and diagram scrollports and arrow keys scroll their content', async ({ page, cliSiteUrl }) => {
  await prepareScrollports(page, cliSiteUrl);
  await page.addStyleTag({ content: '.lumen-doc td{white-space:nowrap}.lumen-diagram-content>svg{min-width:600px}.client-code{overflow:auto}' });
  const selector = '.lumen-code-block,.lumen-doc table,.lumen-diagram-content';
  const blocks = page.locator(selector);
  await expect(blocks).toHaveCount(5); // SSR code, example source, client CodeBlock, table, diagram.
  for (const block of await blocks.all()) {
    await expect(block).toHaveAttribute('tabindex', '0');
    expect(await block.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  }
  const visited = new Set();
  for (let tabs = 0; tabs < 30 && visited.size < 5; tabs++) {
    await page.keyboard.press('Tab');
    const index = await page.evaluate(query => [...document.querySelectorAll(query)].indexOf(document.activeElement), selector);
    if (index < 0 || visited.has(index)) continue;
    const block = blocks.nth(index);
    await expect(block).toBeFocused();
    expect(await block.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => block.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    visited.add(index);
  }
  expect(visited.size).toBe(5);
  await expect(page.getByRole('table')).toHaveCount(1);
  await expect(page.getByRole('group', { name: 'Diagram', exact: true })).toHaveCount(1);
});
