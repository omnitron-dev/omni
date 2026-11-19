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
  await page.getByRole('link', { name: /Image review/ }).click();
  await expect(page.getByText('Blueprint', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Reference document' })).toHaveAttribute(
    'href',
    'https://external-preview.invalid/reference'
  );
  expect(contacted).toEqual([]);
});

for (const width of [1280, 360]) {
  test(
    'work with separate team members, their shared tasks and memory at ' + width + 'px',
    async ({ page, context, url }) => {
      const catalogs = [
        { provider: 'codex', connector: 'primary', model: 'lead-model' },
        { provider: 'agy', connector: 'secondary', model: 'review-model' },
      ].map(({ provider, connector, model }) => ({
        provider,
        connector,
        revision: 'catalog-1',
        teamTools: provider === 'codex',
        models: [
          {
            id: model,
            label: model,
            classes: ['general', 'reasoning', 'code'],
            qualityTier: 'standard',
            costTier: 'economy',
            price: null,
            capabilities: [],
          },
        ],
      }));
      const assignment = (input) => ({
        preferences: input.preferences,
        selection: {
          provider: input.provider,
          model: catalogs.find((c) => c.provider === input.provider).models[0].id,
        },
      });
      const members = [],
        turns = [],
        notes = [],
        sent = [],
        canceled = [],
        writes = [];
      const team = { members, notes, tasks: [], proposals: [] };
      let thread,
        firstReplyLost = true;
      const readings = {
        'OmnitronStudio.workspace': () => ({
          account: 'reader',
          catalogs,
          threads: thread ? [thread] : [],
          older: null,
        }),
        'OmnitronStudio.thread': ({ includeTasks }) => ({
          thread,
          turns,
          beforeTurn: null,
          team: {
            ...team,
            hasActiveTurns: turns.some((item) => ['queued', 'running'].includes(item.status)),
            tasks: includeTasks ? team.tasks : [],
          },
        }),
        'OmnitronStudio.createTeam': (input) => {
          expect(input.project).toBe('sample');
          expect(input.stack).toBe('dev');
          expect(input.policy).toMatchObject({ maxMembers: 3, maxDelegations: 2, maxCostTier: 'economy' });
          thread = {
            id: input.threadId,
            leadMemberId: input.threadId,
            title: input.title,
            stack: input.stack,
            provider: input.provider,
            assignment: assignment(input),
            updatedAt: 1,
          };
          members.push({
            id: thread.id,
            name: input.name,
            lead: true,
            active: true,
            provider: input.provider,
            assignment: assignment(input),
          });
          team.policy = input.policy;
          return { threadId: thread.id };
        },
        'OmnitronStudio.addMember': (input) => {
          members.push({
            id: input.memberId,
            name: input.name,
            lead: false,
            active: true,
            provider: input.provider,
            assignment: assignment(input),
          });
          thread.updatedAt++;
          return { memberId: input.memberId };
        },
        'OmnitronStudio.retireMember': (input) => {
          members.find((item) => item.id === input.memberId).active = false;
          return null;
        },
        'OmnitronStudio.post': (input) => {
          sent.push(input);
          let turn = turns.find((item) => item.id === input.turnId);
          if (!turn) {
            turn = {
              id: input.turnId,
              prompt: input.text,
              answer: '',
              authorId: null,
              memberId: input.memberId,
              status: 'queued',
              failure: null,
              usage: null,
              review: null,
              originId: null,
              kind: input.kind,
              createdAt: ++thread.updatedAt,
            };
            turns.push(turn);
            if (input.kind === 'task') team.tasks.push(turn);
          }
          if (firstReplyLost) {
            firstReplyLost = false;
            return new Error('Delivery acknowledgement unavailable');
          }
          return { threadId: thread.id, turnId: turn.id };
        },
        'OmnitronStudio.cancel': (input) => {
          canceled.push(input);
          turns.find((item) => item.id === input.turnId).status = 'cancelled';
          return { status: 'cancelled' };
        },
        'OmnitronStudio.writeNote': (input) => {
          writes.push(input);
          const prior = notes.find((item) => item.key === input.key);
          expect(input.revision).toBe(prior?.revision ?? 0);
          const note = {
            key: input.key,
            text: input.text,
            authorId: null,
            revision: input.revision + 1,
            updatedAt: Date.now(),
          };
          if (prior) Object.assign(prior, note);
          else notes.push(note);
          return note;
        },
        'OmnitronStudio.configureTeam': () => null,
        'OmnitronStudio.flowProposal': () => new Error('Only the flow editor loads the proposal'),
      };
      await stubInventory(context, readings);
      await page.setViewportSize({ width, height: 850 });
      await page.goto(url + '/projects/sample/studio?stack=dev');
      await page.getByRole('textbox', { name: 'Team name', exact: true }).fill('Release planning');
      await page.getByRole('textbox', { name: 'Lead name', exact: true }).fill('Coordinator');
      await page.getByRole('button', { name: 'Team limits' }).click();
      await page.getByLabel('Maximum members').fill('3');
      await page.getByLabel('Maximum delegations').fill('2');
      await page.getByRole('button', { name: 'Create team' }).click();
      await expect(page.getByRole('heading', { name: 'Release planning' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Coordinator · Lead' })).toBeVisible();
      expect(sent).toEqual([]);
      await expect(page).toHaveURL(new RegExp('team=' + thread.id));
      const chat = page.getByRole('tab', { name: 'Chat', exact: true });
      await page.getByRole('tab', { name: 'Members' }).click();
      await page.getByRole('button', { name: 'Add member', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Add team member' });
      await dialog.getByRole('textbox', { name: 'Member name', exact: true }).fill('Reviewer');
      await dialog.getByRole('combobox', { name: 'Adapter' }).click();
      await page.getByRole('option', { name: 'Antigravity' }).click();
      await dialog.getByRole('combobox', { name: 'Responsibility' }).click();
      await page.getByRole('option', { name: 'reviewer' }).click();
      await dialog.getByRole('combobox', { name: 'Model' }).click();
      await page.getByRole('option', { name: 'review-model' }).click();
      await dialog.getByRole('button', { name: 'Add member' }).click();
      await expect(page.getByText('reviewer · Antigravity · review-model')).toBeVisible();
      await expect(page.getByText('analyst · Codex · lead-model')).toBeVisible();
      await page.screenshot({ path: test.info().outputPath('members.png') });
      await page.getByRole('tab', { name: 'Tasks' }).click();
      await page.getByRole('combobox', { name: 'Recipient' }).click();
      await page.getByRole('option', { name: 'Reviewer' }).click();
      await page.getByLabel('Task', { exact: true }).fill('Review retry behavior.');
      await page.getByRole('button', { name: 'Assign task', exact: true }).click();
      await expect(page.getByText('Delivery acknowledgement unavailable', { exact: false }).first()).toBeVisible();
      await page.getByRole('button', { name: 'Retry same request' }).click();
      await expect(page.getByText('Operator → Reviewer · Task')).toBeVisible();
      await page.screenshot({ path: test.info().outputPath('assigned-task.png') });
      expect(sent).toHaveLength(2);
      expect(sent[0]).toEqual(sent[1]);
      await chat.click();
      await page.getByRole('combobox', { name: 'Recipient' }).click();
      await page.getByRole('option', { name: 'Coordinator · Lead' }).click();
      await page
        .getByRole('textbox', { name: 'Message', exact: true })
        .fill('Check another item while the review is queued.');
      await page.getByRole('button', { name: 'Send message', exact: true }).click();
      await expect(page.getByText('Operator → Coordinator', { exact: true })).toBeVisible();
      expect(sent[2].memberId).toBe(thread.leadMemberId);
      await page.getByRole('tab', { name: 'Tasks' }).click();
      await page.getByRole('tabpanel', { name: 'Tasks' }).getByRole('button', { name: 'Stop turn' }).click();
      await expect(page.getByText('cancelled', { exact: true })).toBeVisible();
      expect(canceled[0].turnId).toBe(sent[0].turnId);
      await chat.click();
      await expect(page.getByText('Review retry behavior.', { exact: true })).toBeVisible();
      await page.getByRole('tab', { name: 'Memory' }).click();
      await page.getByRole('button', { name: 'Add note' }).click();
      await page.getByRole('textbox', { name: 'Note key' }).fill('target');
      await page.getByRole('textbox', { name: 'Shared note' }).fill('Keep the current stack.');
      await page.getByRole('button', { name: 'Save note' }).click();
      await page.getByRole('button', { name: 'Edit target' }).click();
      await page.getByRole('textbox', { name: 'Shared note' }).fill('Use the reviewed stack.');
      await page.getByRole('button', { name: 'Save note' }).click();
      await expect(page.getByText('Operator · revision 2')).toBeVisible();
      expect(writes.map((item) => item.revision)).toEqual([0, 1]);
      team.proposals.push({ id: 'proposal-one', authorId: members[1].id, name: 'Run checks', createdAt: Date.now() });
      await page.reload();
      await page.getByRole('tab', { name: 'Flows' }).click();
      const flow = page.getByRole('link', { name: 'Open in flow editor' });
      const destination = new URL(await flow.getAttribute('href'), url);
      expect(destination.pathname).toBe('/projects/sample/flows');
      expect(Object.fromEntries(destination.searchParams)).toEqual({
        team: thread.id,
        proposal: 'proposal-one',
        stack: 'dev',
      });
      await page.getByRole('tab', { name: 'Memory' }).click();
      await expect(page.getByText('Use the reviewed stack.')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  );
}

test('a shared team URL opens the journal read-only with its original senders and pending tasks', async ({
  page,
  context,
  url,
}) => {
  const id = '1aa3ca1c-3581-4c33-a1ec-60e2f3814354';
  const assignment = { preferences: { role: 'analyst' }, selection: { model: 'example-model' } };
  const thread = {
    id,
    leadMemberId: id,
    title: 'Review team',
    provider: 'codex',
    assignment,
    updatedAt: 2,
    stack: 'dev',
  };
  const member = { id: 'reviewer', name: 'Reviewer', active: true, lead: false, provider: 'agy', assignment };
  const task = {
    id: 'task',
    memberId: member.id,
    authorId: id,
    kind: 'task',
    prompt: 'Check the original note.',
    answer: '',
    originId: null,
    createdAt: 1,
    status: 'queued',
    failure: null,
    review: null,
    usage: null,
  };
  const team = {
    policy: { providers: ['codex', 'agy'], maxCostTier: 'economy', maxMembers: 2, maxDelegations: 2 },
    members: [{ ...member, id, name: 'Lead', provider: 'codex', lead: true }, member],
    tasks: [task],
    notes: [],
    proposals: [],
  };
  const calls = [];
  context.on('request', (request) => {
    if (request.url().endsWith('/netron/invoke')) calls.push(request.postDataJSON().method);
  });
  await stubInventory(
    context,
    {
      'OmnitronStudio.workspace': { account: 'reader', catalogs: [], threads: [thread], older: null },
      'OmnitronStudio.thread': { thread, team, turns: [task], beforeTurn: null },
    },
    'online',
    { grants: ['OmnitronStudio.workspace', 'OmnitronStudio.thread'] }
  );
  await page.goto(url + '/projects/sample/studio?stack=other&team=' + id);
  await expect(page).toHaveURL(url + '/projects/sample/studio?stack=dev&team=' + id);
  await expect(page.getByRole('heading', { name: 'Review team' })).toBeVisible();
  await expect(page.getByText('Lead → Reviewer · Task')).toBeVisible();
  await expect(page.getByRole('button', { name: /^(New team|Stop turn|Send message|Review result)$/ })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Members' }).click();
  await expect(page.getByRole('button', { name: /Add member|Retire|Team limits/ })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Tasks' }).click();
  await expect(page.getByText('Check the original note.')).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  expect(
    calls.filter((method) =>
      ['post', 'cancel', 'review', 'listStacks', 'listProjects', 'addMember', 'writeNote'].includes(method)
    )
  ).toEqual([]);
});

test('the journal follows off-page work while task bodies load only on the Tasks tab', async ({
  page,
  context,
  url,
}) => {
  const id = '1aa3ca1c-3581-4c33-a1ec-60e2f3814354';
  const assignment = { preferences: { role: 'analyst' }, selection: { model: 'test' } };
  const thread = {
    id,
    leadMemberId: id,
    title: 'Background work',
    provider: 'codex',
    assignment,
    updatedAt: 1,
    stack: 'dev',
  };
  const member = { id, name: 'Lead', provider: 'codex', assignment, lead: true, active: true };
  const turn = {
    id: 'work',
    memberId: id,
    authorId: null,
    kind: 'task',
    prompt: 'Read the earlier assignment.',
    answer: '',
    originId: null,
    status: 'running',
    createdAt: 1,
    failure: null,
    review: null,
    usage: null,
  };
  const calls = [];
  await stubInventory(context, {
    'OmnitronStudio.workspace': { account: 'reader', threads: [thread], catalogs: [], older: null },
    'OmnitronStudio.thread': ({ includeTasks }) => {
      calls.push(includeTasks);
      return {
        thread,
        turns: [],
        beforeTurn: null,
        team: {
          hasActiveTurns: true,
          policy: { providers: ['codex'], maxMembers: 1, maxDelegations: 0, maxCostTier: 'standard' },
          members: [member],
          notes: [],
          proposals: [],
          tasks: includeTasks ? [turn] : [],
        },
      };
    },
    'OmnitronStudio.post': () => new Error('This scenario keeps its draft.'),
  });
  await page.clock.install();
  await page.goto(url + '/projects/sample/studio?stack=dev&team=' + id);
  await expect(page.getByText('No messages yet.')).toBeVisible();
  const message = page.getByRole('textbox', { name: 'Message', exact: true });
  await message.fill('Keep this text while checking the task list.');
  await page.clock.runFor(3400);
  await expect.poll(() => calls.length).toBeGreaterThanOrEqual(2);
  expect(calls.every((value) => value === false)).toBe(true);
  await page.getByRole('tab', { name: 'Tasks' }).click();
  await expect(page.getByText('Read the earlier assignment.')).toBeVisible();
  expect(calls.at(-1)).toBe(true);
  await expect(page).toHaveURL(/tab=tasks/);
  await page.goBack();
  await expect(message).toHaveValue('Keep this text while checking the task list.');
  await expect.poll(() => calls.at(-1)).toBe(false);
  await page.goForward();
  await expect(page.getByText('Read the earlier assignment.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Read the earlier assignment.')).toBeVisible();
  expect(calls.at(-1)).toBe(true);
});
