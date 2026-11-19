import { randomUUID } from 'node:crypto';
import { openSqliteDatabase } from '@omnitron-dev/titan-database/sqlite';
import { FlowLedger } from '../../../src/flows/flow-ledger.ts';
import { FlowRuntime } from '../../../src/flows/flow-runtime.ts';
import { diskSpaceFlow, evaluateFlow, FlowRegistry } from '../../../src/shared/dto/flows.ts';
import { expect, stubInventory, test } from './fixtures.mjs';

const project = { project: 'sample', stack: 'dev' };
const actor = { actor: 'reader', session: 'fixture-session' };
const binding = { identity: 'sample', target: null };
const diagnostic = 'An optional component pack could not be read.';
function controller(options = {}) {
  const db = openSqliteDatabase(':memory:');
  const registry = new FlowRegistry(undefined, [diagnostic]);
  const ledger = new FlowLedger(db, registry);
  const scopeBinding = options.binding ?? binding;
  const changes = [],
    previews = [];
  let lost = !!options.loseSubmission;
  const invoke = (method, operation) => (input) => {
    try {
      changes.push({ method, input });
      return operation(input);
    } catch (failure) {
      return failure;
    }
  };
  return {
    ledger,
    changes,
    previews,
    dispose: () => db.close(),
    readings: {
      'OmnitronFlows.list': ({ workspace }) => ledger.list(workspace),
      'OmnitronFlows.catalog': () => ({ nodes: registry.catalog(), diagnostics: registry.diagnostics }),
      'OmnitronFlows.preview': ({ definition, event, state }) => {
        try {
          const result = evaluateFlow(definition, event, state, registry);
          previews.push(result);
          return result;
        } catch (failure) {
          return failure;
        }
      },
      'OmnitronFlows.history': (ref) => ledger.history(ref, ref.limit),
      'OmnitronFlows.save': invoke('save', (data) => ledger.save(data, scopeBinding)),
      'OmnitronFlows.activate': invoke('activate', (data) => ledger.change(data, actor, scopeBinding)),
      'OmnitronFlows.deactivate': invoke('deactivate', (data) => ledger.change(data, actor, null)),
      'OmnitronFlows.submit': invoke('submit', (data) => {
        const receipt = ledger.submit(data, data.activation, data.event);
        if (lost) {
          lost = false;
          return new Error('Event acknowledgement unavailable');
        }
        return receipt;
      }),
      'OmnitronFlows.retryDelivery': invoke('retry', (data) =>
        ledger.retry(data, data.activation, data.delivery, actor)
      ),
    },
  };
}

async function connectInInspector(page, port, target) {
  await page.getByRole('combobox', { name: 'Output port' }).focus();
  await page.keyboard.press('Space');
  await page.getByRole('option', { name: port, exact: true }).click();
  await page.getByRole('combobox', { name: 'Target node' }).focus();
  await page.keyboard.press('Space');
  await page.getByRole('option', { name: target, exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Connect nodes' }).focus();
  await page.keyboard.press('Enter');
}

for (const width of [1440, 360]) {
  test(
    'disk template edits fields and branches and previews low/recovery at ' + width + 'px',
    async ({ page, context, url }) => {
      const host = controller();
      try {
        await stubInventory(context, host.readings);
        await page.setViewportSize({ width, height: 900 });
        await page.goto(url + '/projects/sample/flows?stack=dev');
        await expect(page.getByText('No saved flows in this workspace.')).toBeVisible();
        await expect(page.getByText(diagnostic)).toBeVisible();
        await page.getByRole('link', { name: 'Disk space template' }).click();
        const graph = page.getByRole('region', { name: 'Flow graph' });
        await expect(graph.locator('.react-flow__node')).toHaveCount(4);
        await expect(graph.locator('.react-flow__edge')).toHaveCount(3);
        await page.screenshot({ path: test.info().outputPath('disk-template.png') });
        const interval = page.getByRole('spinbutton', { name: 'Sample interval (ms)' });
        await interval.fill('500');
        await expect(page.getByText('Minimum 1000.')).toBeVisible();
        await page.getByRole('button', { name: 'Save draft' }).click();
        await expect(page.getByRole('alert').filter({ hasText: 'disk · Sample interval (ms)' })).toBeVisible();
        expect(host.changes).toEqual([]);
        await page.getByText('Minimum 1000.', { exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: test.info().outputPath('field-error.png') });
        await interval.fill('1500');
        const inspector = page.getByRole('combobox', { name: 'Inspect node' });
        await inspector.selectOption('threshold');
        await page.getByRole('button', { name: 'Disconnect threshold recovered from restored' }).click();
        await expect(graph.locator('.react-flow__edge')).toHaveCount(2);
        await connectInInspector(page, 'recovered', 'restored');
        await expect(graph.locator('.react-flow__edge')).toHaveCount(3);
        if (width > 1000) {
          await page.getByRole('button', { name: 'Disconnect threshold low from low' }).click();
          await expect(graph.locator('.react-flow__edge')).toHaveCount(2);
          await graph.scrollIntoViewIfNeeded();
          await page.evaluate(
            () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          );
          const from = await graph
            .locator('.react-flow__node[data-id="threshold"] .source[data-handleid="low"]')
            .boundingBox();
          const to = await graph.locator('.react-flow__node[data-id="low"] .target').boundingBox();
          await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
          await page.mouse.down();
          await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
          await page.mouse.up();
          await expect(graph.locator('.react-flow__edge')).toHaveCount(3);
        }
        await page.getByRole('button', { name: 'Preview event' }).click();
        await expect(page.getByText('Path · disk → threshold → low')).toBeVisible();
        const lowBranch = graph.locator('[data-id="threshold:low:low"] .react-flow__edge-path');
        const recovery = graph.locator('[data-id="threshold:recovered:restored"] .react-flow__edge-path');
        await expect(lowBranch).toHaveCSS('stroke-width', '3px');
        await expect(recovery).toHaveCSS('stroke-width', '1.5px');
        await expect(page.getByText('title · Disk space is low')).toBeVisible();
        await graph.screenshot({ path: test.info().outputPath('low-preview-graph.png') });
        await page.getByText('title · Disk space is low').scrollIntoViewIfNeeded();
        await page.screenshot({ path: test.info().outputPath('low-preview.png') });
        await page.getByRole('checkbox', { name: 'Use previous preview state' }).check();
        await page.getByRole('spinbutton', { name: 'Field 1 value', exact: true }).fill(String(20 * 1024 ** 3));
        await page.getByRole('button', { name: 'Preview event' }).click();
        await expect(page.getByText('Path · disk → threshold → restored')).toBeVisible();
        await expect(recovery).toHaveCSS('stroke-width', '3px');
        await expect(lowBranch).toHaveCSS('stroke-width', '1.5px');
        expect(host.changes).toEqual([]);
        await page.getByRole('button', { name: 'Save draft' }).click();
        await expect.poll(() => host.ledger.list(project).length).toBe(1);
        const saved = host.ledger.list(project)[0];
        await expect(page).toHaveURL(url + '/projects/sample/flows?flow=' + saved.id + '&stack=dev');
        await expect(page.getByText('Paused', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Review activation' }).click();
        const review = page.getByRole('dialog', { name: 'Activate flow' });
        await expect(review.getByText('intervalMs · 1500')).toBeVisible();
        await review.getByRole('button', { name: 'Cancel' }).click();
        expect(host.changes.map((e) => e.method)).toEqual(['save']);
        await page.reload();
        await expect(page.getByRole('textbox', { name: 'Flow name' })).toHaveValue('Disk space');
        await expect(page.getByRole('button', { name: 'Review live event' })).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      } finally {
        host.dispose();
      }
    }
  );
}

test('assemble a manual graph in the editor and review its active event and persisted delivery', async ({
  page,
  context,
  url,
}) => {
  const host = controller({ loseSubmission: true });
  try {
    await stubInventory(context, host.readings);
    await page.goto(url + '/flows');
    await page.getByRole('link', { name: 'New flow' }).click();
    await expect(page.getByText('Add a source from the node library to start the graph.')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('blank.png') });
    await page.getByRole('textbox', { name: 'Flow name' }).fill('Review incoming requests');
    const library = page.getByRole('combobox', { name: 'Node library' });
    await library.selectOption('input.manual@1');
    const add = page.getByRole('button', { name: 'Add node' });
    await add.click();
    await library.selectOption('output.pipeline@1');
    await add.click();
    await page.getByRole('textbox', { name: 'Pipeline ID' }).fill('example-pipeline');
    await page.getByRole('textbox', { name: 'Expected revision' }).fill('a'.repeat(64));
    await page.getByRole('textbox', { name: 'Node ID' }).fill('release-review');
    await page.getByRole('button', { name: 'Rename' }).click();
    await page.getByRole('combobox', { name: 'Inspect node' }).selectOption('manual');
    await connectInInspector(page, 'event', 'release-review');
    await page.getByRole('button', { name: 'Preview event' }).click();
    await expect(page.getByText('Request pipeline review · release-review')).toBeVisible();
    expect(host.changes).toEqual([]);
    await page.getByRole('button', { name: 'Save draft' }).click();
    await page.getByRole('button', { name: 'Review activation' }).click();
    await page.getByRole('dialog', { name: 'Activate flow' }).getByRole('button', { name: 'Activate flow' }).click();
    await expect(page.getByText('Active', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Preview event' }).click();
    await page.getByRole('button', { name: 'Review live event' }).click();
    const submit = page.getByRole('dialog', { name: 'Send live event' });
    await expect(submit.getByText('pipelineId · example-pipeline')).toBeVisible();
    expect(host.changes.map((e) => e.method)).toEqual(['save', 'activate']);
    await submit.getByRole('button', { name: 'Send live event' }).click();
    await expect(submit.getByText('Event acknowledgement unavailable', { exact: false })).toBeVisible();
    await submit.getByRole('button', { name: 'Send live event' }).click();
    await expect(submit).toHaveCount(0);
    const [first, second] = host.changes.filter((e) => e.method === 'submit');
    expect(first.input).toEqual(second.input);
    const ref = { id: first.input.id, workspace: { project: null } };
    const receipts = host.ledger.history(ref);
    expect(receipts).toHaveLength(1);
    const delivery = receipts[0].deliveries[0];
    host.ledger.finish(host.ledger.delivery(delivery.id).row, null, 'Adapter requires a new session');
    await page.reload();
    await page.getByText(/manual · manual · 1 effect/).click();
    await expect(page.getByText('example-pipeline · needs-review')).toBeVisible();
    await page.getByRole('button', { name: 'Review delivery retry' }).click();
    await page.getByRole('dialog', { name: 'Retry delivery' }).getByRole('button', { name: 'Retry delivery' }).click();
    await expect(page.getByText('example-pipeline · pending')).toBeVisible();
    host.ledger.finish(host.ledger.delivery(delivery.id).row, delivery.id, 'Check the existing native command', true);
    await page.reload();
    await page.getByText(/manual · manual · 1 effect/).click();
    await expect(page.getByText('Result · ' + delivery.id)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review delivery retry' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Review pause' }).click();
    await page.getByRole('dialog', { name: 'Pause flow' }).getByRole('button', { name: 'Pause flow' }).click();
    await expect(page.getByText('Paused', { exact: true })).toBeVisible();
    expect(host.ledger.get(ref).active).toBeNull();
    expect(host.ledger.history(ref)).toHaveLength(1);
  } finally {
    host.dispose();
  }
});

test('proposal and saved links resolve their owning stack in a new tab and with Back/Forward', async ({
  page,
  context,
  url,
}) => {
  const host = controller();
  const definition = diskSpaceFlow('/example', 100, 200);
  definition.name = 'Disk review';
  const team = randomUUID(),
    proposal = randomUUID();
  const assignment = { preferences: { role: 'analyst' }, selection: { model: 'test' } };
  const thread = {
    id: team,
    leadMemberId: team,
    title: 'Operations team',
    provider: 'codex',
    assignment,
    updatedAt: 1,
    stack: 'dev',
  };
  const member = { id: team, name: 'Reviewer', provider: 'codex', assignment, lead: true, active: true };
  const summary = { id: proposal, name: definition.name, authorId: team, createdAt: 1 };
  const readings = {
    ...host.readings,
    'OmnitronStudio.workspace': { account: 'reader', threads: [thread], catalogs: [], older: null },
    'OmnitronStudio.thread': {
      thread,
      team: {
        policy: { providers: ['codex'], maxMembers: 2, maxDelegations: 1, maxCostTier: 'standard' },
        members: [member],
        tasks: [],
        notes: [],
        proposals: [summary],
      },
      turns: [],
      beforeTurn: null,
    },
    'OmnitronStudio.flowProposal': (input) =>
      input.threadId === team && input.proposalId === proposal && input.project === 'sample'
        ? { definition, stack: 'dev' }
        : Error('Unknown proposal'),
  };
  try {
    await stubInventory(context, readings);
    await page.goto(url + '/projects/sample/studio?stack=dev&team=' + team);
    await page.getByRole('tab', { name: 'Flows' }).click();
    const link = page.getByRole('link', { name: 'Open in flow editor' });
    const href = await link.getAttribute('href');
    await link.click();
    await expect(page.getByRole('textbox', { name: 'Flow name' })).toHaveValue('Disk review');
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Operations team' })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole('textbox', { name: 'Flow name' })).toHaveValue('Disk review');
    const external = await context.newPage();
    await external.goto(url + href.replace('stack=dev', 'stack=other'));
    await expect(external).toHaveURL(url + href);
    await expect(external.getByRole('textbox', { name: 'Flow name' })).toHaveValue('Disk review');
    expect(host.changes).toEqual([]);
    await external.getByRole('button', { name: 'Save draft' }).click();
    await expect(external.getByRole('button', { name: 'Review activation' })).toBeVisible();
    const [saved] = host.ledger.list(project);
    const sameName = host.ledger.save(
      {
        id: randomUUID(),
        workspace: { project: 'sample', stack: 'other' },
        definition,
        expectedRevision: null,
      },
      binding
    );
    await external.goto(url + '/projects/sample/flows');
    const links = external.getByRole('link', { name: 'Disk review', exact: true });
    await expect(links).toHaveCount(2);
    expect(await links.evaluateAll((items) => items.map((item) => item.getAttribute('href')).sort())).toEqual(
      [
        '/projects/sample/flows?flow=' + saved.id + '&stack=dev',
        '/projects/sample/flows?flow=' + sameName.id + '&stack=other',
      ].sort()
    );
    await external.goto(url + '/projects/sample/flows?flow=' + saved.id);
    await expect(external).toHaveURL(url + '/projects/sample/flows?flow=' + saved.id + '&stack=dev');
    await external.goto(url + '/projects/sample/flows?flow=' + saved.id + '&stack=other');
    await expect(external.getByText('This flow is unavailable in the selected workspace.')).toBeVisible();
    await expect(external.getByRole('button', { name: 'Save draft' })).toHaveCount(0);
    expect(host.changes.map((e) => e.method)).toEqual(['save']);
    await external.close();
  } finally {
    host.dispose();
  }
});

test('local notifications follow the signed-in workspace while browsing another page', async ({
  page,
  context,
  url,
}) => {
  const host = controller();
  const readings = [];
  const sample = host.ledger.save(
    {
      id: randomUUID(),
      workspace: project,
      expectedRevision: null,
      definition: {
        version: 1,
        name: 'Notify operators',
        nodes: [
          { id: 'manual', type: 'input.manual@1', config: {} },
          { id: 'report', type: 'output.notify@1', config: { title: 'Disk reading available' } },
        ],
        edges: [{ from: 'manual', port: 'event', to: 'report' }],
      },
    },
    binding
  );
  const active = host.ledger.change({ ...sample, activation: null }, actor, binding).active;
  const event = () =>
    host.ledger.submit(sample, active.id, { id: randomUUID(), source: 'manual', type: 'manual', data: {} });
  event();
  try {
    await stubInventory(context, {
      ...host.readings,
      'OmnitronProject.listStacks': ['dev', 'other'].map((name) => ({ name, status: 'stopped', apps: [] })),
      'OmnitronFlows.notifications': (input) => {
        const result = host.ledger.notifications(input.workspace, input.after, input.limit);
        readings.push({ input, result });
        return result;
      },
    });
    await page.clock.install();
    await page.goto(url + '/projects/sample?stack=dev');
    await expect.poll(() => readings.some((r) => r.result.cursor > 0)).toBe(true);
    await expect(page.getByRole('alert').filter({ hasText: 'Disk reading available' })).toHaveCount(0);
    event();
    await page.clock.runFor(5100);
    const toast = page.getByRole('alert').filter({ hasText: 'Disk reading available' });
    await expect(toast).toBeVisible();
    await expect(toast.getByRole('link', { name: 'Open flow' })).toHaveAttribute(
      'href',
      '/projects/sample/flows?flow=' + sample.id + '&stack=dev'
    );
    await page.getByRole('combobox', { name: 'Stack filter' }).click();
    await page.getByRole('option', { name: /^other/ }).click();
    await expect(page).toHaveURL(url + '/projects/sample?stack=other');
    await expect(toast).toHaveCount(0);
    event();
    await page.clock.runFor(5100);
    await expect
      .poll(() => readings.some((r) => r.input.workspace.stack === 'other' && r.input.after === 0))
      .toBe(true);
    await expect(toast).toHaveCount(0);
  } finally {
    host.dispose();
  }
});

test('a Studio proposal reader can inspect all edges without privileged controller calls', async ({
  page,
  context,
  url,
}) => {
  const team = randomUUID(),
    proposal = randomUUID();
  const definition = diskSpaceFlow('/work', 20, 40);
  const called = [];
  context.on('request', (request) => {
    if (request.url().endsWith('/netron/invoke')) {
      const { service, method } = request.postDataJSON();
      if (service === 'OmnitronFlows') called.push(method);
    }
  });
  await stubInventory(context, { 'OmnitronStudio.flowProposal': { definition, stack: 'dev' } }, 'online', {
    grants: ['OmnitronStudio.flowProposal'],
  });
  const href = '/projects/sample/flows?team=' + team + '&proposal=' + proposal + '&stack=dev';
  await page.goto(url + href);
  await expect(page.getByRole('textbox', { name: 'Flow name' })).toHaveValue('Disk space');
  await expect(page.getByRole('region', { name: 'Flow graph' }).locator('.react-flow__edge')).toHaveCount(3);
  await page.getByRole('combobox', { name: 'Inspect node' }).selectOption('threshold');
  await expect(page.getByText('below · 20')).toBeVisible();
  await expect(page.getByRole('button', { name: /Save draft|Review activation|Add node|Preview event/ })).toHaveCount(
    0
  );
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Flows' })).toHaveCount(
    0
  );
  await expect(page.getByRole('link', { name: 'Flows', exact: true })).toHaveAttribute('href', href);
  expect(called).toEqual([]);
});

test('a Studio operator opens a proposal, edits its sample and previews it without access to live flows', async ({
  page,
  context,
  url,
}) => {
  const team = randomUUID(),
    proposal = randomUUID();
  const definition = diskSpaceFlow('/work', 10 * 1024 ** 3, 15 * 1024 ** 3);
  const assignment = { preferences: { role: 'analyst' }, selection: { model: 'test' } };
  const thread = {
    id: team,
    leadMemberId: team,
    title: 'Operator room',
    provider: 'codex',
    assignment,
    updatedAt: 1,
    stack: 'dev',
  };
  const member = { id: team, name: 'Coordinator', provider: 'codex', assignment, lead: true, active: true };
  const named = { id: proposal, name: definition.name, authorId: team, createdAt: 1 };
  const registry = new FlowRegistry();
  const calls = [];
  let releaseOld,
    waiting = false,
    hold = true;
  const delayed = new Promise((resolve) => {
    releaseOld = resolve;
  });
  const readings = {
    'OmnitronStudio.workspace': { account: 'reader', threads: [thread], catalogs: [], older: null },
    'OmnitronStudio.thread': {
      thread,
      team: {
        policy: { providers: ['codex'], maxMembers: 1, maxDelegations: 0, maxCostTier: 'standard' },
        members: [member],
        tasks: [],
        notes: [],
        proposals: [named],
      },
      turns: [],
      beforeTurn: null,
    },
    'OmnitronStudio.flowProposal': { definition, stack: 'dev' },
    'OmnitronFlows.catalog': { nodes: registry.catalog(), diagnostics: [] },
    'OmnitronFlows.preview': async ({ definition: draft, event, state }) => {
      const result = evaluateFlow(draft, event, state, registry);
      if (hold) {
        waiting = true;
        await delayed;
      }
      return result;
    },
  };
  context.on('request', (request) => {
    if (request.url().endsWith('/netron/invoke')) {
      const { service, method } = request.postDataJSON();
      if (service === 'OmnitronFlows') calls.push(method);
    }
  });
  await stubInventory(context, readings, 'online', { role: 'operator', grants: Object.keys(readings) });
  await page.goto(url + '/projects/sample/studio?stack=dev&team=' + team);
  await page.getByRole('tab', { name: 'Flows' }).click();
  await page.getByRole('link', { name: 'Open in flow editor' }).click();
  await expect(page.getByRole('textbox', { name: 'Flow name' })).toHaveValue('Disk space');
  const preview = page.getByRole('button', { name: 'Preview event' });
  try {
    await preview.click();
    await expect.poll(() => waiting).toBe(true);
    await page.getByRole('textbox', { name: 'Volume path' }).fill('/revised');
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/netron/invoke') && r.request().postDataJSON().method === 'preview'
    );
    hold = false;
    releaseOld();
    await response;
    await expect(page.getByText('Path · disk → threshold → low')).toHaveCount(0);
    await preview.click();
    await expect(page.getByText('Path · disk → threshold → low')).toBeVisible();
    await expect(page.getByText('title · Disk space is low')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('operator-proposal.png') });
    await expect(
      page.getByRole('button', { name: /Save draft|Review activation|Review live event|Review pause/ })
    ).toHaveCount(0);
    expect(calls.filter((method) => !['catalog', 'preview'].includes(method))).toEqual([]);
    expect(calls.filter((method) => method === 'preview')).toHaveLength(2);
  } finally {
    releaseOld();
  }
});

test('mesh disk observations keep their enrolled peer and exact mount through simulation, approval and history', async ({
  page,
  context,
  url,
}) => {
  const first = randomUUID(),
    second = randomUUID(),
    local = randomUUID();
  const selectedBinding = { ...binding, mesh: { [second]: 'second-registration' } };
  const host = controller({ binding: selectedBinding });
  const snapshotCalls = [];
  let releaseFormer;
  const formerReply = new Promise((resolve) => {
    releaseFormer = resolve;
  });
  let response = 'offline';
  const answer = (mounts, unanswered = {}) => ({
    timestamp: Date.now(),
    unanswered,
    disks: mounts.map((mount) => ({ mount, fs: 'filesystem', size: 100 * 1024 ** 3, available: 8 * 1024 ** 3 })),
    daemon: { role: 'slave' },
  });
  const directory = [
    { id: local, name: 'Controller', host: 'localhost', isLocal: true },
    { id: first, name: 'Worker', host: 'first.example', isLocal: false },
    { id: second, name: 'Worker', host: 'second.example', isLocal: false },
  ];
  try {
    await stubInventory(context, {
      ...host.readings,
      'OmnitronNodes.listNodes': directory,
      'OmnitronNodes.getNodeSystemSnapshot': async ({ nodeId }) => {
        snapshotCalls.push(nodeId);
        if (nodeId === first) return formerReply;
        if (nodeId !== second) return new Error('Unexpected node');
        if (response === 'offline') return new Error('Selected mesh peer is offline');
        if (response === 'partial') return answer(['/stale'], { disks: 'Remote storage collection timed out' });
        return answer(['/data', '/ambiguous', '/ambiguous']);
      },
    });
    await page.goto(url + '/projects/sample/flows?new=disk&stack=dev');
    await page.getByRole('combobox', { name: 'Disk location' }).click();
    await page.getByRole('option', { name: 'Enrolled node', exact: true }).click();
    const peer = page.getByRole('combobox', { name: 'Enrolled node' });
    await expect(peer.getByRole('option', { name: /Controller/ })).toHaveCount(0);
    await expect(peer.getByRole('option', { name: /second.example/ })).toHaveAttribute('value', second);
    await peer.selectOption(first);
    await expect.poll(() => snapshotCalls).toContain(first);
    await peer.selectOption(second);
    await expect(page.getByText(/Mount inventory unavailable.*Selected mesh peer is offline/)).toBeVisible();
    const previousSnapshot = page.waitForResponse((r) => {
      if (!r.url().endsWith('/netron/invoke')) return false;
      const body = r.request().postDataJSON();
      return body.method === 'getNodeSystemSnapshot' && body.input[0].nodeId === first;
    });
    releaseFormer(answer(['/first-only']));
    await previousSnapshot;
    const mounts = page.getByRole('combobox', { name: 'Mounted filesystem' });
    await expect(mounts.getByRole('option', { name: /first-only/ })).toHaveCount(0);
    response = 'partial';
    await page.getByRole('button', { name: 'Retry mounts' }).click();
    await expect(page.getByText(/Mount inventory unavailable.*Remote storage collection timed out/)).toBeVisible();
    await expect(mounts.getByRole('option', { name: '/stale' })).toHaveCount(0);
    response = 'online';
    await page.getByRole('button', { name: 'Retry mounts' }).click();
    await expect(mounts.getByRole('option', { name: /ambiguous mount/ })).toBeDisabled();
    await mounts.selectOption('/data');
    await expect(page.getByText('Mesh · /data')).toBeVisible();
    await page.setViewportSize({ width: 360, height: 850 });
    await mounts.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath('mesh-mount-mobile.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Preview event' }).click();
    await expect(page.getByText('Path · disk → threshold → low')).toBeVisible();
    expect(host.previews.at(-1).effects[0].data).toMatchObject({
      nodeId: second,
      mount: '/data',
      freeBytes: 5 * 1024 ** 3,
      totalBytes: 100 * 1024 ** 3,
    });
    expect(host.changes).toEqual([]);
    expect(snapshotCalls).toEqual([first, second, second, second]);
    await page.getByRole('button', { name: 'Save draft' }).click();
    await page.getByRole('button', { name: 'Review activation' }).click();
    const review = page.getByRole('dialog', { name: 'Activate flow' });
    await expect(review.getByText('nodeId · ' + second)).toBeVisible();
    await expect(review.getByText('mount · /data')).toBeVisible();
    await expect(review.getByText(/This controller records events and dispatches/)).toBeVisible();
    await review.getByRole('button', { name: 'Activate flow' }).click();
    await expect(page.getByText('Active', { exact: true })).toBeVisible();
    const actualReads = [];
    const runtime = new FlowRuntime(host.ledger, {
      admit: async () => {},
      scope: async (workspace, ids) => {
        expect(workspace).toEqual(project);
        expect(ids).toEqual([second]);
        return selectedBinding;
      },
      mesh: {
        identity: (id) => selectedBinding.mesh[id],
        snapshot: async (id) => {
          actualReads.push(id);
          return answer(['/data']);
        },
      },
      readDisk: async () => {
        throw Error('Unexpected controller disk read');
      },
      deliver: async () => {
        throw Error('This flow only records local notifications');
      },
      report: (error) => {
        throw error;
      },
    });
    try {
      await runtime.tick();
    } finally {
      await runtime.dispose();
    }
    expect(actualReads).toEqual([second]);
    await page.reload();
    await page.getByText(/disk · mesh.disk.sample · 1 effect/).click();
    await expect(
      page.getByText('Disk observation from /data on enrolled node ' + second + '. Recorded by this controller.')
    ).toBeVisible();
    await expect(page.getByText('Disk space is low · delivered')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review live event' })).toHaveCount(0);
    await page.getByText('Disk space is low · delivered').scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath('mesh-receipt.png') });
  } finally {
    releaseFormer(answer([]));
    host.dispose();
  }
});
