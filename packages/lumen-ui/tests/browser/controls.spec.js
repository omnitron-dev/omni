import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
import { expect } from '@playwright/test';
import { createBrowserTest, importConsumer } from './browser-fixture.js';

// Local UI regressions compile pending source without rewriting the shared SDK
// dist. Archive qualification retains ordinary consumer package resolution.
if (process.env.LUMEN_CONSUMER_ROOT && process.env.LUMEN_AST_ROOT)
  throw new Error('Archive qualification cannot replace its installed Lumen AST');
const astRoot = process.env.LUMEN_AST_ROOT;
// A source-only run may reuse an already verified AST archive when the live SDK
// checkout must remain untouched. Every alias follows that archive's exports.
const astAliases = astRoot ? Object.entries(JSON.parse(readFileSync(path.join(astRoot, 'package.json'), 'utf8')).exports)
  .filter(([, value]) => value.import)
  .map(([name, value]) => ({
    find: new RegExp(`^${('@omnitron-dev/lumen-ast' + (name === '.' ? '' : name.slice(1))).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
    replacement: path.join(astRoot, value.import),
  })) : [];
const sourcePlugins = process.env.LUMEN_CONSUMER_ROOT ? [] : [{
  name: 'lumen-controls-source',
  config: () => ({ resolve: { alias: [
    { find: /^@omnitron-dev\/lumen-ui$/, replacement: fileURLToPath(new URL('../../src/index.ts', import.meta.url)) },
    ...astAliases,
  ] } }),
}];
const test = createBrowserTest('controls.html', { plugins: [...sourcePlugins, {
  name: 'prism-native-focus-ssr',
  async transformIndexHtml(html) {
    const { default: React } = await importConsumer('react');
    const { renderToStaticMarkup } = await importConsumer('react-dom/server');
    const { Box, Button, IconButton, PrismThemeProvider } = await importConsumer('@omnitron-dev/prism/ui');
    const { SearchIcon } = await importConsumer('@omnitron-dev/prism/icons');
    let server;
    let cache;
    try {
      let themeModule;
      if (process.env.LUMEN_CONSUMER_ROOT) themeModule = await importConsumer('@omnitron-dev/prism/theme');
      else {
        cache = await mkdtemp(path.join(os.tmpdir(), 'prism-focus-ssr-'));
        server = await createServer({
          configFile: false, root: fileURLToPath(new URL('../../../prism', import.meta.url)),
          cacheDir: cache, publicDir: false, appType: 'custom', logLevel: 'error',
          server: { middlewareMode: true, hmr: false, ws: false, watch: null },
          optimizeDeps: { noDiscovery: true, include: [] },
          ssr: { external: true, optimizeDeps: { noDiscovery: true, include: [] } },
        });
        themeModule = await server.ssrLoadModule(fileURLToPath(new URL('../../../prism/src/theme/create-theme.ts', import.meta.url)));
      }
      const markup = ['light', 'dark'].map(mode => renderToStaticMarkup(React.createElement(PrismThemeProvider, {
        theme: themeModule.createPrismTheme({ mode, cssVariables: { enabled: false } }),
      }, React.createElement(Box, { component: 'section', 'aria-label': `${mode} native controls`, sx: { p: 2, bgcolor: 'background.default', color: 'text.primary' } },
        React.createElement(Button, { href: '#guide', disableRipple: true }, `Native guide ${mode}`),
        React.createElement(IconButton, { 'aria-label': `Native search ${mode}`, disableRipple: true }, React.createElement(SearchIcon)),
        React.createElement(Button, { disabled: true, disableRipple: true }, 'Unavailable'),
      )))).join('');
      return html.replace('<!--ssr-focus-->', markup);
    } finally {
      await server?.close();
      if (cache) await rm(cache, { recursive: true, force: true });
    }
  },
}] });

for (const forcedColors of ['none', 'active']) {
  test(`native SSR controls retain keyboard focus without JavaScript (${forcedColors} forced colors)`, async ({ browser, url }, testInfo) => {
    const context = await browser.newContext({ javaScriptEnabled: false, forcedColors, viewport: { width: 320, height: 700 } });
    try {
      const page = await context.newPage();
      await page.goto(url);
      for (const mode of ['light', 'dark']) {
        const section = page.getByRole('region', { name: `${mode} native controls` });
        for (const control of [section.getByRole('link', { name: `Native guide ${mode}` }), section.getByRole('button', { name: `Native search ${mode}` })]) {
          await page.keyboard.press('Tab');
          await expect(control).toBeFocused();
          expect(await control.evaluate(element => element.matches(':focus-visible'))).toBe(true);
          await expect(control).not.toHaveClass(/Mui-focusVisible/);
          await expect(control).toHaveCSS('outline-style', 'solid');
          await expect(control).toHaveCSS('outline-width', '2px');
          await expect(control).toHaveCSS('outline-offset', '2px');
          if (forcedColors === 'active') {
            const highlight = await page.evaluate(() => {
              const probe = document.createElement('span'); probe.style.color = 'Highlight'; document.body.append(probe);
              const color = getComputedStyle(probe).color; probe.remove(); return color;
            });
            await expect(control).toHaveCSS('outline-color', highlight);
          }
        }
      }
      await page.screenshot({ path: testInfo.outputPath(`native-focus-${forcedColors}.png`) });
    } finally { await context.close(); }
  });
}

test('navbar menus and selectors work with the keyboard at mobile widths', async ({ page, url }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(url);
  const docs = page.getByRole('button', { name: 'Docs', exact: true });
  await docs.focus(); await docs.press('Enter');
  const menu = page.getByRole('menu', { name: 'Docs', exact: true });
  await expect(menu.getByRole('menuitem', { name: 'Guide', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'API', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(docs).toBeFocused();
  for (const [name, option] of [['Documentation version', 'v2'], ['Language', 'de']]) {
    const select = page.getByRole('combobox', { name });
    await select.focus(); await select.press('Enter');
    await page.getByRole('option', { name: option, exact: true }).press('Enter');
  }
  await expect(page.getByLabel('Selected edition')).toHaveText('v2 / de');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('shared search modal traps keyboard focus, selects results and restores its trigger', async ({ page, url }) => {
  await page.goto(url);
  const trigger = page.getByRole('button', { name: 'Search', exact: true });
  await trigger.focus(); await trigger.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Search documentation' });
  const query = dialog.getByRole('searchbox', { name: 'Search query' });
  await expect(query).toBeFocused();
  await dialog.getByRole('tab', { name: 'Local Docs' }).focus();
  await page.keyboard.press('ArrowRight');
  const semantic = dialog.getByRole('tab', { name: 'Semantic AI' });
  await expect(semantic).toBeFocused();
  await semantic.press('Space');
  await expect(semantic).toHaveAttribute('aria-selected', 'true');
  await query.fill('contracts');
  const result = dialog.getByRole('link', { name: /Guide for contracts/ });
  await expect(result).toHaveAttribute('href', '#guide');
  await result.focus(); await page.keyboard.press('Tab');
  await expect(query).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(result).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.press('Enter');
  await dialog.getByRole('tab', { name: 'Semantic AI' }).click();
  await query.fill('contracts');
  await result.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/#guide$/);
  // Dismissing the dialog restores its trigger; following a result keeps native
  // fragment navigation and moves the next Tab into the destination content.
  await expect(page.getByRole('heading', { name: 'Guide', exact: true })).toBeInViewport();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('searchbox', { name: 'Filter API symbols' })).toBeFocused();
});

test('API filtering and playground disabled states keep their original contracts', async ({ page, url }) => {
  await page.goto(url);
  const list = page.getByRole('listbox', { name: 'API symbols' });
  await list.focus(); await list.press('End'); await list.press('Enter');
  await expect(page.getByLabel('Selected symbol')).toHaveText('Symbol 999');
  await page.getByRole('searchbox', { name: 'Filter API symbols' }).fill('Symbol 237');
  await expect(list.getByRole('option')).toHaveCount(1);
  await list.getByRole('option', { name: 'Symbol 237', exact: true }).click();
  await expect(page.getByLabel('Selected symbol')).toHaveText('Symbol 237');
  const recorded = page.getByRole('button', { name: 'Recorded output', exact: true });
  await expect(recorded).toHaveAttribute('aria-expanded', 'true');
  await recorded.focus(); await recorded.press('Enter');
  await expect(recorded).toHaveAttribute('aria-expanded', 'false');
  const editor = page.getByRole('textbox', { name: 'JavaScript playground' });
  await editor.fill('return 6 * 7');
  await expect(recorded).toHaveCount(0);
  const run = page.getByRole('button', { name: 'Run code', exact: true });
  await run.focus(); await run.press('Enter');
  await expect(run).toBeDisabled();
  await expect(editor).toHaveAttribute('readonly', '');
  await page.getByRole('button', { name: 'Complete execution' }).click();
  await expect(page.getByRole('region', { name: 'Execution result' })).toContainText('42');
  await expect(run).toBeEnabled();
  await expect(editor).not.toHaveAttribute('readonly');
});
