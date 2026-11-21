import { test, expect, stubInventory } from './fixtures.mjs';

for (const width of [1280, 360]) {
  test(`system pipeline definitions and run history report their own readings at ${width}px`, async ({ page, url }) => {
    let history = new Error('Run history offline');
    await stubInventory(page, {
      'OmnitronPipelines.listPipelines': [], 'OmnitronPipelines.listRuns': () => history,
    });
    await page.setViewportSize({ width, height: 840 });
    await page.goto(url + '/pipelines');
    await expect(page.getByRole('tab', { name: 'Automations · 0' })).toBeVisible();
    await expect(page.getByText('No automations defined.')).toBeVisible();
    const runs = page.getByRole('tab', { name: /^Runs/ });
    await expect(runs).toHaveText('Runs · —');
    await runs.click();
    await expect(page.getByText('Run history offline', { exact: true })).toBeVisible();
    await expect(page.getByText('No automation runs yet.')).toHaveCount(0);
    history = [{ id: 'run-1', pipelineId: 'definition-1', pipelineName: 'Recorded run', status: 'success', startedAt: '2026-01-01T10:00:00Z', triggeredBy: 'operator' }];
    await page.getByRole('button', { name: 'Refresh pipelines' }).click();
    await expect(runs).toHaveText('Runs · 1');
    await expect(page.getByText('Recorded run', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Recorded run' })).toHaveCount(0);
    history = new Error('Run history offline');
    await page.getByRole('button', { name: 'Refresh pipelines' }).click();
    await expect(page.getByText('Showing the last available run history')).toBeVisible();
    await expect(page.getByText('Run history offline', { exact: true })).toBeVisible();
    await expect(page.getByText('Recorded run', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });

  test(`alert rules and firing inventory report their own readings at ${width}px`, async ({ page, url }) => {
    let rules = new Error('Rule registry offline');
    let firing = [];
    await stubInventory(page, { 'OmnitronAlerts.getRules': () => rules, 'OmnitronAlerts.getActiveAlerts': () => firing });
    await page.setViewportSize({ width, height: 840 });
    await page.goto(url + '/alerts#firing');
    await expect(page.getByText('Rule registry offline', { exact: true })).toBeVisible();
    const total = page.getByText('Total Rules', { exact: true }).locator('..');
    await expect(total).toContainText('—');
    await expect(page.getByText('No alerts are currently firing.')).toBeVisible();
    rules = []; firing = new Error('Firing inventory offline');
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByText(/Firing inventory offline/)).toBeVisible();
    await expect(total).toContainText('0');
    await expect(page.getByText('No alert rules configured.')).toBeVisible();
    await expect(page.getByText('No alerts are currently firing.')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test('a system run-history reader can inspect the list without querying definitions or run details', async ({ page, url }) => {
  let definitionReads = 0, detailReads = 0;
  await stubInventory(page, { 'OmnitronPipelines.listPipelines': () => { definitionReads++; return []; },
    'OmnitronPipelines.getRunStatus': () => { detailReads++; return null; },
    'OmnitronPipelines.listRuns': [{ id: 'run-1', pipelineId: 'definition-1', pipelineName: 'Read-only run', status: 'success', startedAt: '2026-01-01T10:00:00Z', triggeredBy: 'operator' }],
  }, 'online', { grants: ['OmnitronDaemon.status', 'OmnitronDaemon.ping', 'OmnitronPipelines.listRuns'] });
  await page.goto(url + '/pipelines');
  await expect(page.getByRole('tab', { name: 'Runs · 1' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Read-only run', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Read-only run' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Automations · —' }).click();
  await expect(page.getByText('Your account cannot read automation definitions.')).toBeVisible();
  expect(definitionReads).toBe(0); expect(detailReads).toBe(0);
});

test('the fleet alert link opens the firing list with only its read permissions', async ({ page, url }) => {
  let ruleReads = 0;
  await stubInventory(page, { 'OmnitronAlerts.getSummary': { firing: 1 }, 'OmnitronAlerts.getRules': () => { ruleReads++; return []; },
    'OmnitronAlerts.getActiveAlerts': [{ id: 'active-1', ruleId: 'rule-1', ruleName: 'Check workers', severity: 'warning', firedAt: '2026-01-01T10:00:00Z' }],
  }, 'online', { grants: ['OmnitronDaemon.status', 'OmnitronDaemon.ping', 'OmnitronAlerts.getSummary', 'OmnitronAlerts.getActiveAlerts'] });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(url + '/');
  const link = page.getByRole('link', { name: 'View 1 firing alert across all workspaces' });
  await expect(link).toHaveAttribute('href', '/alerts#firing');
  await link.focus(); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(url + '/alerts#firing');
  const section = page.getByRole('region', { name: 'Active alerts across all workspaces' });
  await expect(section).toBeFocused();
  await expect(section.getByText('Check workers')).toBeVisible();
  expect(ruleReads).toBe(0);
});

test('a disk alert opens the reporting node and keeps the mirror evidence readable on mobile', async ({ page, url }, testInfo) => {
  const node = 'worker-2';
  const evidence = 'raid1 degraded=1 in_sync=1/2 array_state=active sync_action=idle nvme0n1p1=in_sync nvme1n1p1=faulty';
  const reads = [];
  await stubInventory(page, {
    'OmnitronAlerts.getRules': [],
    'OmnitronAlerts.getActiveAlerts': [{
      id: 'disk-incident', ruleId: 'disk-health', ruleName: 'Linux storage degraded', subject: 'host.storage',
      severity: 'critical', node, message: evidence, firedAt: new Date().toISOString(), acknowledged: false,
    }],
    'OmnitronSystemInfo.getSnapshot': new Error('This alert belongs to another host'),
    'OmnitronNodes.getNodeSystemSnapshot': (input) => {
      reads.push(input.nodeId);
      return {
        timestamp: Date.now(), collectedMs: 35, unanswered: {},
        os: { hostname: node, platform: 'linux', distro: 'Linux', release: '', kernel: '', arch: 'x64', uptime: 100 },
        cpu: { brand: '', manufacturer: '', cores: 2, physicalCores: 2, speed: 2, loadPerCore: [], currentLoad: 10 },
        memory: { total: 1000, committed: 250, available: 750, usedPercent: 25 },
        network: { interfaces: [], rateAvailable: false }, docker: null,
        daemon: { role: 'slave', pid: 52, uptimeMs: 8000, memoryUsage: {} },
        disks: [{ fs: '/dev/md0', mount: '/', type: 'ext4', used: 100, size: 1000, available: 900, usedPercent: 10 }],
        storage: { status: 'degraded', issues: [], resources: [
          { kind: 'array', name: 'md0', health: 'degraded', detail: evidence },
          { kind: 'controller', name: 'nvme1', health: 'degraded', detail: 'state=dead' },
        ] },
      };
    },
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(url + '/alerts#firing');
  const inspect = page.getByRole('link', { name: 'Inspect storage · worker-2' });
  await inspect.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(url + '/system?view=storage&node=worker-2');
  await expect(page.getByRole('tab', { name: 'Storage' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('state=dead')).toBeVisible();
  await expect(page.getByText('/dev/md0 · ext4')).toBeVisible();
  expect(reads).toContain(node);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.screenshot({ path: testInfo.outputPath('host-storage.png') });
});
