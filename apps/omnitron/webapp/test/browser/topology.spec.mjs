import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { build, preview } from 'vite';

const root = import.meta.dirname;
const configFile = path.resolve(root, '../../vite.config.ts');
let output;
let server;
let url;

test.use({ channel: process.env.PLAYWRIGHT_CHANNEL, reducedMotion: 'reduce' });
test.beforeAll(async () => {
  test.setTimeout(90_000);
  output = await mkdtemp(path.join(os.tmpdir(), 'omnitron-console-browser-'));
  const config = { root, configFile, logLevel: 'error', build: { outDir: output } };
  await build(config);
  server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
  url = `http://127.0.0.1:${server.httpServer.address().port}`;
});
test.afterAll(async () => {
  await server?.close();
  if (output) await rm(output, { recursive: true, force: true });
});

async function smallestInset(minimap) {
  return minimap.evaluate((element) => {
    const frame = element.getBoundingClientRect();
    const svg = element.querySelector('svg').getBoundingClientRect();
    return Math.min(svg.left - frame.left, svg.top - frame.top, frame.right - svg.right, frame.bottom - svg.bottom);
  });
}

for (const width of [320, 768, 1440]) {
  test(`topology routes, positioning and overview at ${width}px`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 840 });
    await page.goto(url);
    const paths = page.locator('.react-flow__edge-path');
    await expect(paths).toHaveCount(12);
    const mini = page.locator('.react-flow__minimap');
    if (width === 320) await expect(mini).toHaveCount(0);
    else await expect.poll(() => smallestInset(mini)).toBeGreaterThanOrEqual(4);

    const app = page.locator('.react-flow__node[data-id="api"]');
    const x = () => app.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).m41);
    const before = await x();
    await app.focus();
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(x).toBe(before + 64);
    await page.reload();
    await expect(paths).toHaveCount(12);
    await expect.poll(x).toBe(before + 64);

    if (width === 1440) {
      await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
      const box = await app.boundingBox();
      const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await page.mouse.move(center.x, center.y);
      await page.mouse.down();
      await page.mouse.move(center.x - 30, center.y + 15, { steps: 8 });
      await page.mouse.up();
      await expect.poll(x).not.toBe(before + 64);
      const dragged = await x();
      await page.reload();
      await expect(paths).toHaveCount(12);
      await expect.poll(x).toBe(dragged);
    }

    await app.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('tab', { name: 'Connections' }).click();
    await expect(page.getByText('Configuration and ownership evidence', { exact: false })).toBeVisible();
    if (width === 1440) await expect.poll(() => smallestInset(mini)).toBeGreaterThanOrEqual(4);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}
