import { test, expect, stubInventory } from './fixtures.mjs';

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
