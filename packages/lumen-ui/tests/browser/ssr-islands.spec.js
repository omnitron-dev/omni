import { expect } from '@playwright/test';
import { createBrowserTest, withBrowserModules } from './browser-fixture.js';

const test = createBrowserTest('ssr-islands.html', {
  source: true,
  plugins: [{
    name: 'ssr-registered-island',
    async transformIndexHtml(html) {
      return withBrowserModules(async (load, loadFixture) => {
        const [{ default: React }, { parseDocument }, { renderDocumentHtml }, { Layout, Counter }] = await Promise.all([
          load('react'), load('@omnitron-dev/lumen-ast'), load('@omnitron-dev/lumen'), loadFixture(),
        ]);
        const ast = await parseDocument('# Static component\n\n<Counter hydrate="load" />');
        const Deferred = React.lazy(async () => ({ default: Counter }));
        const ServerCounter = () => React.createElement(React.Suspense, { fallback: 'INCOMPLETE SERVER PREVIEW' }, React.createElement(Deferred));
        const rendered = await renderDocumentHtml(ast, {
          theme: 'light', islands: { Counter: ServerCounter },
          renderLayout: children => React.createElement(Layout, null, children),
        });
        const head = rendered.match(/<head>([\s\S]*?)<\/head>/)?.[1];
        const body = rendered.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1];
        if (!head || !body) throw new Error('Static renderer did not produce a complete document');
        return html.replace('<!--ssr-head-->', head).replace('<!--ssr-body-->', body);
      }, new URL('./ssr-islands.tsx', import.meta.url));
    },
  }],
});

test('registered preview remains visible and stable through lazy activation and reload', async ({ page, url }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    window.framesSeen = [];
    window.snapshot = () => {
      const host = document.querySelector('[data-component="Counter"]');
      if (!host) return;
      const button = host.querySelector('[data-probe="counter"]');
      if (!button) return { empty: true };
      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      return { text: button.textContent, height: rect.height, width: rect.width,
        color: style.color, background: style.backgroundColor };
    };
    const frame = () => { const current = window.snapshot(); if (current) window.framesSeen.push(current); requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  });
  for (let pass = 0; pass < 2; pass++) {
    if (pass) await page.reload(); else await page.goto(url);
    await page.waitForFunction(() => typeof window.startIsland === 'function');
    await expect(page.locator('[data-probe="counter"]')).toHaveText('Requests: 0');
    const initial = await page.evaluate(() => window.snapshot());
    expect(initial).toMatchObject({ width: 200, height: 64 });
    await page.evaluate(() => window.startIsland());
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator('[data-probe="counter"]')).toHaveText('Requests: 0');
    await page.evaluate(() => window.finishIsland());
    await page.waitForFunction(() => document.body.dataset.counterInteractive === 'true');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    for (const frame of await page.evaluate(() => window.framesSeen)) expect(frame).toEqual(initial);
    await expect(page.locator('[data-probe="counter"]')).toHaveCount(1);
    await page.locator('[data-probe="counter"]').click();
    await expect(page.locator('[data-probe="counter"]')).toHaveText('Requests: 1');
  }
  expect(errors).toEqual([]);
});

test('the registered preview is complete without JavaScript', async ({ browser, url }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(url);
    await expect(page.locator('[data-probe="counter"]')).toHaveText('Requests: 0');
    await expect(page.locator('[data-static-preview]')).toBeVisible();
    await expect(page.locator('[data-static-preview]')).toContainText('Complete static preview.');
    await expect(page.getByText('INCOMPLETE SERVER PREVIEW', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Static component' })).toBeVisible();
  } finally { await context.close(); }
});

test('native disclosure state and summary focus survive deferred portal activation', async ({ page, url }) => {
  await page.goto(url);
  await page.waitForFunction(() => typeof window.startIsland === 'function');
  const source = page.locator('details[data-lumen-disclosure="source"]');
  const metadata = page.locator('details[data-lumen-disclosure="metadata"]');
  await metadata.locator('summary').click();
  await source.locator('summary').focus();
  await source.locator('summary').press('Enter');
  await expect(source).toHaveAttribute('open');
  await expect(metadata).not.toHaveAttribute('open');
  await page.evaluate(() => window.startIsland());
  await expect(source.locator('summary')).toBeFocused();
  await page.evaluate(() => window.finishIsland());
  await page.waitForFunction(() => document.body.dataset.counterInteractive === 'true');
  await expect(source).toHaveAttribute('open');
  await expect(metadata).not.toHaveAttribute('open');
  await expect(source.locator('summary')).toBeFocused();
  await source.locator('summary').press('Enter');
  await expect(source).not.toHaveAttribute('open');
});

test('activating a deferred disclosure does not reclaim focus from the rest of the page', async ({ page, url }) => {
  await page.goto(url);
  await page.waitForFunction(() => typeof window.startIsland === 'function');
  const source = page.locator('details[data-lumen-disclosure="source"]');
  await source.locator('summary').click();
  await page.evaluate(() => {
    const outside = document.createElement('button');
    outside.id = 'outside-control';
    outside.textContent = 'Outside';
    document.body.appendChild(outside);
    window.startIsland();
  });
  const outside = page.locator('#outside-control');
  await outside.focus();
  await page.evaluate(() => window.finishIsland());
  await page.waitForFunction(() => document.body.dataset.counterInteractive === 'true');
  await expect(source).toHaveAttribute('open');
  await expect(outside).toBeFocused();
});
