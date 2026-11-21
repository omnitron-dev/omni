import { expect, stubInventory, test } from './fixtures.mjs';

const registry = [
  { id: 'local', name: 'Controller', host: 'localhost', daemonPort: 9700, sshPort: 22, isLocal: true, tags: [] },
  { id: 'worker-west', name: 'West worker', host: 'worker.example', daemonPort: 9700, sshPort: 22, isLocal: false, tags: [] },
];
const path = '/nodes?node=worker-west';
const handle = 'sample/deployed/reader';

async function setup(context, grants, readings = {}) {
  const reads = [];
  context.on('request', request => {
    if (request.url().endsWith('/netron/invoke')) {
      const { service, method, input } = request.postDataJSON();
      if (service === 'OmnitronNodes') reads.push([method, input[0]?.nodeId ?? input[0]?.id]);
    }
  });
  await stubInventory(context, {
    'OmnitronNodes.listNodes': registry,
    'OmnitronNodes.getNode': ({ id }) => registry.find(item => item.id === id) ?? null,
    'OmnitronNodes.getNodeDaemonStatus': ({ nodeId }) => {
      if (!registry.some(item => item.id === nodeId)) return { nodeId, reachable: false, error: 'No such node', answer: null };
      return {
        nodeId, reachable: true, error: null, answer: { totalCpu: 1, totalMemory: 1024, apps: [
          { name: nodeId === 'local' ? 'controller-only' : handle, status: 'online', memory: 1024, pid: 42, port: 4000, restarts: 0, uptime: 1200 },
        ] },
      };
    },
    'OmnitronNodes.getNodeDaemonHealth': ({ nodeId }) => ({
      nodeId, reachable: true, error: null, answer: { apps: { [handle]: { status: 'healthy', checks: [] } } },
    }),
    'OmnitronLogs.queryLogs': { entries: [], total: 0, byLevel: [] },
    ...readings,
  }, 'online', { grants });
  return reads;
}

test('node applications open by registry ID and retain the selected runtime through reload, Logs and Back', async ({ page, context, url }) => {
  const reads = await setup(context, ['OmnitronNodes.listNodes', 'OmnitronNodes.getNode', 'OmnitronNodes.getNodeDaemonStatus',
    'OmnitronNodes.getNodeDaemonHealth', 'OmnitronLogs.queryLogs']);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(url + '/nodes');
  const applications = page.getByRole('link', { name: 'Applications on West worker' });
  await expect(applications).toHaveAttribute('href', path);
  expect(reads.some(([method]) => method === 'getNodeDaemonStatus')).toBe(false);
  const opened = context.waitForEvent('page');
  await applications.click({ modifiers: ['ControlOrMeta'] });
  const freshTab = await opened;
  await expect(freshTab).toHaveURL(url + path);
  await expect(freshTab.getByText(handle, { exact: true })).toBeVisible();
  await freshTab.close();
  await applications.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(url + path);
  const logs = page.getByRole('link', { name: 'View logs for ' + handle });
  await expect(logs).toHaveAttribute('href', '/logs?app=sample%2Fdeployed%2Freader&node=worker-west');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Applications on West worker' })).toBeVisible();
  await expect(page.getByText('Health: healthy')).toBeVisible();
  await logs.click();
  await expect(page).toHaveURL(url + '/logs?app=sample%2Fdeployed%2Freader&node=worker-west');
  await page.goBack();
  await expect(page).toHaveURL(url + path);
  await expect(logs).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(url + '/nodes');
  await expect(applications).toBeVisible();
  const statusReads = reads.filter(([method]) => method === 'getNodeDaemonStatus');
  expect(statusReads.length).toBeGreaterThan(0);
  expect(statusReads.every(([, id]) => id === 'worker-west')).toBe(true);
});

test('a status-only node link reads just that runtime and exposes an unknown registry ID', async ({ page, context, url }) => {
  const reads = await setup(context, ['OmnitronNodes.getNodeDaemonStatus']);
  await page.goto(url + path);
  await expect(page.getByText(handle, { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /View logs/ })).toHaveCount(0);
  await page.goto(url + '/nodes?node=missing');
  await expect(page.getByText(/No such node/)).toBeVisible();
  await expect(page.getByText(handle, { exact: true })).toHaveCount(0);
  await expect(page.getByText('controller-only')).toHaveCount(0);
  for (const invalid of ['/nodes?node=', '/nodes?node=local&node=worker-west']) {
    await page.goto(url + invalid);
    await expect(page.getByText('Choose one node to view its applications.')).toBeVisible();
  }
  expect([...new Set(reads.map(([method]) => method))]).toEqual(['getNodeDaemonStatus']);
  expect([...new Set(reads.map(([, id]) => id))]).toEqual(['worker-west', 'missing']);
});

test('directory-only access does not expose node application reads', async ({ page, context, url }) => {
  const reads = await setup(context, ['OmnitronNodes.listNodes']);
  await page.goto(url + '/nodes');
  await expect(page.getByText('West worker', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Applications on West worker' })).toHaveCount(0);
  await page.goto(url + path);
  await expect(page.getByText(/does not have access to this area/)).toBeVisible();
  expect([...new Set(reads.map(([method]) => method))]).toEqual(['listNodes']);
});

test('a controller reply for another node cannot supply the application inventory', async ({ page, context, url }) => {
  await setup(context, ['OmnitronNodes.getNodeDaemonStatus'], {
    'OmnitronNodes.getNodeDaemonStatus': { nodeId: 'local', reachable: true, error: null, answer: { apps: [] } },
  });
  await page.goto(url + path);
  await expect(page.getByText(/returned a reading for a different node/)).toBeVisible();
  await expect(page.getByText(/running no applications/)).toHaveCount(0);
});
