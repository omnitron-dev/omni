import { expect, test } from '@playwright/test';

for (const width of [320, 393, 768, 1440]) {
  for (const variant of ['', 'context', 'search', 'containerized&context']) {
    test(`keeps header slots within ${width}px (${variant || 'actions'})`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/test/header-layout?${variant}`);
      const header = page.locator('header');
      await expect(header.getByRole('button')).toHaveCount(6);
      await page.screenshot({ path: info.outputPath('header.png'), fullPage: false });
      for (const control of await header.getByRole('button').all()) {
        await expect(control).toBeInViewport({ ratio: 0.99 });
      }
      const geometry = await header.getByRole('button').evaluateAll((nodes) =>
        nodes.map((node) => {
          const { left, right, top, bottom } = node.getBoundingClientRect();
          return { name: node.getAttribute('aria-label'), left, right, top, bottom };
        })
      );
      for (let a = 0; a < geometry.length; a++)
        for (let b = a + 1; b < geometry.length; b++) {
          const overlapX =
            Math.min(geometry[a].right, geometry[b].right) - Math.max(geometry[a].left, geometry[b].left);
          const overlapY =
            Math.min(geometry[a].bottom, geometry[b].bottom) - Math.max(geometry[a].top, geometry[b].top);
          expect(overlapX > 1 && overlapY > 1, `${geometry[a].name} overlaps ${geometry[b].name}`).toBe(false);
        }
      const bounds = await page.evaluate(() => ({
        viewport: innerWidth,
        content: document.documentElement.scrollWidth,
      }));
      expect(bounds.content).toBeLessThanOrEqual(bounds.viewport);
      const headerBox = await header.boundingBox();
      const contentBox = await page.getByRole('main').boundingBox();
      expect(contentBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height);
      expect(headerBox!.height).toBeGreaterThanOrEqual(width >= 900 ? 72 : 64);
      if (variant === 'search')
        expect((await page.getByPlaceholder('Search the workspace').boundingBox())!.width).toBeGreaterThan(120);
      await page.evaluate(() => scrollTo(0, 300));
      await expect.poll(async () => (await header.boundingBox())!.y).toBe(0);
      await expect(header.getByRole('button', { name: 'Account', exact: true })).toBeInViewport({ ratio: 0.99 });
    });
  }
}
