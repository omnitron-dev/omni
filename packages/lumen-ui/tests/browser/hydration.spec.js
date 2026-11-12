import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build, preview } from 'vite';
import { test as base, expect } from '@playwright/test';
import { PortalIslandHost } from '../../dist/hydration/index.js';
import { toHtmlSsr } from '@omnitron-dev/lumen-ast';

const test = base.extend({
  channel: [({ launchOptions }, provide) => provide(process.env.PLAYWRIGHT_CHANNEL ?? launchOptions.channel), { scope: 'worker', option: true }],
  url: [async ({}, provide) => {
    const root = import.meta.dirname;
    const output = await mkdtemp(path.join(os.tmpdir(), 'lumen-hydration-browser-'));
    const shared = { value: '<script>window.pwned=true</script>' };
    const markup = renderToStaticMarkup(React.createElement(PortalIslandHost, {
      islandId: 'react-host', component: 'Counter', hydrate: 'interaction', props: { label: 'React', left: shared, right: shared },
    }, 'React fallback')) + toHtmlSsr({ frontmatter: {}, toc: [], diagnostics: [], children: [
      { type: 'jsxWidget', name: 'Counter', props: { label: 'AST', hydrate: 'interaction' }, children: [{ type: 'text', value: 'AST fallback' }] },
    ] });
    let server;
    try {
      const config = { root, configFile: false, publicDir: false, logLevel: 'error',
        resolve: { dedupe: ['react', 'react-dom'] },
        plugins: [{ name: 'actual-ssr-fixture', transformIndexHtml: html => html.replace('<!--ssr-islands-->', markup) }],
        build: { outDir: output, rolldownOptions: { input: path.join(root, 'hydration.html') } },
        preview: { host: '127.0.0.1', port: 0, headers: {
          'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
        } },
      };
      await build(config); server = await preview(config);
      await provide('http://127.0.0.1:' + server.httpServer.address().port + '/hydration.html');
    } finally { await server?.close(); await rm(output, { recursive: true, force: true }); }
  }, { scope: 'worker', timeout: 90_000 }],
});

test('actual React and AST SSR hosts share props and respond to same-element metadata updates', async ({ page, url }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  const react = page.locator('[data-lumen-island="react-host"]');
  const ast = page.locator('[data-widget="Counter"]');
  await expect(page.getByRole('button', { name: 'Page counter 0' })).toBeVisible();
  await expect(ast.getByRole('button')).toHaveCount(0);
  // Exercise the pending trigger before pointer interaction can legitimately activate this island.
  await ast.evaluate(element => {
    element.setAttribute('data-hydrate', 'onready');
    element.dispatchEvent(new Event('click'));
  });
  await expect(ast.getByRole('button')).toHaveCount(0);
  await ast.evaluate(element => element.dispatchEvent(new Event('ready')));
  await expect(ast.getByRole('button')).toHaveText('AST 0');
  await react.click();
  await expect(react.getByRole('button')).toHaveText('React 0');
  await expect(react.locator('output')).toHaveText('<script>window.pwned=true</script> / <script>window.pwned=true</script>');
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
  await react.getByRole('button').click();
  await react.evaluate(element => element.setAttribute('data-props', JSON.stringify({ label: 'Updated' })));
  await expect(react.getByRole('button')).toHaveText('Updated 1');
  expect(errors).toEqual([]);
});

test('malformed props or trigger fail locally and the same host can recover', async ({ page, url }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  const react = page.locator('[data-lumen-island="react-host"]');
  await react.evaluate(element => { element.setAttribute('data-props', '{bad'); element.dispatchEvent(new Event('click')); });
  await expect(react.getByRole('alert')).toContainText('invalid island metadata');
  await expect(react.getByRole('button')).toHaveCount(0);
  await page.getByRole('button', { name: 'Page counter 0' }).click();
  await expect(page.getByRole('button', { name: 'Page counter 1' })).toBeVisible();
  await react.evaluate(element => {
    element.setAttribute('data-props', '{"label":"Recovered"}'); element.setAttribute('data-hydrate', 'load');
  });
  await expect(react.getByRole('button')).toHaveText('Recovered 0');
  await react.evaluate(element => element.setAttribute('data-hydrate', 'misspelled'));
  await expect(react.getByRole('alert')).toBeVisible();
  await expect(react.getByRole('button')).toHaveCount(0);
  await react.evaluate(element => { element.setAttribute('data-hydrate', 'interaction'); element.setAttribute('data-props', '[]'); });
  await expect(react.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Page counter 1' }).click();
  await expect(page.getByRole('button', { name: 'Page counter 2' })).toBeVisible();
  expect(errors).toEqual([]);
});
