import { expect, test, stubInventory } from './fixtures.mjs';

for (const width of [1280, 360]) {
  test('assign and review a private Studio project brief at ' + width + 'px', async ({ page, url }) => {
    const model = {
      id: 'fixture-base',
      label: 'Fixture Base',
      classes: ['general'],
      qualityTier: 'standard',
      costTier: 'economy',
      price: null,
      capabilities: [],
    };
    const catalog = { provider: 'codex', connector: 'test', revision: 'r1', models: [model] };
    const threads = [];
    const turns = [];
    const requests = [];
    const contacts = [];
    const plans = [];
    await page.route('**/external-preview.invalid/**', (route) => {
      contacts.push(route.request().url());
      return route.abort();
    });
    await stubInventory(page, {
      'OmnitronProject.listProjects': [],
      'OmnitronStudio.workspace': () => ({ account: 'reader', catalogs: [catalog], threads, older: null }),
      'OmnitronStudio.thread': () => ({ thread: threads[0], turns, beforeTurn: null }),
      'OmnitronStudio.send': (request) => {
        requests.push(request);
        threads.push({
          id: request.threadId,
          title: 'Private project brief',
          stack: null,
          provider: 'codex',
          updatedAt: 10,
          assignment: {
            preferences: request.preferences,
            selection: {
              provider: 'codex',
              connector: 'test',
              catalogRevision: 'r1',
              model: model.id,
              mode: 'automatic',
              basis: 'declared-tier',
              qualityTier: 'standard',
              costTier: 'economy',
              price: null,
            },
          },
        });
        turns.push({
          id: request.turnId,
          prompt: request.prompt,
          status: 'completed',
          answer:
            '![Reference](https://external-preview.invalid/image.png)\n\n' +
            '\x60\x60\x60json\n{"automation":true,"persistence":"sqlite","service":"none"}\n\x60\x60\x60',
          failure: null,
          createdAt: 10,
          review: null,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: null, charge: null },
        });
        return { threadId: request.threadId, turnId: request.turnId };
      },
      'OmnitronStudio.review': (data) => {
        turns[0].review = { outcome: data.outcome, note: data.note, at: 11 };
        return null;
      },
      'OmnitronProject.reviewProjectCreation': (request) => {
        plans.push(request);
        return {
          name: request.name,
          path: '/projects/' + request.name,
          digest: 'fixture-review',
          files: [],
          effects: [],
          manifest: {
            name: request.name,
            needs: request.needs,
            dependencies: { '@xec-sh/core': '0.13.2', '@kysera/executor': '0.10.2' },
            commands: { task: 'node task.js' },
            stack: null,
            app: null,
          },
        };
      },
      'OmnitronProject.createProject': () => new Error('A Studio suggestion must be reviewed in the project wizard'),
    });
    await page.route('**/studio', async (route) =>
      route.fulfill({ response: await route.fetch({ url: url + '/workspace.html' }) })
    );
    await page.setViewportSize({ width, height: 900 });
    await page.goto(url + '/studio');
    await page.getByRole('button', { name: 'Plan a project' }).click();
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
    await expect(page.getByRole('heading', { name: 'Project interview' })).toBeVisible();
    await page
      .getByLabel('Message', { exact: true })
      .fill('Create a local report from a SQLite database. Use Xec to run it.');
    await page.getByRole('combobox', { name: 'Model', exact: true }).click();
    await page.getByRole('option', { name: 'Automatic · budgeted' }).click();
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText('Input 10 · output 5 tokens')).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      project: null,
      preferences: { purpose: 'project-interview', role: 'analyst', requirements: { maxCostTier: 'economy' } },
    });
    await page.getByRole('button', { name: 'Review result' }).click();
    await page.getByLabel('Review note').fill('The starter matches the two requested capabilities.');
    await page.getByRole('button', { name: 'Accept result' }).click();
    await expect(page.getByText('Accepted', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review project starter' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(contacts).toEqual([]);
    await page.getByRole('button', { name: 'Review project starter' }).click();
    await expect(page).toHaveURL(/\/projects\?create=1&automation=1&persistence=sqlite&service=none/);
    const wizard = page.getByRole('dialog', { name: 'Create project' });
    await expect(wizard.getByRole('checkbox', { name: 'Run automation with Xec' })).toBeChecked();
    await expect(wizard.getByRole('combobox', { name: 'Where should the project store data?' })).toHaveText(
      'SQLite file'
    );
    await expect(wizard.getByRole('combobox', { name: 'Which service should Omnitron supervise?' })).toHaveText(
      'None · standalone commands'
    );
    await wizard.getByLabel('Project name').fill('weekly-report');
    await wizard.getByRole('button', { name: 'Review starter' }).click();
    await expect(wizard.getByText(/Runtime dependencies/)).toContainText('@kysera/executor');
    expect(plans).toEqual([
      { name: 'weekly-report', needs: { automation: true, persistence: 'sqlite', service: 'none' } },
    ]);
  });
}

test('private HTML can display a reference without fetching its embedded resources', async ({ page, url }) => {
  const contacted = [];
  await page.route('**/external-preview.invalid/**', (route) => {
    contacted.push(route.request().url());
    return route.abort();
  });
  const thread = {
    id: '1aa3ca1c-3581-4c33-a1ec-60e2f3814354',
    title: 'Image review',
    provider: 'codex',
    stack: null,
    updatedAt: 1,
    assignment: {
      preferences: { role: 'reviewer', result: 'review', model: 'model', requirements: {} },
      selection: { model: 'model' },
    },
  };
  const turn = {
    id: 'f4c25276-eb33-4ae4-a9e0-2a156625827d',
    createdAt: 1,
    prompt: 'Review the illustration.',
    status: 'completed',
    failure: null,
    usage: null,
    review: null,
    answer:
      '<p><picture><source srcset="https://external-preview.invalid/large.png"><img src="https://external-preview.invalid/small.png" alt="Blueprint"></picture> <a href="https://external-preview.invalid/reference">Reference document</a></p>',
  };
  await stubInventory(page, {
    'OmnitronStudio.workspace': () => ({ account: 'reader', catalogs: [], threads: [thread], older: null }),
    'OmnitronStudio.thread': () => ({ thread, turns: [turn], beforeTurn: null }),
  });
  await page.route('**/studio', async (route) =>
    route.fulfill({ response: await route.fetch({ url: url + '/workspace.html' }) })
  );
  await page.goto(url + '/studio');
  await page.getByRole('button', { name: /Image review/ }).click();
  await expect(page.getByText('Blueprint', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Reference document' })).toHaveAttribute(
    'href',
    'https://external-preview.invalid/reference'
  );
  expect(contacted).toEqual([]);
});
