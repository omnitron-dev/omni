import { expect } from '@playwright/test';
import { createBrowserTest } from './browser-fixture.js';

const test = createBrowserTest('diagrams.html');

test('diagram labels cannot become islands or override accessibility metadata', async ({ page, cliSiteUrl }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL('docs/label-boundary.html', cliSiteUrl).href);
  await expect(page.locator('[data-canary-origin="trusted-widget"]')).toBeVisible();
  const svg = page.locator('.lumen-diagram-content svg');
  await expect(svg).toBeVisible();
  const authoredAttributes = await svg.locator('foreignObject *').evaluateAll(elements => elements.flatMap(element =>
    element.getAttributeNames().filter(name => /^(?:data-|aria-)/.test(name)).map(name => [name, element.getAttribute(name)]),
  ));
  const activations = await page.evaluate(() => window.labelActivations);
  await test.info().attach('label-boundary', { body: JSON.stringify({ authoredAttributes, activations }), contentType: 'application/json' });
  expect(authoredAttributes).toEqual([]);
  expect(activations).toEqual(['trusted-widget']);
  for (const label of ['Island label', 'Widget label', 'Accessible label']) await expect(svg).toContainText(label);
  await expect(page.locator('[data-canary-origin]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('the native CLI preserves lazy client imports after rendering a custom SSR layout', async ({ page, cliSiteUrl }) => {
  const errors = [];
  const scripts = new Set();
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => errors.push(`${request.failure()?.errorText} ${request.url()}`));
  page.on('response', response => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    if (response.request().resourceType() === 'script') scripts.add(response.url());
  });
  await page.goto(cliSiteUrl);
  await expect(page.locator('[data-ssr-layout="CUSTOM_LAYOUT_STATE"]')).toContainText('CLI browser boundary');
  await expect(page.locator('.cli-lazy-api')).toHaveCount(0);
  const before = new Set(scripts);
  await page.getByRole('button', { name: 'Open API explorer' }).click();
  await expect.poll(async () => ({
    apiVisible: await page.getByRole('listbox', { name: 'API symbols' }).isVisible(), errors,
  })).toEqual({ apiVisible: true, errors: [] });
  await page.getByRole('searchbox', { name: 'Filter API symbols' }).fill('TokenService');
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('option')).toContainText('TokenService');
  await expect(page.locator('.cli-lazy-api')).toHaveCSS('border-top-width', '3px');
  expect([...scripts].some(url => !before.has(url) && /\/assets\/lazy-api\./.test(url))).toBe(true);
  const svg = page.locator('.lumen-diagram-content svg');
  await expect(svg).toBeVisible();
  await expect(svg).toContainText('CLI input');
  await expect(svg).toContainText('Browser output');
  await expect(svg.locator('.node')).toHaveCount(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});
