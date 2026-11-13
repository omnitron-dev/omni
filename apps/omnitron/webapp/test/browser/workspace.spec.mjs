import { test, expect, stubInventory } from './fixtures.mjs';

test('a project stack selection filters inventory, follows details and survives history and reload', async ({ page, url }) => {
  const stacks = ['dev', 'test'].map(name => ({
    name, type: name === 'dev' ? 'local' : 'remote', status: 'running', uptime: 60_000,
    config: { type: name === 'dev' ? 'local' : 'remote' }, nodes: [], apps: [],
  }));
  await stubInventory(page, {
    'OmnitronProject.listProjects': [
      { name: 'sample', displayName: 'Sample', path: '/sample', totalStacks: 2, runningStacks: 2 },
      { name: 'example', displayName: 'Example', path: '/example', totalStacks: 0, runningStacks: 0 },
    ],
    'OmnitronProject.listStacks': ({ project }) => project === 'sample' ? stacks : [],
    'OmnitronAudit.list': [],
  });
  await page.addInitScript(() => {
    if (!localStorage.getItem('omnitron_active_project')) localStorage.setItem('omnitron_active_project', 'sample');
  });
  await page.route(/\/stacks(?:\/[^/?]+)?(?:\?.*)?$/, async route => {
    if (route.request().resourceType() !== 'document') return route.continue();
    await route.fulfill({ response: await route.fetch({ url: url + '/workspace.html' }) });
  });
  await page.route(/\/audit$/, async route => {
    if (route.request().resourceType() !== 'document') return route.continue();
    await route.fulfill({ response: await route.fetch({ url: url + '/workspace.html' }) });
  });
  await page.goto(url + '/stacks');
  const filter = page.getByRole('combobox', { name: 'Stack filter' });
  const card = name => page.getByRole('heading', { name, exact: true });
  const choose = async name => {
    await filter.click();
    await page.getByRole('option', { name: name === 'All stacks' ? name : new RegExp('^' + name + '\\s+running') }).click();
  };
  await expect(card('dev')).toBeVisible();
  await expect(card('test')).toBeVisible();
  await choose('dev');
  await expect(card('test')).toHaveCount(0);
  await choose('test');
  await expect(card('dev')).toHaveCount(0);
  await expect(card('test')).toBeVisible();
  await page.goBack();
  await expect(filter).toHaveText('Stack: dev');
  await expect(card('test')).toHaveCount(0);
  await page.goForward();
  await page.reload();
  await expect(filter).toHaveText('Stack: test');
  await expect(card('dev')).toHaveCount(0);
  const detailLink = page.getByRole('link', { name: 'test', exact: true });
  await detailLink.focus();
  await detailLink.press('Enter');
  await expect(page).toHaveURL(url + '/stacks/test');
  await choose('dev');
  await expect(page).toHaveURL(url + '/stacks/dev');
  await expect(page.getByRole('button', { name: 'Refresh stack' })).toBeVisible();
  await choose('All stacks');
  await expect(page).toHaveURL(url + '/stacks');
  await expect(card('test')).toBeVisible();
  await expect(card('dev')).toBeVisible();
  await page.getByRole('link', { name: 'Audit', exact: true }).click();
  await expect(filter).toHaveCount(0);
  await page.goBack();
  await choose('dev');
  await page.getByRole('button', { name: 'Switch workspace: Sample' }).click();
  await page.getByRole('menuitem', { name: /Example/ }).click();
  await expect(page.getByRole('button', { name: 'Switch workspace: Example' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Switch workspace: Sample' })).toBeVisible();
  await expect(filter).toHaveText('Stack: dev');
});

test('log filters use the selected stack inventory, including remote apps that have never logged', async ({ page, url }) => {
  const filters = [];
  let daemonLists = 0;
  await stubInventory(page, {
    'OmnitronProject.listProjects': [{ name: 'sample', displayName: 'Sample', path: '/sample', totalStacks: 3, runningStacks: 3 }],
    'OmnitronProject.listStacks': ['dev', 'test', 'prod'].map(name => ({
      name, type: name === 'dev' ? 'local' : 'remote', status: 'running', nodes: [{ host: name, port: 9700 }],
      apps: [{ name: name + '-api', handleKey: 'sample/' + name + '/' + name + '-api', status: 'online' },
        ...(name === 'dev' ? [] : [{ name: 'mail', handleKey: 'sample/deployed/mail', status: 'online' }])],
    })),
    'OmnitronNodes.listNodes': ['test', 'prod'].map(name => ({ id: name + '-id', name, host: name, daemonPort: 9700, isLocal: false })),
    'OmnitronDaemon.list': () => { daemonLists++; return []; },
    'OmnitronLogs.getLogStats': { byApp: [{ app: 'omnitron' }, { app: 'other/dev/foreign' }] },
    'OmnitronLogs.queryLogs': filter => { filters.push(filter); return { entries: [], total: 0, hasMore: false, byLevel: [] }; },
    'OmnitronLogs.streamLogs': filter => { filters.push(filter); return []; },
  });
  await page.addInitScript(() => {
    localStorage.setItem('omnitron_active_project', 'sample');
    localStorage.setItem('omnitron_active_stack', 'test');
  });
  await page.route(/\/logs$/, async route => {
    if (route.request().resourceType() !== 'document') return route.continue();
    await route.fulfill({ response: await route.fetch({ url: url + '/workspace.html' }) });
  });
  await page.goto(url + '/logs');
  const picker = page.getByRole('combobox', { name: 'Application' });
  await picker.click();
  await expect(page.getByRole('option', { name: 'test-api' })).toBeVisible();
  await expect(page.getByRole('option', { name: /dev-api|omnitron|foreign/ })).toHaveCount(0);
  await page.getByRole('option', { name: 'test-api' }).click();
  await expect.poll(() => filters.at(-1)?.app).toBe('sample/test/test-api');
  await page.getByRole('combobox', { name: 'Node', exact: true }).click();
  await page.getByRole('option', { name: 'test', exact: true }).click();
  await picker.click();
  await page.getByRole('option', { name: 'mail', exact: true }).click();
  await expect.poll(() => filters.at(-1)).toMatchObject({ app: 'sample/deployed/mail', nodeId: 'test-id', appPrefixes: ['sample/deployed/'] });
  await page.getByRole('combobox', { name: 'Node', exact: true }).click();
  await page.getByRole('option', { name: 'prod', exact: true }).click();
  await expect.poll(() => filters.at(-1)).toMatchObject({ nodeId: 'prod-id', appPrefixes: ['sample/test/'] });
  await picker.click();
  await expect(page.getByRole('option', { name: 'mail' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('combobox', { name: 'Stack filter' }).click();
  await page.getByRole('option', { name: /^dev\s+running/ }).click();
  await expect.poll(() => filters.at(-1)?.appPrefixes).toEqual(['sample/dev/']);
  await picker.click();
  await expect(page.getByRole('option', { name: 'dev-api' })).toBeVisible();
  await expect(page.getByRole('option', { name: /test-api|omnitron|foreign/ })).toHaveCount(0);
  expect(daemonLists).toBe(0);
});

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
  await dialog.getByRole('checkbox', { name: 'All registered remote nodes' }).check();
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
