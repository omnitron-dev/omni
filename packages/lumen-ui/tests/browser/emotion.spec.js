import { expect } from '@playwright/test';
import { createBrowserTest, withBrowserModules } from './browser-fixture.js';

const test = createBrowserTest('emotion.html', {
  source: true,
  plugins: [
    {
      name: 'ssr-emotion-probe',
      async transformIndexHtml(html) {
        return withBrowserModules(async (load, loadFixture) => {
          const [
            { default: React },
            { renderToString },
            { default: createCache },
            { default: createServer },
            lumen,
            { Probe, InlineProbe },
          ] = await Promise.all([
            load('react'), load('react-dom/server'), load('@emotion/cache'),
            load('@emotion/server/create-instance'), load('@omnitron-dev/lumen'), loadFixture(),
          ]);
          const caches = ['css', 'site'].map((key) => createCache({ key }));
          let body = '';
          for (const cache of caches) {
            const server = createServer(cache);
            const markup = renderToString(React.createElement(Probe, { cache }));
            body += server.constructStyleTagsFromChunks(server.extractCriticalToChunks(markup)) +
              `<div id="root-${cache.key}">${markup}</div>`;
          }
          const native = renderToString(React.createElement(InlineProbe, { cache: createCache({ key: 'native' }) }));
          body += `<div id="root-native">${native}</div>`;
          return lumen.extractCriticalEmotionCss(html.replace('<!--emotion-ssr-->', body), caches[0]).html;
        }, new URL('./emotion.tsx', import.meta.url));
      },
    },
  ],
});

test('SSR Global and custom cache styles survive native hydration and reload without visual changes', async ({
  page,
  url,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    window.emotionFrames = [];
    window.emotionSnapshot = () =>
      Array.from(document.querySelectorAll('[data-probe]'), (element) => {
        const style = getComputedStyle(element),
          rect = element.getBoundingClientRect();
        return {
          key: element.getAttribute('data-probe'),
          color: style.color,
          background: style.backgroundColor,
          padding: style.paddingLeft,
          border: style.borderLeftWidth,
          width: rect.width,
          height: rect.height,
        };
      });
    const frame = () => {
      const snapshot = window.emotionSnapshot();
      if (snapshot.length) window.emotionFrames.push(snapshot);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  for (let pass = 0; pass < 2; pass++) {
    if (pass) await page.reload();
    else await page.goto(url);
    await page.waitForFunction(() => typeof window.hydrateEmotionProbe === 'function');
    await page.evaluate(() => {
      window.serverProbes = Array.from(document.querySelectorAll('[data-probe]'));
    });
    const expected = await page.evaluate(() => window.emotionSnapshot());
    expect(expected).toEqual(
      ['css', 'site', 'native-one', 'native-two'].map((key) => ({
        key,
        color: key.startsWith('native-') ? 'rgb(210, 30, 40)' : 'rgb(30, 40, 50)',
        background: 'rgb(230, 240, 250)',
        padding: '17px',
        border: '3px',
        width: 180,
        height: 64,
      }))
    );
    await expect(page.locator('style[data-emotion]')).toHaveCount(9);
    await page.evaluate(() => window.hydrateEmotionProbe());
    await page.waitForFunction(
      () => document.body.dataset.hydratedcss === 'true' && document.body.dataset.hydratedsite === 'true' && document.body.dataset.hydratednative === 'true'
    );
    await page.locator('[data-probe="site"]').click();
    await expect(page.locator('[data-probe="site"]')).toHaveText('site 1');
    await page.locator('[data-probe="native-two"]').click();
    await expect(page.locator('[data-probe="native-two"]')).toHaveText('Second 1');
    await expect(page.locator('[data-probe="native-two"]')).toHaveCSS('font-style', 'italic');
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const frames = await page.evaluate(() => window.emotionFrames);
    expect(frames.length).toBeGreaterThan(1);
    for (const snapshot of frames) expect(snapshot).toEqual(expected);
    await expect(page.locator('style[data-emotion]')).toHaveCount(9);
    await expect(page.locator('style[data-emotion="css-global"]')).toHaveCount(1);
    await expect(page.locator('style[data-emotion="site-global"]')).toHaveCount(1);
    await expect(page.locator('style[data-emotion="native-global"]')).toHaveCount(3);
    expect(await page.evaluate(() => window.serverProbes.every((element) => element.isConnected))).toBe(true);
  }
  expect(errors).toEqual([]);
});
