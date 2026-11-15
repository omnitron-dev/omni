import { expect } from '@playwright/test';
import { createBrowserTest, importConsumer } from './browser-fixture.js';

const test = createBrowserTest('emotion.html', {
  source: true,
  plugins: [
    {
      name: 'ssr-emotion-probe',
      async transformIndexHtml(html) {
        const [
          { default: React },
          { renderToString },
          { default: createCache },
          { default: createServer },
          emotion,
          lumen,
        ] = await Promise.all([
          importConsumer('react'),
          importConsumer('react-dom/server'),
          importConsumer('@emotion/cache'),
          importConsumer('@emotion/server/create-instance'),
          importConsumer('@emotion/react'),
          process.env.LUMEN_CONSUMER_ROOT
            ? importConsumer('@omnitron-dev/lumen', new URL('../../../lumen/package.json', import.meta.url))
            : import('../../../lumen/src/ssg/emotion-extractor.ts'),
        ]);
        const caches = ['css', 'site'].map((key) => createCache({ key }));
        let body = '';
        for (const cache of caches) {
          const server = createServer(cache);
          const markup = renderToString(
            React.createElement(
              emotion.CacheProvider,
              { value: cache },
              React.createElement(emotion.Global, {
                styles: {
                  [`[data-probe="${cache.key}"]`]: { '--probe-padding': '17px', border: '3px solid rgb(10, 20, 30)' },
                },
              }),
              React.createElement(emotion.ClassNames, {
                children: ({ css }) =>
                  React.createElement(
                    'button',
                    {
                      'data-probe': cache.key,
                      className: css({
                        color: 'rgb(30, 40, 50)',
                        backgroundColor: 'rgb(230, 240, 250)',
                        padding: 'var(--probe-padding)',
                        width: 180,
                        height: 64,
                      }),
                    },
                    cache.key,
                    ' ',
                    0
                  ),
              })
            )
          );
          body +=
            server.constructStyleTagsFromChunks(server.extractCriticalToChunks(markup)) +
            `<div id="root-${cache.key}">${markup}</div>`;
        }
        return lumen.extractCriticalEmotionCss(html.replace('<!--emotion-ssr-->', body), caches[0]).html;
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
      ['css', 'site'].map((key) => ({
        key,
        color: 'rgb(30, 40, 50)',
        background: 'rgb(230, 240, 250)',
        padding: '17px',
        border: '3px',
        width: 180,
        height: 64,
      }))
    );
    await expect(page.locator('style[data-emotion]')).toHaveCount(4);
    await page.evaluate(() => window.hydrateEmotionProbe());
    await page.waitForFunction(
      () => document.body.dataset.hydratedcss === 'true' && document.body.dataset.hydratedsite === 'true'
    );
    await page.locator('[data-probe="site"]').click();
    await expect(page.locator('[data-probe="site"]')).toHaveText('site 1');
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const frames = await page.evaluate(() => window.emotionFrames);
    expect(frames.length).toBeGreaterThan(1);
    for (const snapshot of frames) expect(snapshot).toEqual(expected);
    await expect(page.locator('style[data-emotion]')).toHaveCount(4);
    await expect(page.locator('style[data-emotion="css-global"]')).toHaveCount(1);
    await expect(page.locator('style[data-emotion="site-global"]')).toHaveCount(1);
    expect(await page.evaluate(() => window.serverProbes.every((element) => element.isConnected))).toBe(true);
  }
  expect(errors).toEqual([]);
});
