import { expect } from '@playwright/test';
import { createBrowserTest, withBrowserModules } from './browser-fixture.js';

async function renderProbe(providerProps = { modeStorageKey: 'prism-test-theme' }) {
  return withBrowserModules(async load => {
    const [React, { renderToString }, { PrismProvider, PrismThemeScript }, { Button }, { omnitronTheme }, { extractCriticalEmotionCss }] = await Promise.all([
      load('react'), load('react-dom/server'), load('@omnitron-dev/prism/core'), load('@omnitron-dev/prism/ui'), load('@omnitron-dev/prism/identity'),
      import('../../../lumen/src/ssg/emotion-extractor.ts'),
    ]);
    const markup = renderToString(React.createElement(PrismProvider, { ...providerProps, themeOverrides: omnitronTheme },
      providerProps.modeStorageKey && React.createElement(PrismThemeScript, { modeStorageKey: providerProps.modeStorageKey }),
      React.createElement(Button, { 'data-probe': 'palette', variant: 'contained' }, 'Read the docs ', 0),
      React.createElement(Button, { 'data-probe': 'mode' }, 'Dark'),
      React.createElement(Button, { 'data-probe': 'system' }, 'System')));
    return { markup, extract: extractCriticalEmotionCss };
  });
}

const test = createBrowserTest('theme.html', {
  source: true,
  contentSecurityPolicy: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
  plugins: [{
    name: 'native-theme-ssr',
    async transformIndexHtml(html) {
      const { markup, extract } = await renderProbe();
      return extract(html.replace('<!--theme-ssr-->', markup)).html;
    },
  }],
});

for (const system of ['light', 'dark']) for (const saved of [null, 'light', 'dark']) {
  test(`first palette remains stable through hydration and reload: system ${system}, saved ${saved}`, async ({ page, url }) => {
    const expected = saved ?? system;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.emulateMedia({ colorScheme: system, reducedMotion: 'reduce' });
    await page.addInitScript(value => {
      if (value !== null) localStorage.setItem('prism-test-theme', value);
      window.themeFrames = [];
      window.themeSnapshot = () => {
        const button = document.querySelector('[data-probe="palette"]');
        if (!button) return null;
        const style = getComputedStyle(button);
        return { background: style.backgroundColor, color: style.color, border: style.borderRadius, height: button.getBoundingClientRect().height };
      };
      const frame = () => {
        const snapshot = window.themeSnapshot();
        if (snapshot) window.themeFrames.push(snapshot);
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }, saved);
    for (let pass = 0; pass < 2; pass++) {
      if (pass) await page.reload(); else await page.goto(url);
      await page.waitForFunction(() => typeof window.hydrateThemeProbe === 'function');
      const before = await page.evaluate(() => window.themeSnapshot());
      expect(before.background).toBe(expected === 'light' ? 'rgb(0, 109, 117)' : 'rgb(113, 221, 227)');
      expect(before.color).toBe(expected === 'light' ? 'rgb(255, 255, 255)' : 'rgb(11, 37, 40)');
      await page.evaluate(() => { window.originalProbe = document.querySelector('[data-probe="palette"]'); window.hydrateThemeProbe(); });
      await page.waitForFunction(() => document.body.dataset.themeReady === 'true');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      expect(await page.evaluate(() => window.originalProbe.isConnected)).toBe(true);
      const frames = await page.evaluate(() => window.themeFrames);
      expect(frames.length).toBeGreaterThan(1);
      for (const snapshot of frames) expect(snapshot).toEqual(before);
      await page.locator('[data-probe="palette"]').click();
      await expect(page.locator('[data-probe="palette"]')).toHaveText('Read the docs 1');
    }
    expect(errors).toEqual([]);
  });
}

test('native persistence and operating-system changes share the same provider', async ({ page, url }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(url);
  await page.evaluate(() => window.hydrateThemeProbe());
  await page.locator('[data-probe="mode"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-prism-color-scheme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('prism-test-theme'))).toBe('dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-prism-color-scheme', 'dark');
  await page.evaluate(() => window.hydrateThemeProbe());
  await page.locator('[data-probe="system"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-prism-color-scheme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-prism-color-scheme', 'dark');
});

for (const mode of ['light', 'dark']) test(`system preference is correct without JavaScript in ${mode}`, async ({ browser, url }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: mode });
  try {
    const page = await context.newPage();
    await page.goto(url);
    const style = await page.locator('[data-probe="palette"]').evaluate(element => ({
      background: getComputedStyle(element).backgroundColor,
      body: getComputedStyle(document.body).backgroundColor,
      identity: getComputedStyle(document.documentElement).getPropertyValue('--omni-bg').trim(),
    }));
    expect(style.background).toBe(mode === 'light' ? 'rgb(0, 109, 117)' : 'rgb(113, 221, 227)');
    expect(style.body).toBe(mode === 'light' ? 'rgb(243, 246, 247)' : 'rgb(11, 15, 18)');
    expect(style.identity).toBe(mode === 'light' ? '#F3F6F7' : '#0B0F12');
  } finally { await context.close(); }
});

test('blocked storage retains the system palette before and after hydration', async ({ page, url }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage unavailable', 'SecurityError'); } }));
  await page.goto(url);
  const style = () => page.locator('[data-probe="palette"]').evaluate(element => getComputedStyle(element).backgroundColor);
  expect(await style()).toBe('rgb(113, 221, 227)');
  await page.evaluate(() => window.hydrateThemeProbe());
  await page.waitForFunction(() => document.body.dataset.themeReady === 'true');
  expect(await style()).toBe('rgb(113, 221, 227)');
});

for (const mode of ['light', 'dark']) test(`forced ${mode} remains authoritative without JavaScript`, async ({ browser }) => {
  const { markup, extract } = await renderProbe({ mode });
  const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: mode === 'light' ? 'dark' : 'light' });
  try {
    const page = await context.newPage();
    await page.setContent(extract(`<!doctype html><html><head></head><body>${markup}</body></html>`).html);
    const style = await page.locator('[data-probe="palette"]').evaluate(element => ({
      background: getComputedStyle(element).backgroundColor,
      identity: getComputedStyle(document.documentElement).getPropertyValue('--omni-bg').trim(),
    }));
    expect(style.background).toBe(mode === 'light' ? 'rgb(0, 109, 117)' : 'rgb(113, 221, 227)');
    expect(style.identity).toBe(mode === 'light' ? '#F3F6F7' : '#0B0F12');
  } finally { await context.close(); }
});

test('custom attribute and prefix use the same safe bootstrap and CSS selectors', async ({ page, url }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(url);
  await page.evaluate(() => localStorage.setItem('custom-mode', 'light'));
  const { markup, extract } = await renderProbe({ modeStorageKey: 'custom-mode', config: { theme: { cssVariables: { prefix: 'custom', colorSchemeSelector: 'data-preference' } } } });
  await page.setContent(extract(`<!doctype html><html><head></head><body>${markup}</body></html>`).html);
  await expect(page.locator('html')).toHaveAttribute('data-preference', 'light');
  const snapshot = await page.locator('[data-probe="palette"]').evaluate(element => ({
    background: getComputedStyle(element).backgroundColor,
    custom: getComputedStyle(document.documentElement).getPropertyValue('--custom-palette-primary-main').trim(),
  }));
  expect(snapshot).toEqual({ background: 'rgb(0, 109, 117)', custom: '#006D75' });
});

test('native media selectors apply identity tokens with JavaScript disabled', async ({ browser }) => {
  const { markup, extract } = await renderProbe({ mode: 'system', config: { theme: { cssVariables: { colorSchemeSelector: 'media' } } } });
  for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ javaScriptEnabled: false, colorScheme });
    try {
      const page = await context.newPage();
      await page.setContent(extract(`<!doctype html><html><head></head><body>${markup}</body></html>`).html);
      const style = await page.locator('[data-probe="palette"]').evaluate(element => ({
        background: getComputedStyle(element).backgroundColor,
        identity: getComputedStyle(document.documentElement).getPropertyValue('--omni-bg').trim(),
      }));
      expect(style.background).toBe(colorScheme === 'light' ? 'rgb(0, 109, 117)' : 'rgb(113, 221, 227)');
      expect(style.identity).toBe(colorScheme === 'light' ? '#F3F6F7' : '#0B0F12');
    } finally { await context.close(); }
  }
});
