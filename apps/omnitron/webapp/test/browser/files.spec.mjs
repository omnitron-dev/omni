import { test, expect, stubInventory } from './fixtures.mjs';

const area = id => ({ id, label: id.toUpperCase(), readOnly: true });
const node = (id, name) => ({ id, name, host: id + '.test', isLocal: false });

async function fileInventory(page, beforeList = () => {}) {
  const roots = { local: [area('home')], east: [area('logs')], west: [area('assets'), area('reports')] };
  const calls = [];
  page.on('request', request => {
    if (!request.url().endsWith('/netron/invoke')) return;
    const { service, method, input } = request.postDataJSON();
    if (service === 'OmnitronFiles') calls.push({ method, ...input[0] });
  });
  await stubInventory(page, {
    'OmnitronNodes.listNodes': [node('east', 'East region'), node('west', 'West region')],
    'OmnitronFiles.transfers': [],
    'OmnitronFiles.roots': ({ nodeId }) => ({ protocol: 1, roots: roots[nodeId] }),
    'OmnitronFiles.list': async ({ nodeId, rootId }) => {
      await beforeList(nodeId);
      const name = nodeId + '-' + rootId + '.txt';
      return { revision: 'fixture', next: null, entries: [{ name, path: name, kind: 'file', size: 23,
        modifiedAt: '2026-01-01T00:00:00Z', mode: 0o444, version: 'fixture-1' }] };
    },
  });
  return { calls, roots };
}

const pane = (page, side) => page.getByRole('region', { name: side + ' file panel' });
const add = panel => panel.getByRole('button', { name: /new .*location tab/i });
const row = (panel, nodeId, rootId) => panel.getByRole('row', { name: 'file ' + nodeId + '-' + rootId + '.txt' });
async function openFiles(page, url, width) {
  await page.setViewportSize({ width, height: 840 });
  await page.goto(url + '/workspace.html?view=files');
  await expect(row(pane(page, 'left'), 'local', 'home')).toBeVisible();
}
async function chooseNode(page, panel, name) {
  await add(panel).click();
  await page.getByRole('menuitem', { name: new RegExp(name) }).click();
}

for (const width of [1440, 390]) {
  test('file locations open only after an explicit node choice at ' + width + 'px', async ({ page, url }) => {
    const { calls } = await fileInventory(page);
    await openFiles(page, url, width);
    const left = pane(page, 'left'), right = pane(page, 'right');
    if (width < 600) await page.getByRole('button', { name: 'B', exact: true }).click();
    await expect(row(right, 'local', 'home')).toBeVisible();
    await add(right).click();
    await expect(page.getByRole('menuitem', { name: /East region/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(right.getByRole('tab')).toHaveCount(1);
    expect(calls.filter(call => call.nodeId && call.nodeId !== 'local')).toEqual([]);

    await add(right).press('Enter');
    const menu = page.getByRole('menu', { name: 'Choose a node' });
    await expect(menu.getByRole('menuitem', { name: /Local/ })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: /East region/ })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(row(right, 'east', 'logs')).toBeVisible();
    await expect(right.getByRole('tab')).toHaveCount(2);
    await expect(right.getByRole('combobox')).toHaveCount(0);
    expect(calls.filter(call => call.method === 'list' && call.nodeId === 'east').map(call => call.rootId)).toEqual(['logs']);
    if (width < 600) await page.getByRole('button', { name: 'A', exact: true }).click();
    await expect(row(left, 'local', 'home')).toBeVisible();
    await row(left, 'local', 'home').click();
    await page.keyboard.press('Tab');
    await expect(row(right, 'east', 'logs')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(row(left, 'local', 'home')).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

test('a tab binds its chosen area, and revocation never substitutes another area', async ({ page, url }) => {
  const { calls, roots } = await fileInventory(page);
  await openFiles(page, url, 1440);
  const left = pane(page, 'left');
  await chooseNode(page, left, 'West region');
  await expect(left.getByRole('button', { name: 'Open ASSETS' })).toBeVisible();
  const areaChoice = left.getByRole('button', { name: 'Open REPORTS' });
  await expect(areaChoice).toBeVisible();
  expect(calls.filter(call => call.nodeId === 'west' && call.method !== 'roots')).toEqual([]);
  await areaChoice.press('Enter');
  await expect(row(left, 'west', 'reports')).toBeVisible();
  await expect(left.getByRole('combobox')).toHaveCount(0);
  const remoteTab = left.getByRole('tab', { selected: true });
  const tabName = await remoteTab.getAttribute('aria-label') ?? await remoteTab.innerText();
  const tabs = left.getByRole('tab');
  await tabs.first().click();
  await expect(row(left, 'local', 'home')).toBeVisible();
  roots.west = [area('assets')];
  const beforeRevocation = calls.length;
  await tabs.last().click();
  await expect.poll(() => calls.slice(beforeRevocation).some(call => call.method === 'roots' && call.nodeId === 'west')).toBe(true);
  await expect(left.getByRole('alert')).toContainText('This file area is no longer available');
  await expect(row(left, 'west', 'reports')).toHaveCount(0);
  await expect(left.getByRole('tab', { selected: true })).toHaveCount(1);
  expect((await remoteTab.getAttribute('aria-label') ?? await remoteTab.innerText())).toBe(tabName);
  expect(calls.slice(beforeRevocation).filter(call => call.method === 'list' && call.nodeId === 'west')).toEqual([]);
  await expect(left.getByRole('combobox')).toHaveCount(0);
});

test('a late remote directory reply cannot replace the active local listing', async ({ page, url }) => {
  const pending = Promise.withResolvers();
  const started = Promise.withResolvers();
  await fileInventory(page, nodeId => {
    if (nodeId !== 'east') return;
    started.resolve();
    return pending.promise;
  });
  await openFiles(page, url, 1440);
  const left = pane(page, 'left');
  try {
    await chooseNode(page, left, 'East region');
    await started.promise;
    await left.getByRole('tab', { name: /Local/ }).click();
    await expect(row(left, 'local', 'home')).toBeVisible();
    const remoteReply = page.waitForResponse(response => {
      if (!response.url().endsWith('/netron/invoke')) return false;
      const { service, method, input } = response.request().postDataJSON();
      return service === 'OmnitronFiles' && method === 'list' && input[0].nodeId === 'east';
    });
    pending.resolve();
    expect((await remoteReply).ok()).toBe(true);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(row(left, 'local', 'home')).toBeVisible();
    await expect(row(left, 'east', 'logs')).toHaveCount(0);
  } finally {
    pending.resolve();
  }
});
