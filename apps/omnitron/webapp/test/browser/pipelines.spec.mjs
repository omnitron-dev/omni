import { test, expect, stubInventory } from './fixtures.mjs';

for (const width of [1440, 360]) {
  test(`workspace pipeline recovery at ${width}px`, async ({ page, url }, testInfo) => {
    const at = '2026-11-17T08:00:00Z';
    const digest = 'b'.repeat(64);
    const queries = [], commands = [];
    let inspected = false, finished = false, globalReads = 0;
    const target = project => ({ project, stack: 'dev', releaseId: 'build-one', manifestSha256: 'd'.repeat(64), review: 'e'.repeat(64) });
    const receipt = project => ({
      id: project + '-run', pipelineId: project + '-definition', pipelineName: project + ' recorded delivery',
      status: project === 'other' || finished ? 'success' : 'failed', startedAt: at, completedAt: at, triggeredBy: 'reviewer',
    });
    const detail = () => ({
      ...receipt('example'), params: {}, review: { protocol: 1, digest: 'a'.repeat(64), definitionRevision: 'c'.repeat(64),
        projects: ['example'], parameterNames: [] },
      steps: [{ name: 'ship', kind: 'deploy', duration: 1000, status: inspected ? 'success' : 'failed',
        ...(!inspected && { error: 'Receiver acknowledgement lost' }),
        deployment: { state: inspected ? 'confirmed' : 'unconfirmed',
          target: target('example'),
          scope: { project: 'example', stack: 'dev', registeredAt: at }, expected: [
            { node: 'edge', app: 'api', releaseId: 'build-one', manifestSha256: 'd'.repeat(64), artifactSha256: 'f'.repeat(64) },
          ] } }, { name: 'verify', kind: 'xec', duration: 0, status: finished ? 'success' : 'pending' }],
      ...(!finished && { recovery: { digest: inspected ? digest : 'a'.repeat(64), completed: inspected ? ['ship'] : [],
        pending: ['verify'], blocked: inspected ? [] : ['ship'] } }),
    });
    await stubInventory(page, {
      'OmnitronPipelines.listPipelines': () => { globalReads++; return []; },
      'OmnitronPipelines.listRuns': () => { globalReads++; return []; },
      'OmnitronPipelines.listWorkspace': query => {
        queries.push(query);
        const match = !query.stack || query.stack === 'dev';
        return { definitions: match ? [{ id: query.project + '-definition', name: query.project + ' delivery',
          revision: 'c'.repeat(64), steps: [{ kind: 'deploy', name: 'ship', target: target(query.project) }] }] : [],
          runs: match ? [receipt(query.project)] : [] };
      },
      'OmnitronPipelines.executePipeline': () => { throw Error('Only the existing receipt is inspected'); },
      'OmnitronPipelines.getRunStatus': ({ runId }) => runId === 'example-run' ? detail() : { ...receipt('other'), steps: [], params: {} },
      'OmnitronPipelines.reconcileRun': input => { commands.push(input); inspected = true; return detail(); },
      'OmnitronPipelines.resumeRun': input => { commands.push(input); finished = true; return detail(); },
      'OmnitronNodes.listNodes': [],
    });
    await page.addInitScript(() => {
      localStorage.setItem('omnitron_active_project', 'example');
      localStorage.setItem('omnitron_workspace_routes', JSON.stringify({ example: '/pipelines', other: '/pipelines' }));
    });
    await page.route('**/pipelines', async route => {
      if (route.request().resourceType() !== 'document') return route.continue();
      return route.fulfill({ response: await route.fetch({ url: url + '/workspace.html' }) });
    });
    await page.setViewportSize({ width, height: 850 });
    await page.goto(url + '/pipelines');
    const stack = page.getByRole('combobox', { name: 'Stack filter' });
    await stack.click();
    await page.getByRole('option', { name: /^dev/ }).click();
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    const review = page.getByRole('dialog');
    await review.locator('summary').filter({ hasText: 'ship · deploy · example/dev' }).click();
    await expect(review.getByText(/"releaseId": "build-one"/)).toBeVisible();
    await expect(review.getByText(/Local daemon host|Daemon working directory/)).toHaveCount(0);
    await review.getByRole('button', { name: 'Cancel' }).click();
    const history = page.getByRole('tab', { name: /Runs · 1/ });
    await history.click();
    expect(queries.at(-1)).toEqual({ project: 'example', stack: 'dev', limit: 100 });
    const row = page.getByRole('button', { name: 'example recorded delivery' });
    await row.focus();
    await row.press('Enter');
    const resume = page.getByRole('button', { name: 'Continue remaining steps' });
    await expect(resume).toBeDisabled();
    await expect(page.getByText(/Continuation blocked by ship/)).toBeVisible();
    await expect(page.getByText('Receiver acknowledgement lost')).toBeVisible();
    const receiptDetails = page.locator('summary').filter({ hasText: 'Deployment receipt' });
    await receiptDetails.focus();
    await receiptDetails.press('Enter');
    await expect(page.getByLabel('ship deployment evidence')).toContainText('build-one');
    await receiptDetails.press('Enter');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath('workspace-recovery.png') });
    await page.getByRole('button', { name: 'Inspect remote receipts' }).click();
    await expect(resume).toBeEnabled();
    await resume.click();
    await expect(resume).toHaveCount(0);
    expect(commands).toEqual([{ runId: 'example-run' }, { runId: 'example-run', expectedDigest: digest, params: {} }]);
    await page.goBack();
    await expect(stack).toHaveText('All stacks');
    await expect(page.getByRole('button', { name: 'Close run details' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Switch workspace: Example' }).click();
    await page.getByRole('menuitem', { name: /Other/ }).click();
    await expect(page.getByRole('button', { name: 'other recorded delivery' })).toBeVisible();
    await expect(row).toHaveCount(0);
    expect(queries.at(-1)).toEqual({ project: 'other', limit: 100 });
    expect(globalReads).toBe(0);
  });
}

test('an older controller cannot mix global history into a project', async ({ page, url }) => {
  let globalReads = 0;
  await stubInventory(page, {
    'OmnitronPipelines.listPipelines': () => { globalReads++; return []; },
    'OmnitronPipelines.listRuns': () => { globalReads++; return []; },
  });
  await page.addInitScript(() => localStorage.setItem('omnitron_active_project', 'example'));
  await page.route('**/pipelines', async route => route.fulfill({ response: await route.fetch({ url: url + '/workspace.html' }) }));
  await page.goto(url + '/pipelines');
  await expect(page.getByText(/Workspace pipeline history is unavailable/)).toBeVisible();
  expect(globalReads).toBe(0);
});
