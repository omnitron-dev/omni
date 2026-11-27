import { expect, stubInventory, test } from './fixtures.mjs';

const release = 'example-202608041224-ababbbbb-dededddd';
const node = { nodeId: 'edge-node', label: 'Northern region', role: 'app', host: 'edge.invalid', port: 9700 };
const stack = { name: 'dev', type: 'remote', status: 'running', apps: [], nodes: [], config: { type: 'remote', nodes: [node] } };
const at = '2026-08-04T12:24:00Z';
const path = '/projects/example/deployments?stack=dev';
const preparation = { project: 'example', stack: 'dev', release, nodeId: node.nodeId, manifestSha256: 'a'.repeat(64),
  attemptId: 'prepare-one', startedAt: at, finishedAt: at, state: 'refused', reason: 'Previous installation is still recorded.',
  fileTransferId: 'transfer-for-release', producer: { builtAt: at, gates: [{ name: 'compile', status: 'passed' }], logs: ['gates.log', 'gate-logs/compile.log'] } };

for (const width of [390, 1280]) test('shows completed delivery and blocked registration in one deployment at ' + width + 'px', async ({ page, url }) => {
  const logs = [];
  let sourceAvailable = true;
  await stubInventory(page, {
    'OmnitronProject.listStacks': [stack], 'OmnitronProject.getDeployProgress': [],
    'OmnitronProject.listRemoteReleasePreparations': () => sourceAvailable ? [preparation] : new Error('Controller is reconnecting'),
    'OmnitronFiles.stackNodeTransfers': { nodeId: node.nodeId, transfers: [
      { id: 'transfer-for-release', state: 'completed', phase: 'publishing', bytes: 512, totalBytes: 512,
        completedFiles: 3, totalFiles: 3, updatedAt: at },
      { id: 'other-project', state: 'running', phase: 'transferring', bytes: 4, totalBytes: 8, updatedAt: at },
    ] },
    'OmnitronProject.readRemoteReleasePreparationLog': input => {
      logs.push(input);
      return { name: input.name, bytes: 34, tail: input.name === 'gates.log' ? 'Build checks passed' : 'Compiler finished' };
    },
  });
  await page.setViewportSize({ width, height: 880 });
  await page.goto(url + path);
  const activity = page.getByRole('region', { name: 'Deployment activity' });
  await expect(activity.getByRole('heading', { name: node.label })).toBeVisible();
  await expect(activity).toContainText('Registration blocked');
  await expect(activity.getByRole('alert')).toContainText(preparation.reason);
  await expect(activity.getByRole('tab', { name: 'Launch · No report' })).toHaveAttribute('aria-selected', 'false');
  await activity.getByRole('tab', { name: 'Delivery · Complete' }).click();
  await expect(activity.getByRole('tabpanel')).toContainText('3 / 3 files');
  await expect(activity).not.toContainText('other-project');
  await activity.getByRole('tab', { name: 'Build · Built' }).click();
  await expect(activity.getByLabel('Saved build output')).toHaveText('Build checks passed');
  await activity.getByRole('combobox', { name: 'Build log' }).click();
  await page.getByRole('option', { name: 'gate-logs/compile.log' }).click();
  await expect(activity.getByLabel('Saved build output')).toHaveText('Compiler finished');
  expect(logs.at(-1)).toMatchObject({ project: 'example', stack: 'dev', attemptId: preparation.attemptId, name: 'gate-logs/compile.log' });
  await activity.getByRole('button', { name: 'Follow current stage' }).click();
  await expect(activity.getByRole('tab', { name: 'Registration · Blocked' })).toHaveAttribute('aria-selected', 'true');
  sourceAvailable = false;
  await page.getByRole('button', { name: 'Refresh deployments' }).click();
  await expect(activity).toContainText('Updates unavailable');
  await expect(activity).toContainText(preparation.reason);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('keeps a live producer log still while reading and resumes at the latest output', async ({ page, url }) => {
  let output = 'first build line';
  const run = { id: 'producer-run', pipelineId: 'build-pipeline', status: 'running', startedAt: at, completedAt: null,
    triggeredBy: 'operator', activity: { kind: 'build', project: 'example', stack: 'dev', nodeId: 'builder',
      projectCommit: 'a'.repeat(40), omniCommit: 'b'.repeat(40) } };
  await stubInventory(page, {
    'OmnitronProject.listStacks': [stack], 'OmnitronProject.getDeployProgress': [],
    'OmnitronPipelines.listWorkspace': { definitions: [], runs: [run] },
    'OmnitronPipelines.getRunStatus': () => ({ ...run, steps: [{ name: 'compile', status: 'running', duration: 50, output }] }),
  });
  await page.goto(url + path);
  const activity = page.getByRole('region', { name: 'Deployment activity' });
  await expect(activity.getByLabel('compile stdout', { exact: true })).toHaveText(output);
  await activity.getByRole('button', { name: 'Pause compile stdout' }).click();
  const updated = page.waitForResponse(async response => response.url().endsWith('/netron/invoke') &&
    response.request().postDataJSON()?.method === 'getRunStatus' && (await response.text()).includes('second build line'));
  output += '\nsecond build line';
  await updated;
  await expect(activity.getByLabel('compile stdout', { exact: true })).toHaveText('first build line');
  await activity.getByRole('button', { name: 'Resume compile stdout' }).click();
  await expect(activity.getByLabel('compile stdout', { exact: true })).toContainText('second build line');
});
