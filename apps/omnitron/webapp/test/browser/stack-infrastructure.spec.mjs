import { test, expect, stubInventory } from './fixtures.mjs';

test('a stack displays remote infrastructure and keyboard-accessible declarations at mobile width', async ({ page, url }) => {
  const image = 'registry.example.internal/projects/distributed-platform/streams/collector:v2026.11.13';
  const infrastructure = { ready: false, services: { queue: {
    status: 'error', service: 'queue', containerName: 'sample-test-queue', port: 4222, image,
    provisioning: 'failed', error: 'Unable to initialize the queue.',
  } } };
  await stubInventory(page, {
    'OmnitronProject.listProjects': [{ name: 'sample', displayName: 'Sample', path: '/sample', totalStacks: 1, runningStacks: 1 }],
    'OmnitronProject.listStacks': [{ name: 'test', type: 'remote', status: 'degraded', apps: [], nodes: [], infrastructure,
      config: { type: 'remote', infrastructure: { services: { snapshots: { preset: 'minio', config: { buckets: ['proofs'] } } } } },
      placements: [{ nodeKey: 'queue.example.internal:9700', host: 'queue.example.internal', port: 9700, label: 'Worker', observedAt: null,
        appsObserved: true, apps: [], infrastructureObserved: true, infrastructure, errors: [] }] }],
  });
  await page.addInitScript(() => {
    localStorage.setItem('omnitron_active_project', 'sample');
    localStorage.setItem('omnitron_active_stack', 'test');
  });
  await page.route('**/stacks/test', async route => {
    if (route.request().resourceType() !== 'document') return route.continue();
    await route.fulfill({ response: await route.fetch({ url: url + '/workspace.html' }) });
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(url + '/stacks/test');
  const panel = page.getByRole('region', { name: 'Stack infrastructure' });
  await expect(panel.getByText('Unable to initialize the queue.')).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Worker · queue.example.internal:9700' })).toBeVisible();
  const summary = panel.locator('summary');
  await summary.focus();
  await summary.press('Enter');
  await expect(panel.getByText('Buckets · proofs')).toBeVisible();
  await expect(panel.getByText('Not observed')).toBeVisible();
  expect(await panel.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await summary.press('Enter');
  await expect(panel.getByText('Buckets · proofs')).toBeHidden();
});
