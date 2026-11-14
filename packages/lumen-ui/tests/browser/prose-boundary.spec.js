import { expect } from '@playwright/test';
import { createBrowserTest } from './browser-fixture.js';

const test = createBrowserTest('diagrams.html');
const properties = ['color', 'font-size', 'font-family', 'line-height', 'margin-top', 'margin-bottom',
  'padding-top', 'padding-right', 'border-top-width', 'border-radius', 'text-decoration-line'];

async function styles(locator) {
  return locator.evaluate((element, keys) => {
    const computed = getComputedStyle(element);
    return Object.fromEntries(keys.map(key => [key, computed.getPropertyValue(key)]));
  }, properties);
}

for (const javaScriptEnabled of [false, true]) {
  test(`prose cannot restyle Prism components with JavaScript=${javaScriptEnabled}`, async ({ browser, cliSiteUrl }) => {
    const context = await browser.newContext({ javaScriptEnabled });
    try {
      const page = await context.newPage();
      await page.goto(new URL('docs/style-boundary.html', cliSiteUrl).href);
      const reference = page.locator('[data-style-reference]');
      const examples = [page.locator('[data-example="style-boundary"]')];
      if (javaScriptEnabled) examples.push(page.locator('[data-component="StyleBoundary"]'));
      await expect(reference.locator('.MuiTypography-h4')).toHaveCSS('margin-top', '4px');

      for (const example of examples) {
        await expect(example.locator('.MuiTypography-h4')).toHaveText('42');
        for (const selector of ['.MuiTypography-h4', '.MuiAccordion-heading', '[data-owned-link]',
          '.lumen-code-block', '.lumen-code-block code']) {
          expect(await styles(example.locator(selector)), selector).toEqual(await styles(reference.locator(selector)));
        }
        await example.locator('[data-owned-link]').hover();
        await expect(example.locator('[data-owned-link]')).toHaveCSS('text-decoration-line', 'none');
      }
      await expect(reference.locator('.lumen-code-block')).toHaveCSS('padding-top', '16px');

      const prose = await styles(page.locator('[data-prose-heading]'));
      expect(parseFloat(prose['margin-top'])).toBeCloseTo(parseFloat(prose['font-size']) * 1.75, 2);
      await page.locator('[data-prose-link]').hover();
      await expect(page.locator('[data-prose-link]')).toHaveCSS('text-decoration-line', 'underline');
    } finally { await context.close(); }
  });
}
