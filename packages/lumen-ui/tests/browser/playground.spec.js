import { expect } from '@playwright/test';
import { createBrowserTest } from './browser-fixture.js';

const test = createBrowserTest('playground.html');

async function run(page, code) {
  await page.getByRole('textbox', { name: 'JavaScript playground' }).fill(code);
  await page.getByRole('button', { name: 'Run code', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Execution result' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run code', exact: true })).toBeEnabled();
}

test('the shipped module worker executes expressions, function bodies and guest promises under CSP', async ({ page, url }) => {
  await page.goto(url);
  await run(page, 'return await Promise.resolve(6 * 7)');
  await expect(page.locator('.lumen-playground-result')).toHaveText('42');
  await run(page, 'console.log("computed", 42);');
  await expect(page.locator('.lumen-playground-result')).toHaveText('computed 42');
  await expect.poll(() => page.evaluate(() => window.playgroundAudit.created === window.playgroundAudit.terminated)).toBe(true);
});

test('constructor access stays inside the interpreter and cannot reach host data or network', async ({ page, url }) => {
  let networkHits = 0;
  await page.route('**/canary', route => { networkHits++; return route.fulfill({ body: 'host data' }); });
  await page.goto(url);
  await page.evaluate(() => { document.cookie = 'canary=private'; localStorage.setItem('canary', 'private'); });
  await run(page, 'return ({ }).constructor.constructor("return [typeof fetch, typeof document, typeof localStorage, typeof process, typeof WebSocket]")()');
  await expect(page.locator('.lumen-playground-result')).toHaveText('[ "undefined", "undefined", "undefined", "undefined", "undefined" ]');
  await run(page, 'return console.log.constructor("return typeof fetch")()');
  await expect(page.locator('.lumen-playground-result')).toHaveText('undefined');
  await run(page, 'return await fetch("/canary")');
  await expect(page.getByRole('alert')).toBeVisible();
  expect(networkHits).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('canary'))).toBe('private');
  await run(page, 'Object.prototype.lumenCanary = "guest"; return Object.prototype.lumenCanary');
  await expect(page.locator('.lumen-playground-result')).toHaveText('guest');
  expect(await page.evaluate(() => Object.prototype.lumenCanary)).toBeUndefined();
  await run(page, 'return typeof Object.prototype.lumenCanary');
  await expect(page.locator('.lumen-playground-result')).toHaveText('undefined');
});

test('infinite work cannot block the host and the next execution uses a fresh worker', async ({ page, url }) => {
  await page.goto(url + '?timeout=700');
  await page.getByRole('textbox', { name: 'JavaScript playground' }).fill('while (true) {}');
  await page.getByRole('button', { name: 'Run code', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Running code…');
  await page.getByRole('button', { name: 'Host counter 0' }).click();
  await expect(page.getByRole('button', { name: 'Host counter 1' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(/timed out|interrupted/i);
  await expect.poll(() => page.evaluate(() => window.playgroundAudit.terminated)).toBe(1);
  await run(page, 'return 42');
  await expect(page.locator('.lumen-playground-result')).toHaveText('42');
});

test('aggregate memory and output limits fail explicitly and preserve the page', async ({ page, url }) => {
  await page.goto(url);
  await run(page, 'const buffers = []; for (let i = 0; i < 1024; i++) buffers.push(new ArrayBuffer(1024 * 1024)); return buffers.length;');
  await expect(page.getByRole('alert')).toBeVisible();
  await run(page, 'return "x".repeat(70000)');
  await expect(page.getByRole('alert')).toContainText(/limit|memory/i);
  await run(page, 'return 42');
  await expect(page.locator('.lumen-playground-result')).toHaveText('42');
  await expect.poll(() => page.evaluate(() => window.playgroundAudit.created === window.playgroundAudit.terminated)).toBe(true);
});

test('a worker load failure and remote denial cannot become a recorded success', async ({ page, url }) => {
  await page.route('**/*playground-worker*.js', route => route.abort());
  await page.goto(url);
  await page.getByRole('button', { name: 'Run code', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.lumen-playground-result')).toHaveCount(0);
  await expect(page.getByText('Recorded output', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.playgroundAudit.results[0].result)).toBeUndefined();
  await page.goto(url + '?server');
  await page.getByRole('button', { name: 'Run code', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Permission denied');
  expect(await page.evaluate(() => window.playgroundAudit.created)).toBe(0);
});

test('a browser without Worker support fails without touching host storage', async ({ page, url }) => {
  await page.goto(url);
  await page.evaluate(() => { window.Worker = undefined; });
  await run(page, 'localStorage.setItem("escape", "executed"); return 42');
  await expect(page.getByRole('alert')).toContainText('Web Worker runtime is unavailable');
  expect(await page.evaluate(() => localStorage.getItem('escape'))).toBeNull();
});
