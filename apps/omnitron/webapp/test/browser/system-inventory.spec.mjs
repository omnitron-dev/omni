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
