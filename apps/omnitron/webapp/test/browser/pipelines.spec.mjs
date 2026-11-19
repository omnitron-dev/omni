import { test, expect, stubInventory } from './fixtures.mjs';
import { Pipeline as XecPipeline } from '@xec-sh/ops/pipeline';

for (const width of [1440, 360]) {
  test(`author dependency graph, save and reopen at ${width}px`, async ({ page, url }, testInfo) => {
    const revision = 'a'.repeat(64);
    const check = { name: 'inspect', kind: 'xec', run: 'console.log(params.mode)', cwd: '/srv/check',
      env: { SCOPE: 'fixture' }, retries: 2, timeout: 43000, condition: 'params.enabled' };
    const publish = { name: 'publish', kind: 'deploy', dependsOn: ['inspect'], condition: 'params.ship',
      target: { project: 'example', stack: 'dev', releaseId: 'version-one', manifestSha256: 'c'.repeat(64), review: 'd'.repeat(64) } };
    const report = { name: 'report', kind: 'shell', run: 'echo done', nodeId: 'node-a' };
    const triggers = [{ type: 'manual', config: { source: 'console' } }];
    let stored = { name: 'Reviewed delivery', id: 'qualified-graph', revision, conditionalUpdates: true,
      description: 'Compare the recorded release', triggers, steps: [check, publish, report, { name: 'obsolete', kind: 'shell', run: 'echo old' }] };
    const writes = [], runs = [];
    await stubInventory(page, {
      'OmnitronPipelines.listWorkspace': () => ({ definitions: [stored], runs: [] }),
      'OmnitronPipelines.listPipelines': () => [stored], 'OmnitronPipelines.listRuns': [],
      'OmnitronNodes.listNodes': [],
      'OmnitronPipelines.executePipeline': input => { runs.push(input); return new Error('Unexpected run'); },
      'OmnitronPipelines.prepareRun': input => { runs.push(input); return new Error('Unexpected run'); },
      'OmnitronPipelines.startRun': input => { runs.push(input); return new Error('Unexpected run'); },
      'OmnitronPipelines.updatePipeline': input => {
        const graph = XecPipeline.create(input.definition.name);
        for (const step of input.definition.steps) graph.step(step.name, { run: async () => {}, dependsOn: step.dependsOn });
        graph.validate();
        writes.push(input); stored = { ...stored, ...input.definition, revision: 'b'.repeat(64) };
        return stored;
      },
    });
    await page.addInitScript(() => localStorage.setItem('omnitron_active_project', 'example'));
    await page.route('**/pipelines', async route => route.fulfill({ response: await route.fetch({ url: url + '/workspace.html' }) }));
    await page.setViewportSize({ width, height: 940 });
    await page.goto(url + '/pipelines');
    await page.getByRole('button', { name: stored.name }).click();
    const dialog = page.getByRole('dialog');
    const edge = (from, to) => dialog.getByRole('group', { name: `${from} to ${to}`, exact: true });
    await expect(edge('inspect', 'publish')).toHaveCount(1);
    await expect(dialog.locator('.react-flow__edge')).toHaveCount(1);
    await dialog.getByRole('textbox', { name: 'Step name' }).fill('verify');
    await expect(edge('verify', 'publish')).toHaveCount(1);
    const choose = name => dialog.getByRole('tab', { name, exact: true }).click();
    if (width > 400) {
      const handle = async (name, port) => {
        const target = dialog.locator(`.react-flow__node[data-id="${name}"] .react-flow__handle.${port}`);
        await target.scrollIntoViewIfNeeded();
        const box = await target.boundingBox(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      };
      const from = await handle('publish', 'source'), to = await handle('report', 'target');
      await page.mouse.move(from.x, from.y); await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 14 }); await page.mouse.up();
    } else {
      await choose('report');
      await dialog.getByRole('combobox', { name: 'Add prerequisite for report' }).selectOption('publish');
      await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
    }
    await expect(edge('publish', 'report')).toHaveCount(1);
    if (width > 400) {
      const path = edge('publish', 'report').locator('.react-flow__edge-interaction');
      await path.scrollIntoViewIfNeeded();
      const point = await path.evaluate(line => {
        const middle = line.getPointAtLength(line.getTotalLength() / 2).matrixTransform(line.getScreenCTM());
        return { x: middle.x, y: middle.y };
      });
      await page.mouse.dblclick(point.x, point.y);
      await expect(edge('publish', 'report')).toHaveCount(0);
      await choose('report');
      await dialog.getByRole('combobox', { name: 'Add prerequisite for report' }).selectOption('publish');
      await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
      await expect(edge('publish', 'report')).toHaveCount(1);
    }
    await choose('verify');
    const prerequisites = dialog.getByRole('combobox', { name: 'Add prerequisite for verify' });
    await expect(prerequisites.locator('option[value="report"]')).toHaveCount(0);
    await expect(prerequisites.locator('option[value="publish"]')).toHaveCount(0);
    await prerequisites.focus();
    await prerequisites.press('o');
    await expect(prerequisites).toHaveValue('obsolete');
    const connect = dialog.getByRole('button', { name: 'Connect', exact: true });
    await prerequisites.press('Tab');
    await expect(connect).toBeFocused();
    await connect.press('Enter');
    await expect(edge('obsolete', 'verify')).toHaveCount(1);
    const remove = dialog.getByRole('button', { name: 'Remove dependency from obsolete to verify' });
    await remove.focus(); await remove.press('Enter');
    await expect(edge('obsolete', 'verify')).toHaveCount(0);
    await prerequisites.selectOption('obsolete');
    await connect.click();
    await dialog.getByRole('button', { name: 'Close obsolete' }).click();
    await expect(edge('obsolete', 'verify')).toHaveCount(0);
    const canvas = dialog.locator('.react-flow');
    await expect.poll(() => canvas.evaluate(element => {
      const viewport = element.getBoundingClientRect();
      const boxes = [...element.querySelectorAll('.react-flow__node')].map(node => node.getBoundingClientRect());
      const left = Math.min(...boxes.map(box => box.left)), right = Math.max(...boxes.map(box => box.right));
      const top = Math.min(...boxes.map(box => box.top)), bottom = Math.max(...boxes.map(box => box.bottom));
      return left >= viewport.left && right <= viewport.right && top >= viewport.top && bottom <= viewport.bottom &&
        Math.abs((left + right) - (viewport.left + viewport.right)) < 5 &&
        Math.abs((top + bottom) - (viewport.top + viewport.bottom)) < 5;
    })).toBe(true);
    expect(await dialog.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    await dialog.screenshot({ path: testInfo.outputPath('dependency-editor.png') });
    await dialog.getByRole('button', { name: 'Advanced JSON' }).click();
    const source = dialog.getByRole('textbox', { name: 'Steps JSON' });
    const accepted = JSON.parse(await source.inputValue());
    const cycle = structuredClone(accepted); cycle[0].dependsOn = ['report'];
    await source.fill(JSON.stringify(cycle));
    await dialog.getByRole('button', { name: 'Save definition' }).click();
    await expect(dialog.getByText(/A dependency cycle includes/)).toBeVisible();
    expect(writes).toHaveLength(0);
    await source.fill(JSON.stringify(accepted));
    await dialog.getByRole('button', { name: 'Step editor' }).click();
    await dialog.getByRole('button', { name: 'Save definition' }).click();
    await expect(dialog).toHaveCount(0);
    expect(writes).toHaveLength(1);
    expect(writes[0].expectedRevision).toBe(revision);
    expect(writes[0].definition).toEqual({ name: stored.name, description: stored.description, triggers,
      steps: [{ ...check, name: 'verify', dependsOn: [] }, { ...publish, dependsOn: ['verify'] }, { ...report, dependsOn: ['publish'] }] });
    await page.getByRole('button', { name: stored.name }).click();
    await expect(edge('verify', 'publish')).toHaveCount(1);
    await expect(edge('publish', 'report')).toHaveCount(1);
    await expect(dialog.locator('.react-flow__edge')).toHaveCount(2);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: `Run ${stored.name}` })).toBeVisible();
    expect(runs).toEqual([]);
  });
}

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
