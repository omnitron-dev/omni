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
    name: process.workspace.stack, type: 'local', status: 'running', config: { type: 'local' },
    nodes: [], infrastructure: { ready: true, services: {} },
    apps: [{ ...process, name: 'api', handleKey: process.name }],
  })).concat(project === 'alpha' ? [{
    name: 'edge', type: 'remote', status: 'running', config: { type: 'remote' }, nodes: [], infrastructure: { ready: true, services: {} },
    apps: [{ ...processes[0], handleKey: 'alpha/deployed/api', name: 'api' }],
  }] : []);
}
async function setup(context, grants) {
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
