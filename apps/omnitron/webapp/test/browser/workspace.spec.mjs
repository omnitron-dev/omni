import { test, expect } from './fixtures.mjs';

async function stubInventory(page) {
  const readings = {
    'OmnitronProject.listProjects': ['Example', 'Other'].map(displayName => ({
      name: displayName.toLowerCase(), displayName, path: '/' + displayName, totalStacks: 1, runningStacks: 0,
    })),
    'OmnitronProject.listStacks': [{ name: 'dev', status: 'stopped', apps: [] }],
    'OmnitronDaemon.status': { apps: [], uptime: 1000 }, 'OmnitronDaemon.ping': { uptime: 1000 },
  };
  const capabilities = Object.keys(readings).map(key => {
    const [service, method] = key.split('.');
    return { service, method, allowed: true, roles: ['viewer'], conditional: false };
  });
  await page.route('**/netron/invoke', route => {
    const { id, service, method } = route.request().postDataJSON();
    const key = service + '.' + method;
    const data = key === 'OmnitronAccess.describe' ? { userId: 'reader', role: 'viewer', capabilities, roles: [] } : readings[key];
    return route.fulfill({ json: { id, success: data !== undefined, data } });
  });
  await page.route('**/api/health', route => route.fulfill({ json: { status: 'ok' } }));
}

for (const direction of ['ltr', 'rtl']) {
  test('workspace gutters and stack selector follow the reading direction in ' + direction, async ({ page, url }) => {
    await stubInventory(page);
    await page.setViewportSize({ width: 1440, height: 840 });
    await page.goto(url + '/workspace.html?dir=' + direction);
    await page.getByRole('button', { name: 'Switch workspace: Omnitron' }).click();
    await page.getByRole('menuitem', { name: /Example/ }).click();
    const workspace = page.getByRole('button', { name: 'Switch workspace: Example' });
    const stack = page.getByRole('combobox', { name: 'Stack filter' });
    const content = page.getByTestId('content');
    await expect(stack).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', direction);
    const start = box => direction === 'ltr' ? box.x : box.x + box.width;
    const side = direction === 'ltr' ? 1 : -1;
    for (const collapsed of [false, true]) {
      if (collapsed) await page.getByRole('button', { name: 'Collapse sidebar' }).click();
      const nav = page.getByRole('navigation', { name: 'Main navigation' });
      await expect.poll(async () => (await nav.boundingBox()).width).toBe(collapsed ? 73 : 280);
      const rail = await nav.boundingBox();
      const railEnd = start(rail) + side * rail.width;
      await expect.poll(async () => Math.round(side * (start(await workspace.boundingBox()) - railEnd))).toBe(24);
      expect(Math.abs(start(await content.boundingBox()) - start(await workspace.boundingBox()))).toBeLessThanOrEqual(1);
      expect(start(rail)).toBe(direction === 'ltr' ? 0 : 1440);
      const legend = stack.locator('..').locator('legend');
      expect(await legend.evaluate(el => el.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
    }
    for (const [width, expected] of [[768, 16], [320, 8]]) {
      await page.setViewportSize({ width, height: 840 });
      const menu = page.getByRole('button', { name: 'Open menu' });
      await expect(menu).toBeVisible();
      const edge = direction === 'ltr' ? 0 : width;
      await expect.poll(async () => Math.round(side * (start(await menu.boundingBox()) - edge))).toBe(expected);
      expect(Math.round(side * (start(await content.boundingBox()) - edge))).toBe(expected);
      const last = await page.getByRole('button', { name: 'Sign out' }).boundingBox();
      expect(Math.round(direction === 'ltr' ? width - last.x - last.width : last.x)).toBe(expected);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    }
  });
}
