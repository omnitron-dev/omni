import { expect } from '@playwright/test';
import { createBrowserTest } from './browser-fixture.js';

const test = createBrowserTest('source.html', { plugins: [{
  name: 'source-client-boundary',
  generateBundle(_options, bundle) {
    const modules = Object.values(bundle).filter(item => item.type === 'chunk').flatMap(chunk => Object.keys(chunk.modules));
    if (modules.some(id => /[/\\]typescript[/\\]lib[/\\]|[/\\]typescript-libraries\.[jt]s|[/\\]highlight[/\\]twoslash\.[jt]s/.test(id))) {
      throw new Error('Client source highlighting pulled the TypeScript compiler or Twoslash into the bundle');
    }
  },
}] });

for (const width of [320, 1440]) {
  test(`source remains literal, themed and keyboard usable with stable copy controls at ${width}px`, async ({ page, url }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(() => {
      window.copied = [];
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async text => {
          if (window.denyCopy) throw new Error('Clipboard denied');
          window.copied.push(text);
        },
      } });
    });
    const failures = []; const fetched = [];
    page.on('pageerror', error => failures.push(error.message));
    page.on('request', request => fetched.push(request.url()));
    await page.goto(url);
    const figure = page.getByRole('figure', { name: 'Request counter' });
    const summary = figure.locator('summary');
    await expect(figure.getByRole('button', { name: 'Reset example' })).toBeVisible();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(figure.locator('pre')).toHaveAttribute('data-highlight', 'idle');
    expect(fetched.some(value => /\/(?:tokenizer|tsx)[.-]/.test(value))).toBe(false);
    await summary.focus(); await page.keyboard.press('Enter');
    const pre = figure.locator('pre');
    await expect(pre).toHaveAttribute('data-highlight', 'ready');
    const code = pre.locator('code');
    const original = await code.textContent();
    expect(original).toContain('// [!code highlight]\r\n');
    expect(original).toContain('// @errors: 1234\r\n// ^?\r\n');
    expect(await code.locator('span[style]').count()).toBeGreaterThan(5);
    const colors = () => code.locator('span[style]').evaluateAll(tokens => [...new Set(tokens.map(token => getComputedStyle(token).color))]);
    const lightColors = await colors(); expect(lightColors.length).toBeGreaterThan(2);
    await figure.screenshot({ path: testInfo.outputPath('example-light.png') });
    await page.getByRole('button', { name: 'Change theme' }).click();
    await expect.poll(colors).not.toEqual(lightColors);
    expect(await code.textContent()).toBe(original);
    await figure.screenshot({ path: testInfo.outputPath('example-dark.png') });

    const copy = figure.getByRole('button', { name: 'Copy code', exact: true });
    const geometry = await copy.boundingBox(); const frame = await figure.boundingBox();
    const codeViewport = await pre.boundingBox();
    expect(geometry.y + geometry.height).toBeLessThanOrEqual(codeViewport.y);
    await copy.focus(); await page.keyboard.press('Enter');
    await expect(figure.getByRole('status')).toHaveText('Code copied');
    await expect.poll(() => page.evaluate(() => window.copied)).toEqual([original]);
    expect(await copy.boundingBox()).toEqual(geometry);
    expect(await figure.boundingBox()).toEqual(frame);
    await expect(copy).toBeFocused();
    await copy.hover(); await expect(page.getByRole('tooltip')).toHaveText('Code copied');
    await page.screenshot({ path: testInfo.outputPath('copy-success.png') });
    await page.evaluate(() => { window.denyCopy = true; });
    await copy.press('Space');
    await expect(figure.getByRole('status')).toContainText('Copy failed');
    await expect(page.getByRole('tooltip')).toContainText('Copy failed');
    expect(await copy.boundingBox()).toEqual(geometry);
    expect(await figure.boundingBox()).toEqual(frame);
    await pre.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    expect(await copy.boundingBox()).toEqual(geometry);
    await page.screenshot({ path: testInfo.outputPath('copy-failure.png') });
    const layout = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll('body,#root,figure,details,.lumen-code-frame,pre,[role=tooltip],[data-popper-placement]')].map(el => {
        const rect = el.getBoundingClientRect(); return { name: el.tagName, role: el.getAttribute('role'), class: el.className, x: rect.x, width: rect.width, right: rect.right };
      }),
    }));
    expect(layout.width, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport);

    await figure.getByRole('button', { name: 'Count 0' }).click();
    await expect(figure.getByRole('button', { name: 'Count 1' })).toBeVisible();
    await figure.getByRole('button', { name: 'Reset example' }).click();
    await expect(figure.getByRole('button', { name: 'Count 0' })).toBeVisible();
    await expect(code).toBeVisible();
    expect(await code.textContent()).toBe(original);
    expect(fetched.some(value => /\/(?:python|rust|json)[.-]/.test(value))).toBe(false);
    await page.getByRole('button', { name: 'Toggle JSON' }).click();
    await expect(page.locator('pre.language-json')).toHaveAttribute('data-highlight', 'ready');
    expect(fetched.some(value => /\/json[.-]/.test(value))).toBe(true);
    expect(failures).toEqual([]);
  });
}


test('a failed highlighting chunk leaves visible, selectable source and an honest status', async ({ page, url }) => {
  await page.route('**/tokenizer*.js', route => route.abort());
  await page.goto(url);
  const figure = page.getByRole('figure', { name: 'Request counter' });
  await figure.locator('summary').click();
  const pre = figure.locator('pre');
  await expect(pre).toHaveAttribute('data-highlight', 'error');
  await expect(figure.getByRole('status').filter({ hasText: 'Syntax highlighting' })).toBeVisible();
  await expect(pre.locator('code')).toContainText('const greeting = "Привет 🌐";');
  await pre.focus(); await expect(pre).toBeFocused();
});

test('a preview render failure keeps source and reset usable', async ({ page, url }) => {
  await page.goto(url);
  const figure = page.getByRole('figure', { name: 'Request counter' });
  await figure.getByRole('button', { name: 'Fail example' }).click();
  await expect(figure.getByRole('alert')).toHaveText('Example request failed');
  const summary = figure.locator('summary');
  await summary.focus(); await page.keyboard.press('Enter');
  await expect(figure.locator('pre')).toHaveAttribute('data-highlight', 'ready');
  const original = await figure.locator('pre code').textContent();
  await expect(figure.getByRole('button', { name: 'Copy code', exact: true })).toBeVisible();
  await figure.getByRole('button', { name: 'Reset example' }).press('Enter');
  await expect(figure.getByRole('alert')).toHaveCount(0);
  await expect(figure.getByRole('button', { name: 'Count 0' })).toBeVisible();
  await expect(figure.locator('pre')).toBeVisible();
  expect(await figure.locator('pre code').textContent()).toBe(original);
});
