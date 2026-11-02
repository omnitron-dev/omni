import { test, expect } from './fixtures.mjs';

async function stubInventory(page, extraReadings = {}, healthStatus = 'online') {
  const readings = {
    'OmnitronProject.listProjects': ['Example', 'Other'].map(displayName => ({
      name: displayName.toLowerCase(), displayName, path: '/' + displayName, totalStacks: 1, runningStacks: 0,
    })),
    'OmnitronProject.listStacks': [{ name: 'dev', status: 'stopped', apps: [] }],
    'OmnitronDaemon.status': { apps: [], uptime: 1000 }, 'OmnitronDaemon.ping': { uptime: 1000 },
    ...extraReadings,
  };
  const capabilities = Object.keys(readings).map(key => {
    const [service, method] = key.split('.');
    return { service, method, allowed: true, roles: ['viewer'], conditional: false };
  });
  await page.route('**/netron/invoke', route => {
    const { id, service, method, input } = route.request().postDataJSON();
    const key = service + '.' + method;
    const reading = readings[key];
    const data = key === 'OmnitronAccess.describe' ? { userId: 'reader', role: 'viewer', capabilities, roles: [] }
      : typeof reading === 'function' ? reading(...input) : reading;
    return route.fulfill({ json: { id, success: data !== undefined, data } });
  });
  await page.route('**/api/health', route => route.fulfill({ json: { status: healthStatus } }));
  // Keep browser fixtures independent of any daemon listening on the developer host.
  await page.routeWebSocket('**/ws', socket => socket.close());
}

test('an administrator can prepare a catalog build on a narrow screen before explicitly applying it', async ({ page, url }) => {
  const commit = '4'.repeat(40);
  let receipt = null;
  let applyCount = 0;
  let prepared;
  await stubInventory(page, {
    'OmnitronNodes.listKernelBuilds': [{ commit, platform: 'linux', arch: 'x64', nodeVersion: '24.13.0' }],
    'OmnitronNodes.getKernelRollout': () => receipt,
    'OmnitronNodes.planKernelRollout': request => {
      prepared = request;
      receipt = { id: request.requestId, commit, state: 'planned', reason: null, updatedAt: '2026-01-01T00:00:05Z',
        targets: [{ nodeId: 'east', name: 'East region', state: 'ready', previous: '2'.repeat(64), candidate: '3'.repeat(64),
          ownerId: 'owner-east', ownerPid: 123, reason: null }] };
      return receipt;
    },
    'OmnitronNodes.startKernelRollout': ({ id }) => {
      expect(id).toBe(receipt.id);
      applyCount++;
      return receipt = { ...receipt, state: 'running' };
    },
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(url + '/workspace.html?view=rollout');
  await page.getByRole('button', { name: 'Plan update…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Plan backend update' });
  const commitField = dialog.getByRole('combobox', { name: 'Target commit' });
  await commitField.press('ArrowDown');
  await page.getByRole('option', { name: /linux\/x64/ }).click();
  await expect(commitField).toHaveValue(commit);
  const stage = dialog.getByRole('checkbox', { name: 'Stage from controller catalog' });
  await expect(stage).not.toBeChecked();
  await stage.check();
  expect(await dialog.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await dialog.getByRole('button', { name: 'Prepare plan' }).click();
  const apply = page.getByRole('button', { name: 'Apply reviewed plan' });
  await expect(apply).toBeVisible();
  expect(prepared).toEqual({ commit, requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), stage: true });
  expect(applyCount).toBe(0);
  await apply.click();
  await expect(page.getByRole('progressbar', { name: 'Nodes confirmed on the target build' })).toBeVisible();
  expect(applyCount).toBe(1);
});

test('managed rollout evidence fits a narrow window for a read-only operator', async ({ page, url }) => {
  const commit = '1'.repeat(40);
  await stubInventory(page, { 'OmnitronNodes.getKernelRollout': {
    id: 'run-' + commit, commit, state: 'failed', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:07Z',
    reason: 'The previous backend resumed.', targets: [{ nodeId: 'east', name: 'East region', state: 'rolled-back',
      previous: '2'.repeat(64), candidate: '3'.repeat(64), ownerId: 'owner-' + commit, ownerPid: 123, reason: 'Readiness deadline expired.' }],
  } });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(url + '/workspace.html?view=rollout');
  const panel = page.getByRole('region', { name: 'Managed backend updates' });
  await expect(panel.getByText('Readiness deadline expired.')).toBeVisible();
  await expect(panel.getByText('rolled-back')).toBeVisible();
  await expect(panel.getByRole('button')).toHaveCount(0);
  expect(await panel.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

for (const direction of ['ltr', 'rtl']) {
  for (const healthStatus of ['online', 'offline']) {
    test('a delayed header tooltip placement cannot widen the ' + healthStatus + ' workspace in ' + direction, async ({ page, url }) => {
      await stubInventory(page, {}, healthStatus);
      await page.setViewportSize({ width: 768, height: 840 });
      await page.goto(url + '/workspace.html?dir=' + direction);
      await page.getByRole('button', { name: 'Switch workspace: Omnitron' }).click();
      await page.getByRole('menuitem', { name: /Example/ }).click();
      const stack = page.getByRole('combobox', { name: 'Stack filter' });
      if (healthStatus === 'offline') await expect(page.getByRole('alert').filter({ hasText: 'Daemon offline' })).toBeVisible();
      await stack.hover();
      const tooltip = page.getByRole('tooltip', { name: /Filter workspace views/ });
      await expect(tooltip).toBeVisible();
      const previous = await tooltip.boundingBox();
      const portal = await tooltip.elementHandle();
      await page.setViewportSize({ width: 320, height: 840 });
      // Popper's resize update and pointer-leave can race the browser's new layout.
      // Retain the preceding measured placement for one painted frame, rather than
      // relying on host speed to catch the absolute portal widening the document.
      const measured = await portal.evaluate(async (element, { previous, direction }) => {
        const attached = element.isConnected;
        const style = element.style.cssText;
        if (!attached) document.body.append(element);
        const x = direction === 'ltr' ? previous.x : previous.x - (768 - 320);
        await new Promise(requestAnimationFrame);
        Object.assign(element.style, { left: '0px', right: 'auto', width: previous.width + 'px', transform: `translate(${x}px, 64px)` });
        const result = { width: document.documentElement.scrollWidth, scroll: window.scrollX };
        await new Promise(requestAnimationFrame);
        element.style.cssText = style;
        if (!attached) element.remove();
        window.dispatchEvent(new Event('resize'));
        return result;
      }, { previous, direction });
      expect(measured).toEqual({ width: 320, scroll: 0 });
      await stack.hover();
      await expect(tooltip).toBeVisible();
      await expect.poll(async () => {
        const box = await tooltip.boundingBox();
        return box.x >= 0 && box.x + box.width <= 320;
      }).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    });
  }
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
