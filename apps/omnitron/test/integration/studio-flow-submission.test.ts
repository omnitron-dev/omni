import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, it, vi } from 'vitest';
import { FlowLedger } from '../../src/flows/flow-ledger.js';
import { FlowsRpcService } from '../../src/flows/flows.rpc-service.js';
import { flowWorkspaceReader, hostFlowRuntime } from '../../src/flows/host-flow-runtime.js';
import { runWithAuth } from '../../src/services/auth-context.js';
import type { FlowDefinition, OmnitronAuthUser } from '../../src/shared/dto/services.js';
import { studioCatalogFromListing } from '../../src/shared/dto/studio-policy.js';
import { StudioLedger } from '../../src/studio/ledger.js';
import { StudioRpcService } from '../../src/studio/studio.rpc-service.js';

const role = { author: 'operator', reviewer: 'admin' } as const;
const as = <T>(account: keyof typeof role, call: () => Promise<T>) =>
  runWithAuth(
    { userId: account, roles: [role[account]], permissions: [], metadata: { sessionId: 'login-' + account } },
    call
  );
const local = <T>(call: () => Promise<T>) =>
  runWithAuth(
    { userId: 'omnitron-local', roles: ['admin'], permissions: [], metadata: { source: 'local-unix-socket' } },
    call
  );

it('hands one private proposal to a different administrator for review and retains its original receipt', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-flow-review-'));
  const replacement = join(directory, 'replacement');
  const project = 'reports',
    stack = 'dev',
    workspace = { project, stack };
  const room = { project, threadId: randomUUID() };
  const definition: FlowDefinition = {
    version: 1,
    name: 'Review notice',
    nodes: [
      { id: 'request', type: 'input.manual@1', config: {} },
      { id: 'notify', type: 'output.notify@1', config: { title: 'Review requested' } },
      {
        id: 'followup',
        type: 'output.studio@1',
        config: { threadId: room.threadId, memberId: room.threadId, task: 'Review the notice' },
      },
    ],
    edges: [
      { from: 'request', to: 'notify', port: 'event' },
      { from: 'request', to: 'followup', port: 'event' },
    ],
  };
  let registered = directory,
    authorActive = true;
  const auth = {
    validateSession: async (session: string) => {
      const id = session.slice(6);
      if (id === 'reviewer' || (id === 'author' && authorActive)) return { id, role: role[id] } as OmnitronAuthUser;
      return null;
    },
  };
  const projects = {
    getWorkspaceDirectory: () => registered,
    projectConfigurations: () => [{ name: project, path: registered, registeredAt: 'initial' }],
    resolveProjectStack: async (value: typeof workspace) => value,
    configuredStackType: () => 'local',
    listStacks: () => [{ name: stack }],
  };
  const audit = { record: vi.fn(async () => {}) };
  const admit = vi.fn(async () => {});
  const scope = flowWorkspaceReader(projects as never);
  function open() {
    const db = new Database(join(directory, 'state.sqlite'));
    const studio = new StudioRpcService(new StudioLedger(db), projects as never, auth, audit);
    const runtime = hostFlowRuntime(new FlowLedger(db), {
      scope,
      admit,
      auth,
      studio,
      report: vi.fn(),
      pipelines: {
        getPipeline: vi.fn(),
        listWorkspace: vi.fn(),
        prepareRun: vi.fn(),
        startRun: vi.fn(),
        getRunStatus: vi.fn(),
      },
    });
    return { db, studio, runtime, flows: new FlowsRpcService(runtime, auth, audit, scope, admit, studio) };
  }
  const controllers: ReturnType<typeof open>[] = [];
  async function close(controller: ReturnType<typeof open>) {
    if (!controller.db.open) return;
    await controller.runtime.dispose();
    controller.db.close();
  }
  try {
    await mkdir(replacement);
    const controller = open();
    controllers.push(controller);
    const { flows, studio } = controller;
    const catalog = studioCatalogFromListing('codex', 'sample', '1', [{ id: 'sample', label: 'Sample' }]);
    const { connection } = await local(() =>
      studio.connectAdapter({ project, account: 'author', directory, catalog: { ...catalog, teamTools: true } })
    );
    await as('author', () =>
      studio.createTeam({
        ...room,
        stack,
        title: 'Private room',
        name: 'Lead',
        provider: 'codex',
        preferences: { role: 'analyst', result: 'analysis', model: 'sample', requirements: {} },
        policy: { providers: ['codex'], maxDelegations: 2, maxMembers: 2, maxCostTier: 'standard' },
      })
    );
    const { turnId } = await as('author', () =>
      studio.post({
        ...room,
        turnId: randomUUID(),
        memberId: room.threadId,
        kind: 'message',
        text: 'Private interview notes',
      })
    );
    expect((await local(() => studio.nextTurn({ connection })))?.turnId).toBe(turnId);
    await as('author', () => studio.writeNote({ ...room, key: 'draft', text: 'Private team memory', revision: 0 }));
    const propose = async (graph: FlowDefinition) => {
      const result = (await local(() =>
        studio.teamTool({ connection, turnId, name: 'flow_propose', arguments: { definition: graph } })
      )) as { id: string };
      return { ...room, proposalId: result.id };
    };
    const selected = await propose(definition);
    const other = await propose({ ...definition, name: 'Private alternative' });
    await local(() =>
      studio.finishTurn({
        connection,
        turnId,
        result: { status: 'completed', answer: 'Private response', conversation: 'private-session' },
      })
    );
    await expect(as('reviewer', () => studio.flowProposal(selected))).rejects.toThrow('unavailable');
    await expect(as('reviewer', () => flows.submitProposal(selected))).rejects.toThrow('unavailable');
    await expect(as('author', () => flows.submitProposal({ ...selected, project: 'other' }))).rejects.toThrow(
      'unavailable'
    );
    await expect(as('author', () => flows.submitProposal({ ...selected, proposalId: randomUUID() }))).rejects.toThrow(
      'unavailable'
    );
    for (const injected of [
      { workspace: { project: null } },
      { definition },
      { stack: 'other' },
      { actor: 'reviewer' },
    ])
      await expect(as('author', () => flows.submitProposal({ ...selected, ...injected }))).rejects.toThrow(
        'Select a proposal'
      );
    await expect(
      as('author', () => flows.save({ workspace, id: randomUUID(), definition, expectedRevision: null }))
    ).rejects.toThrow('admin');
    expect((await as('reviewer', () => flows.list({ workspace }))).items).toEqual([]);

    const second = open();
    controllers.push(second);
    const [receipt, concurrent] = await Promise.all([
      as('author', () => flows.submitProposal(selected)),
      as('author', () => second.flows.submitProposal(selected)),
    ]);
    expect(concurrent).toEqual(receipt);
    expect(receipt).toEqual({ id: expect.any(String), workspace, revision: expect.any(String) });
    const ref = { id: receipt.id, workspace };
    expect((await as('reviewer', () => flows.list({ workspace: { project } }))).items).toMatchObject([
      { ...ref, name: definition.name, active: false },
    ]);
    expect((await as('reviewer', () => flows.list({ workspace: { project, stack: 'other' } }))).items).toEqual([]);
    await expect(as('author', () => flows.get(ref))).rejects.toThrow('admin');
    await expect(
      as('author', () => flows.activate({ ...ref, revision: receipt.revision, activation: null }))
    ).rejects.toThrow('admin');
    const draft = await as('reviewer', () => flows.get(ref));
    expect(draft).toMatchObject({
      ...receipt,
      definition,
      active: null,
      submission: { actor: 'author', revision: receipt.revision },
    });
    expect(JSON.stringify(draft)).not.toMatch(/Private|private-session|login-author/);
    await expect(as('reviewer', () => studio.thread(room))).rejects.toThrow('unavailable');
    const edited = await as('reviewer', () =>
      flows.save({ ...ref, expectedRevision: draft.revision, definition: { ...definition, name: 'Reviewed notice' } })
    );
    const event = { id: 'preview', source: 'request', type: 'manual', data: {} };
    expect(
      (await as('reviewer', () => flows.preview({ definition: edited.definition, event }))).effects.map((e) => e.kind)
    ).toEqual(['notification', 'studio-task']);
    await close(second);
    await close(controller);

    const resumed = open();
    controllers.push(resumed);
    expect(await as('author', () => resumed.flows.submitProposal(selected))).toEqual(receipt);
    expect((await as('reviewer', () => resumed.flows.get(ref))).revision).toBe(edited.revision);
    admit.mockImplementationOnce(async () => {
      registered = replacement;
    });
    await expect(as('author', () => resumed.flows.submitProposal(other))).rejects.toThrow('unavailable');
    await expect(as('author', () => resumed.flows.submitProposal(selected))).rejects.toThrow('unavailable');
    registered = directory;
    authorActive = false;
    await expect(as('author', () => resumed.flows.submitProposal(selected))).rejects.toThrow('Session');
    expect((await as('reviewer', () => resumed.flows.list({ workspace }))).items).toHaveLength(1);
    const running = await as('reviewer', () =>
      resumed.flows.activate({ ...ref, revision: edited.revision, activation: null })
    );
    expect(running.active).toMatchObject({ actor: 'reviewer', revision: edited.revision });
    await as('reviewer', () =>
      resumed.flows.submit({ ...ref, activation: running.active!.id, event: { ...event, id: 'execute' } })
    );
    await vi.waitFor(async () => {
      const [result] = await as('reviewer', () => resumed.flows.history(ref));
      expect(result?.deliveries).toMatchObject([
        { kind: 'notification', status: 'delivered' },
        { kind: 'studio-task', status: 'needs-review' },
      ]);
    });
    authorActive = true;
    expect((await as('author', () => resumed.studio.thread(room))).turns).toHaveLength(1);
  } finally {
    for (const controller of controllers) await close(controller);
    await rm(directory, { recursive: true, force: true });
  }
});
