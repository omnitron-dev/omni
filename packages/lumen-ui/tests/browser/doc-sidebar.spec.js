import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';
import { createBrowserTest, withBrowserModules } from './browser-fixture.js';

const item = index => ({
  id: index === 3 || index === 60 ? 'shared-topic' : 'topic-' + index,
  label: 'Topic ' + index, href: '?page=' + index,
});
const items = Array.from({ length: 8 }, (_, group) => ({
  id: 'chapter-' + group, label: 'Chapter ' + group,
  children: [{ id: 'section-' + group, label: 'Section ' + group,
    children: Array.from({ length: 8 }, (_, child) => item(group * 8 + child)) }],
}));
const pages = new Map();
const test = createBrowserTest('doc-sidebar.html', { source: true, plugins: [{
  name: 'document-navigation-pages',
  async transformIndexHtml(html) {
    await withBrowserModules(async load => {
      const React = await load('react');
      const { renderToStaticMarkup } = await load('react-dom/server');
      const { PrismProvider } = await load('@omnitron-dev/prism/core');
      const { DocSidebar } = await load('@omnitron-dev/prism/components/doc-layout');
      const { DocLayout } = await load('@omnitron-dev/lumen-ui/layout');
      const { PortalIslandHost } = await load('@omnitron-dev/lumen-ui/runtime');
      const h = React.createElement;
      for (const index of [0, 50, 51, 63]) {
        const props = { title: 'Manual', activeId: item(index).id, items };
        const nav = id => h(PortalIslandHost, { islandId: id, component: 'DocSidebar', hydrate: 'load', props },
          h(DocSidebar, props));
        pages.set(String(index), renderToStaticMarkup(h(PrismProvider, { mode: 'light' },
          h(DocLayout, { sidebar: h('nav', { 'aria-label': 'Manual' }, nav('desktop')) }, h('h1', null, item(index).label)),
          h('dialog', { 'aria-label': 'Mobile navigation' }, h('nav', null, nav('drawer'))))));
      }
    });
    return html;
  },
  configurePreviewServer(server) {
    server.middlewares.use(async (request, response, next) => {
      const url = new URL(request.url, 'http://fixture');
      if (url.pathname !== '/doc-sidebar.html') return next();
      const html = await readFile(path.join(server.config.build.outDir, 'doc-sidebar.html'), 'utf8');
      response.setHeader('Content-Type', 'text/html');
      response.end(html.replace('SSR_DOC_NAVIGATION', pages.get(url.searchParams.get('page') ?? '0')));
    });
  },
}] });

test.use({ viewport: { width: 1000, height: 600 } });
const rail = page => page.locator('.lumen-doc-sidebar');
const position = page => rail(page).evaluate(el => el.scrollTop);
const activeVisible = page => rail(page).evaluate(owner => {
  const row = owner.querySelector('[aria-current="page"]');
  if (!row) return false;
  const active = row.getBoundingClientRect(), top = owner.getBoundingClientRect().top + owner.clientTop;
  return active.height > 0 && active.top >= Math.max(0, top) &&
    active.bottom <= Math.min(innerHeight, top + owner.clientHeight);
});
const interactive = page => expect(page.locator('html')).toHaveAttribute('data-interactive', 'true');

test('keeps the rail position across a native link, reload and back, and reveals a direct nested document', async ({ page, url }) => {
  await page.goto(url + '?page=50');
  await interactive(page);
  await expect.poll(() => activeVisible(page)).toBe(true);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await rail(page).evaluate(owner => {
    const top = owner.querySelector('[aria-current="page"]').getBoundingClientRect().top - owner.getBoundingClientRect().top;
    owner.scrollTop += top - 100;
  });
  const first = await position(page);
  await rail(page).getByRole('link', { name: 'Topic 51', exact: true }).click();
  await interactive(page);
  await expect.poll(() => position(page)).toBeCloseTo(first, 0);
  await expect.poll(() => activeVisible(page)).toBe(true);
  await rail(page).evaluate(el => { el.scrollTop += 26; });
  const second = await position(page);
  await page.reload();
  await interactive(page);
  await expect.poll(() => position(page)).toBeCloseTo(second, 0);
  await page.goBack();
  await interactive(page);
  await expect.poll(() => position(page)).toBeCloseTo(first, 0);
  await page.goForward();
  await interactive(page);
  await expect.poll(() => position(page)).toBeCloseTo(second, 0);
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test('updates a nested selection inside the desktop rail without scrolling the article or drawer', async ({ page, url }) => {
  await page.goto(url);
  await interactive(page);
  await rail(page).getByRole('button', { name: 'Chapter 6' }).evaluate(el => el.click());
  await expect(rail(page).getByRole('link', { name: 'Topic 50', exact: true })).toHaveCount(0);
  await page.locator('dialog').evaluate(el => el.show());
  const drawer = page.locator('dialog nav');
  await drawer.getByRole('button', { name: 'Chapter 6' }).evaluate(el => el.click());
  await expect(drawer.getByRole('link', { name: 'Topic 50', exact: true })).toHaveCount(0);
  await drawer.evaluate(el => { el.scrollTop = 113; });
  await page.evaluate(() => {
    scrollTo(0, 420);
    document.dispatchEvent(new CustomEvent('select-document', { detail: 'topic-50' }));
  });
  await expect.poll(() => activeVisible(page)).toBe(true);
  expect(await page.evaluate(() => scrollY)).toBe(420);
  expect(await drawer.evaluate(el => el.scrollTop)).toBe(113);
  await expect(drawer.getByRole('link', { name: 'Topic 50', exact: true })).toHaveCount(0);
});

test('reveals the last nested row in the viewport when the responsive rail appears', async ({ page, url }) => {
  await page.setViewportSize({ width: 480, height: 600 });
  await page.goto(url + '?page=63');
  await interactive(page);
  await expect(rail(page)).toBeHidden();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.setViewportSize({ width: 1000, height: 600 });
  await expect(rail(page)).toBeVisible();
  expect(await rail(page).evaluate(el => el.getBoundingClientRect().bottom)).toBeGreaterThan(600);
  await expect.poll(() => activeVisible(page)).toBe(true);
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test('reveals an entire row when its layout falls between scroll pixels', async ({ page, url }) => {
  await page.goto(url);
  await interactive(page);
  const row = rail(page).getByRole('link', { name: 'Topic 50', exact: true });
  await row.evaluate(el => {
    const bottom = el.getBoundingClientRect().bottom;
    el.style.transform = `translateY(${Math.floor(bottom) + 0.25 - bottom}px)`;
    document.dispatchEvent(new CustomEvent('select-document', { detail: 'topic-50' }));
  });
  await expect(row).toHaveAttribute('aria-current', 'page');
  await expect(row).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test('keeps the nearest copy when the same document occurs in two nested groups', async ({ page, url }) => {
  await page.goto(url + '?page=63');
  await interactive(page);
  await expect.poll(() => activeVisible(page)).toBe(true);
  const before = await position(page);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('select-document', { detail: 'shared-topic' })));
  const rows = rail(page).locator('[aria-current="page"]');
  await expect(rows).toHaveCount(2);
  await expect(rows.last()).toBeInViewport({ ratio: 1 });
  await expect(rows.first()).not.toBeInViewport();
  expect(await position(page)).toBeCloseTo(before, 0);
  await rail(page).evaluate(owner => { owner.scrollTop = 700; });
  await page.evaluate(async () => {
    document.dispatchEvent(new Event('refresh-navigation'));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  expect(await position(page)).toBe(700);
});
