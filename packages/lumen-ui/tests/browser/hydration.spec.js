import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect } from '@playwright/test';
import { PortalIslandHost } from '../../dist/hydration/index.js';
import { toHtmlSsr } from '@omnitron-dev/lumen-ast';
import { createBrowserTest } from './browser-fixture.js';

const shared = { value: '<script>window.pwned=true</script>' };
const markup = renderToStaticMarkup(React.createElement(PortalIslandHost, {
  islandId: 'react-host', component: 'Counter', hydrate: 'interaction', props: { label: 'React', left: shared, right: shared },
}, 'React fallback')) + toHtmlSsr({ frontmatter: {}, toc: [], diagnostics: [], children: [
  { type: 'jsxWidget', name: 'Counter', props: { label: 'AST', hydrate: 'interaction' }, children: [{ type: 'text', value: 'AST fallback' }] },
] });
const test = createBrowserTest('hydration.html', {
  plugins: [{ name: 'actual-ssr-fixture', transformIndexHtml: html => html.replace('<!--ssr-islands-->', markup) }],
  contentSecurityPolicy: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
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
