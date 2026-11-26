import { test, expect, stubInventory } from './fixtures.mjs';

test('deploys a prepared release to the selected receiver from the stack workspace', async ({ page, url }) => {
  const digest = 'f'.repeat(64), actions = [];
  const app = { name: 'main', handleKey: 'sample/deployed/main', status: 'online', pid: 213, uptime: 9000, instances: 1, restarts: 0 };
  const stack = { name: 'prod', type: 'remote', status: 'running', apps: [app], nodes: [], config: { type: 'remote' },
    selectedRelease: { id: 'release-one', manifestSha256: 'a'.repeat(64) } };
  await stubInventory(page, {
    'OmnitronProject.listProjects': [{ name: 'sample', displayName: 'Sample', path: '/sample', totalStacks: 1, runningStacks: 1 }],
    'OmnitronProject.listStacks': [stack], 'OmnitronProject.getDeployProgress': [], 'OmnitronRelease.list': { releases: [] },
    'OmnitronProject.checkRelease': input => input.release === 'release-two' ? { ok: true, ...(actions.length && { deploymentPhase: 'starting' }), deployment: {
      nodeId: 'receiver-a', release: input.release, digest, rollback: { release: 'release-one' },
      stop: { applications: ['main'], containers: ['database'] },
    } } : { ok: false, state: 'replacement-unavailable', because: 'Source has not been prepared' },
    'OmnitronProject.startStack': input => { actions.push(['start', input]); return stack; },
    'OmnitronProject.deployReviewedRelease': input => {
      actions.push(['deploy', input]);
      return actions.length === 1 ? new Error('Connection lost before confirmation') : stack;
    },
  }, 'online', { role: 'admin' });
  await page.goto(url + '/projects/sample/stacks/prod');
  await page.getByRole('tab', { name: 'Configuration & actions', exact: true }).click();
  await page.getByRole('button', { name: 'Deploy release…' }).click();
  const dialog = page.getByRole('dialog'), field = dialog.getByRole('combobox', { name: 'Release ID' });
  await field.fill('release-two');
  await expect(dialog.getByText('receiver-a', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Verified return release · release-one')).toBeVisible();
  await dialog.getByText('Full stop · 1 application · 1 container').click();
  await expect(dialog.getByText('Applications to stop · main')).toBeVisible();
  await expect(dialog.getByText('Containers to remove · database')).toBeVisible();
  await field.fill('other');
  await expect(dialog.getByText('Source has not been prepared')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Deploy', exact: true })).toBeDisabled();
  expect(actions).toEqual([]);
  await field.fill('release-two');
  await dialog.getByRole('button', { name: 'Stop and deploy' }).click();
  await expect(dialog.getByText(/No start acknowledgement|Connection lost before confirmation/i)).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Deploy release…' }).click();
  await field.fill('release-two');
  await dialog.getByRole('button', { name: 'Continue deployment' }).click();
  await expect(dialog).toHaveCount(0);
  const expected = ['deploy', { project: 'sample', stack: 'prod', release: 'release-two', review: digest }];
  expect(actions).toEqual([expected, expected]);
});

for (const width of [1440, 360]) {
  test(`stack health, retained history and read permissions at ${width}px`, async ({ page, url }, testInfo) => {
    const at = '2026-11-17T08:00:00Z';
    const apps = [
      { name: 'worker', handleKey: 'source/dev/worker', status: 'online', health: 'degraded', pid: 412, uptime: 120_000, instances: 2, restarts: 1 },
      { name: 'portal', handleKey: 'source/dev/portal', status: 'online', health: 'healthy', pid: 423, uptime: 600_000, instances: 1, restarts: 0 },
    ];
    let historyReads = 0;
    await stubInventory(page, {
      'OmnitronProject.listProjects': [{ name: 'sample', displayName: 'Sample', path: '/example', totalStacks: 1, runningStacks: 1 }],
      'OmnitronProject.listStacks': [{
        name: 'dev', type: 'local', status: 'running', config: { type: 'local' }, nodes: [], apps, infrastructureMode: 'preserve',
        health: { status: 'degraded', observedAt: at, apps: [
          { name: 'worker', node: 'local', status: 'degraded', checks: [{ name: 'consumer', status: 'warn', message: 'Consumer lag exceeds 30 seconds' }] },
          { name: 'portal', node: 'local', status: 'healthy', checks: [] },
        ] },
        infrastructure: { ready: false, services: { queue: { status: 'error', nativeStatus: 'running', health: 'unhealthy', provisioning: 'failed',
          service: 'queue', containerName: 'sample-dev-queue', port: 4222, error: 'Queue setup failed' } } },
        stopOperation: { id: 'receipt-dev', phase: 'stopped', nodes: [], startedAt: at, completedAt: at, supersededAt: at, keepInfrastructure: true },
      }],
      'OmnitronDaemon.getApp': {},
      'OmnitronAudit.available': { available: true },
      'OmnitronRelease.deployments': () => {
        historyReads++;
        return [{ project: 'sample', stack: 'dev', release: 'recorded-previous-build', at, source: 'operator' }];
      },
    });
    await page.addInitScript(() => {
      localStorage.setItem('omnitron_active_project', 'sample');
      localStorage.setItem('omnitron_active_stack', 'dev');
    });
    await page.route('**/stacks/dev', async route => {
      if (route.request().resourceType() !== 'document') return route.continue();
      await route.fulfill({ response: await route.fetch({ url: url + '/workspace.html' }) });
    });
    await page.setViewportSize({ width, height: width === 360 ? 800 : 900 });
    await page.goto(url + '/projects/sample/stacks/dev');

    const summary = page.getByRole('region', { name: 'Runtime summary' });
    const tabs = page.getByRole('tablist', { name: 'Stack details' });
    await expect(summary.getByText('2/2 online')).toBeVisible();
    await expect(summary.getByText('Not ready')).toBeVisible();
    await expect(summary.getByText('queue · Queue setup failed')).toBeVisible();
    await expect(summary.getByText(/Consumer lag exceeds 30 seconds/)).toBeVisible();
    const appList = page.getByRole('region', { name: 'Applications', exact: true });
    await expect(appList.getByRole('link', { name: 'worker' })).toHaveAttribute('href', '/projects/sample/apps/dev/worker');
    await expect(page.getByRole('region', { name: 'Stack infrastructure' }).getByText('Queue setup failed')).toBeVisible();
    expect(historyReads).toBe(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath('stack-runtime.png') });

    await tabs.getByRole('tab', { name: 'Runtime', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    const history = page.getByRole('tabpanel', { name: 'Releases & history' });
    await expect(history.getByText('recorded-previous-build')).toBeVisible();
    await expect(history.getByRole('link', { name: 'recorded-previous-build' })).toHaveCount(0);
    expect(historyReads).toBeGreaterThan(0);
    const disclosure = history.locator('summary').filter({ hasText: 'Stop confirmed' });
    await disclosure.focus();
    await disclosure.press('Enter');
    await expect(history.getByText('Operation receipt-dev')).toBeVisible();
    await expect(summary.getByText(/Consumer lag exceeds 30 seconds/)).toBeVisible();
    await tabs.getByRole('tab', { name: 'Configuration', exact: true }).click();
    await expect(page.getByText('Preserve existing infrastructure')).toBeVisible();
    await expect(page.getByRole('button', { name: /Review stop|Deploy release|Delete stack/ })).toHaveCount(0);
  });
}
