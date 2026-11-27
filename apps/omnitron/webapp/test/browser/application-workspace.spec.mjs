import { expect, stubInventory, test } from './fixtures.mjs';

const projects = ['alpha', 'beta'].map(name => ({
  name, displayName: name, path: '/' + name, totalStacks: name === 'alpha' ? 3 : 1, runningStacks: 1,
  configurations: name === 'alpha' ? [{ runtimeProject: 'archive', stacks: { local: 'research' } }] : [],
}));
const app = (handle, owner, pid) => ({
  name: handle, workspace: owner, status: 'online', instances: 1, cpu: 1, memory: 1000, restarts: 0,
  pid, uptime: 3000, port: 8080, mode: 'classic', critical: false,
});
const processes = [
  app('alpha/dev/api', { project: 'alpha', stack: 'dev' }, 101),
  app('beta/dev/api', { project: 'beta', stack: 'dev' }, 202),
  app('archive/local/api', { project: 'alpha', stack: 'research' }, 303),
  app('loose', null, 404),
];
function stacks(project) {
  return processes.filter(process => process.workspace?.project === project).map(process => ({
    name: process.workspace.stack, runtimeScope: { project: process.name.split('/')[0], stack: process.name.split('/')[1] }, type: 'local', status: 'running', config: { type: 'local' },
    nodes: [], infrastructure: { ready: true, services: {} },
    apps: [{ ...process, name: 'api', handleKey: process.name }],
  })).concat(project === 'alpha' ? [{
    name: 'edge', type: 'remote', status: 'running', config: { type: 'remote' }, nodes: [], infrastructure: { ready: true, services: {} },
    apps: [{ ...processes[0], handleKey: 'alpha/deployed/api', name: 'api' }],
  }] : []);
}
async function setup(context, grants, readings = {}) {
  const calls = [];
  context.on('request', request => {
    if (request.url().endsWith('/netron/invoke')) {
      const { service, method, input } = request.postDataJSON();
      calls.push({ method: service + '.' + method, arg: input[0] });
    }
  });
  await context.addInitScript(() => {
    localStorage.setItem('omnitron_active_project', 'beta');
    localStorage.setItem('omnitron_active_stack', 'dev');
    localStorage.setItem('omnitron_workspace_routes', JSON.stringify({ beta: '/projects/beta/apps?stack=dev' }));
  });
  await stubInventory(context, {
    'OmnitronProject.listProjects': projects,
    'OmnitronDaemon.list': processes,
    'OmnitronProject.listStacks': ({ project }) => stacks(project),
    'OmnitronProject.getProjectApps': ({ project }) => stacks(project).flatMap(stack =>
      stack.apps.map(entry => ({ ...entry, stack: stack.name, stackType: stack.type }))),
    'OmnitronDaemon.getApp': target => {
      const found = processes.find(process => target.name ? target.name === process.name : target.project === process.workspace?.project &&
          target.stack === process.workspace?.stack && target.app === 'api');
      return found ?? new Error('No local application at this address');
    },
    'OmnitronDaemon.restartApp': () => processes[2],
    'OmnitronTraces.queryTraces': [], 'OmnitronNodes.listNodes': [],
    ...readings,
  }, 'online', { grants, role: grants ? 'viewer' : 'operator' });
  return calls;
}
const resource = '/projects/alpha/apps/research/api';

test('Overview, a new tab and history open the same project application', async ({ page, context, url }) => {
  const calls = await setup(context);
  await page.goto(url);
  await expect(page.getByRole('button', { name: 'Switch workspace: Omnitron' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Traces', exact: true })).toBeVisible();
  const table = page.getByRole('table', { name: 'Applications' });
  const target = table.getByRole('row', { name: /alpha\/research/ }).getByRole('link', { name: 'api' });
  await expect(target).toHaveAttribute('href', resource);
  await expect(table.getByRole('row', { name: /beta\/dev/ }).getByRole('link', { name: 'api' })).toHaveAttribute('href', '/projects/beta/apps/dev/api');
  expect(calls.filter(c => c.method === 'OmnitronProject.listStacks' || c.method === 'OmnitronDaemon.getApp')).toEqual([]);
  const freshTab = context.waitForEvent('page');
  await target.click({ modifiers: ['ControlOrMeta'] });
  const tab = await freshTab;
  await expect(tab).toHaveURL(url + resource);
  for (const client of [tab, page]) {
    if (client === page) await target.click();
    await expect(client.getByRole('button', { name: 'Switch workspace: alpha' })).toBeVisible();
    await expect(client.getByRole('combobox', { name: 'Stack filter' })).toHaveText('Stack: research');
    await expect(client.getByRole('heading', { level: 1 })).toHaveText('api');
    await expect(client).toHaveTitle('api · research · alpha · Omnitron');
    await expect(client.locator('a[aria-current]').filter({ hasText: /^Applications$/ })).toHaveAttribute('href', '/projects/alpha/apps?stack=research');
    await expect(client.getByRole('link', { name: /^(Traces|Nodes)$/ })).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect.poll(() => calls.filter(c => c.method === 'OmnitronDaemon.restartApp').map(c => c.arg)).toEqual([{ name: 'archive/local/api' }]);
  await page.goBack();
  await expect(page).toHaveURL(url + '/');
  await expect(page.getByRole('button', { name: 'Switch workspace: Omnitron' })).toBeVisible();
  await page.goForward();
  await page.reload();
  await expect(page).toHaveTitle('api · research · alpha · Omnitron');
  await page.goto(url + '/projects/alpha/apps/edge/api');
  await expect(page.getByText(/absent from the local stack inventory|No local application at this address/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restart' })).toHaveCount(0);
});

test('getApp-only direct entry reads the imported owner without inventory or privileged calls', async ({ page, context, url }) => {
  const calls = await setup(context, ['OmnitronDaemon.getApp']);
  await page.goto(url + resource);
  await expect(page.getByRole('button', { name: 'Switch workspace: alpha' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'api' })).toBeVisible();
  await expect(page.getByText('archive/local/api', { exact: true }).first()).toBeVisible();
  await expect(page.locator('a[aria-current]').filter({ hasText: /^Applications$/ })).toHaveAttribute('href', resource);
  const trail = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(trail).toContainText('Console');
  await expect(trail).toContainText('research');
  await expect(trail.getByRole('link')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Restart|Stop|Start)$/ })).toHaveCount(0);
  expect(calls.filter(c => c.method === 'OmnitronDaemon.getApp').every(c =>
    c.arg.project === 'alpha' && c.arg.stack === 'research' && c.arg.app === 'api')).toBe(true);
  expect(calls.map(c => c.method).filter(method => /listProjects|listStacks|getProjectApps|inspect|getHealth|getMetrics|restartApp/.test(method))).toEqual([]);
  await page.goto(url + '/processes/api');
  await expect(page.getByText(/No local application at this address/)).toBeVisible();
  await page.goto(url + '/processes/loose');
  await expect(page.getByRole('button', { name: 'Switch workspace: Omnitron' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'loose' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Restart|Stop|Start)$/ })).toHaveCount(0);
});

test('remote application links name their stack destination at both viewport widths', async ({ page, context, url }) => {
  await setup(context);
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of ['/projects/alpha?stack=edge', '/projects/alpha/apps?stack=edge']) {
      await page.goto(url + path);
      const link = page.getByRole('rowheader').getByRole('link', { name: 'Open stack edge for api' });
      await expect(link).toHaveText('Open stack');
      await expect(link).toBeInViewport();
      await expect(link).toHaveAttribute('href', '/projects/alpha/stacks/edge');
      await link.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(url + '/projects/alpha/stacks/edge');
      await page.goBack();
      await expect(page).toHaveURL(url + path);
      await expect(link).toBeVisible();
    }
  }
});

test('application rows expose only available actions in a mixed local and remote inventory', async ({ page, context, url }) => {
  await setup(context, ['OmnitronProject.getProjectApps', 'OmnitronDaemon.getApp', 'OmnitronDaemon.restartApp']);
  const list = '/projects/alpha/apps';
  await page.goto(url + list);
  const remote = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'edge · remote' }) });
  await expect(remote.getByRole('rowheader')).toHaveText('api');
  await expect(remote.getByRole('link')).toHaveCount(0);
  await expect(remote).toHaveCSS('cursor', 'default');
  const table = page.getByRole('region', { name: 'Applications' });
  await table.focus();
  await page.keyboard.press('End');
  await expect(remote).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(url + list);

  const local = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'research', exact: true }) });
  await expect(local.getByRole('link', { name: 'api' })).toHaveAttribute('href', resource);
  await expect(local.getByRole('button', { name: 'Restart archive/local/api' })).toBeVisible();
  await local.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(url + resource);
});

test('application logs and scoped Logs share keyboard disclosure and retain the full event', async ({ page, context, url }) => {
  const event = {
    id: 'event-a', app: 'archive/local/api', timestamp: '2026-01-11T09:12:34.000Z', level: 'info',
    message: 'A test job completed', labels: { queue: 'example' },
  };
  await setup(context, undefined, {
    'OmnitronLogs.streamLogs': [event],
    'OmnitronLogs.queryLogs': { entries: [event], total: 1, byLevel: [] },
  });
  const logs = '/projects/alpha/logs?stack=research';
  await page.setViewportSize({ width: 320, height: 800 });
  for (const path of [resource, logs + '&app=archive%2Flocal%2Fapi', logs]) {
    await page.goto(url + path);
    if (path === resource) {
      const tabs = page.getByRole('tablist', { name: 'Application details' });
      await tabs.getByRole('tab', { name: 'Overview' }).focus();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('tabpanel', { name: 'Logs' })).toBeVisible();
    }
    const entry = page.getByRole('button', { name: /archive\/local\/api info: A test job completed/ });
    await expect(entry).toBeVisible();
    if (path === logs) await expect(entry).toContainText(event.app);
    else await expect(entry).not.toContainText(event.app);
    await entry.focus();
    await page.keyboard.press('Enter');
    await expect(entry).toHaveAttribute('aria-expanded', 'true');
    const raw = page.getByRole('button', { name: 'Raw event' });
    await raw.focus();
    await page.keyboard.press('Space');
    const json = page.getByLabel('Raw log event');
    await expect(json).toContainText(event.app);
    expect(JSON.parse(await json.textContent())).toMatchObject(event);
    const main = page.getByRole('main');
    expect(await main.evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0);
    await json.focus();
    await page.keyboard.press('Escape');
    await expect(entry).toBeFocused();
    await expect(entry).toHaveAttribute('aria-expanded', 'false');
  }
});


test('release, stack and deployment links carry their public owner across tabs and both workspaces', async ({ page, context, url }) => {
  const releases = ['alpha', 'beta'].map(project => ({ id: project + '-build', project, complete: true }));
  const history = [{ project: 'archive', stack: 'local', release: 'alpha-build' }, { project: 'beta', stack: 'dev', release: 'beta-build' }]
    .map(row => ({ ...row, at: '2026-01-01T00:00:00Z', source: 'operator', actorId: null, releaseUnnamed: false }));
  await setup(context, undefined, {
    'OmnitronRelease.list': { releases, root: '/releases' },
    'OmnitronRelease.get': ({ id }) => releases.find(release => release.id === id),
    'OmnitronAudit.available': { available: true },
    'OmnitronRelease.deployments': history,
    'OmnitronMetrics.getSnapshot': { apps: {} },
  });
  await page.goto(url + '/deployments');
  await expect(page.getByRole('button', { name: 'Switch workspace: Omnitron' })).toBeVisible();
  const stack = page.getByRole('link', { name: 'alpha/research', exact: true });
  await expect(stack).toHaveAttribute('href', '/projects/alpha/stacks/research');
  await expect(page.getByRole('link', { name: 'beta/dev', exact: true })).toHaveAttribute('href', '/projects/beta/stacks/dev');

  await page.goto(url + '/releases');
  const link = page.getByRole('link', { name: 'alpha-build', exact: true });
  await expect(link).toHaveAttribute('href', '/projects/alpha/releases/alpha-build');
  await link.click();
  const row = page.getByRole('region', { name: 'Deployment state' });
  const research = row.getByRole('link', { name: 'research', exact: true });
  await expect(research).toHaveAttribute('href', '/projects/alpha/stacks/research');
  const popup = context.waitForEvent('page');
  await research.click({ modifiers: ['ControlOrMeta'] });
  const tab = await popup;
  await expect(tab).toHaveURL(url + '/projects/alpha/stacks/research');
  await expect(tab.getByRole('button', { name: 'Switch workspace: alpha' })).toBeVisible();
  await expect(tab.getByRole('heading', { level: 1, name: 'research' })).toBeVisible();
  await page.goto(url + '/projects/alpha/deployments?stack=research');
  await page.locator('summary').filter({ hasText: 'Transfers and deployment history' }).click();
  await expect(page.getByRole('link', { name: 'alpha-build' })).toHaveAttribute('href', '/projects/alpha/releases/alpha-build?stack=research');
  await expect(page.getByRole('link', { name: 'beta-build' })).toHaveCount(0);
  await page.goto(url + '/releases/alpha-build');
  await expect(page).toHaveURL(url + '/projects/alpha/releases/alpha-build');

  await page.goto(url + '/metrics');
  await expect(page.getByRole('heading', { level: 1, name: 'Metrics' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '4/4', exact: true })).toBeVisible();
  await page.goto(url + '/projects/alpha/metrics?stack=research');
  await expect(page.getByRole('heading', { name: '1/1', exact: true })).toBeVisible();
  await expect(page.locator('a[aria-current]').filter({ hasText: /^Metrics$/ })).toHaveAttribute('href', '/projects/alpha/metrics?stack=research');
});


test('a remote topology placement opens only its own registry log stream', async ({ page, context, url }) => {
  const host = { host: 'worker', port: 9700, daemonRole: 'slave', connected: true };
  let ambiguous = false;
  const inventory = (project) => {
    const current = stacks(project);
    const remote = current.find(stack => stack.name === 'edge');
    if (remote) {
      remote.nodes = [host];
      if (ambiguous) current.push({ ...remote, name: 'other-edge' });
    }
    return current;
  };
  const calls = await setup(context, undefined, {
    'OmnitronProject.listStacks': ({ project }) => inventory(project),
    'OmnitronNodes.listNodes': [{ id: 'worker-a', name: 'Worker A', host: 'worker', daemonPort: 9700 },
      { id: 'worker-b', name: 'Worker B', host: 'worker', daemonPort: 9800 }],
    'OmnitronLogs.streamLogs': [],
    'OmnitronLogs.queryLogs': { entries: [], total: 0, byLevel: [] },
    'OmnitronLogs.getLogStats': { byApp: [], byLevel: [] },
    'OmnitronProject.getTopology': { dependencies: [], coverage: [], warnings: [], scopes: [] },
  });
  const path = '/projects/alpha/topology?stack=edge';
  await page.goto(url + path);
  const appNode = page.locator('.react-flow__node[data-id="app-edge-alpha/deployed/api"]');
  await appNode.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Node actions' });
  const logs = menu.getByRole('menuitem', { name: 'View logs' });
  await expect(logs).toHaveAttribute('href', '/projects/alpha/logs?app=alpha%2Fdeployed%2Fapi&node=worker-a&stack=edge');
  await expect(menu.getByRole('menuitem', { name: /^(Start|Stop|Restart)$/ })).toHaveCount(0);
  await logs.click();
  await expect.poll(() => calls.some(c => c.method === 'OmnitronLogs.streamLogs' && c.arg.app === 'alpha/deployed/api' &&
    c.arg.nodeId === 'worker-a' && c.arg.appPrefixes?.includes('alpha/deployed/'))).toBe(true);

  await page.goBack();
  await appNode.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('tab', { name: 'Logs', exact: true }).click();
  await expect.poll(() => calls.some(c => c.method === 'OmnitronLogs.streamLogs' && c.arg.tail === 30 &&
    c.arg.app === 'alpha/deployed/api' && c.arg.nodeId === 'worker-a')).toBe(true);

  ambiguous = true;
  await page.reload();
  await appNode.click({ button: 'right' });
  await expect(menu).toBeVisible();
  await expect(logs).toHaveCount(0);
  await page.keyboard.press('Escape');
  await appNode.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('tab', { name: 'Logs', exact: true }).click();
  await expect(page.getByText('The log stream for this placement is unconfirmed.')).toBeVisible();
  expect(calls.filter(c => c.method === 'OmnitronLogs.streamLogs' && c.arg.app === 'alpha/deployed/api' && !c.arg.nodeId)).toEqual([]);
});
