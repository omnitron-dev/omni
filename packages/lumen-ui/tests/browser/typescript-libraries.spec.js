import { expect } from '@playwright/test';
import { createBrowserTest } from './browser-fixture.js';

const test = createBrowserTest('typescript-libraries.html', {
  contentSecurityPolicy: "default-src 'self'; script-src 'self'; style-src 'self'",
});

test('compiled AST uses real standard TypeScript libraries offline under CSP', async ({ page, url }) => {
  const errors = [],
    external = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (!request.url().startsWith(new URL(url).origin)) external.push(request.url());
  });
  await page.goto(url);
  await page.getByLabel('TypeScript source').fill('const value = new AbortController().signal;\n//    ^?');
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.locator('#result')).toHaveAttribute('data-status', 'complete');
  const result = JSON.parse(await page.locator('#result').textContent());
  expect(result.actualErrors).toEqual([]);
  expect(result.errorsValid).toBe(true);
  expect(result.annotations[0].text).toContain('const value: AbortSignal');
  await page.getByLabel('TypeScript source').fill('const value = 1;\n// ^?');
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.locator('#result')).toHaveAttribute('data-status', 'error');
  await expect(page.locator('#result')).toContainText('No TypeScript symbol');
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
