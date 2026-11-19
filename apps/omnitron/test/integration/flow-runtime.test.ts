import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { FlowLedger, type FlowBinding } from '../../src/flows/flow-ledger.js';
import { FlowRuntime } from '../../src/flows/flow-runtime.js';
import { hostFlowRuntime } from '../../src/flows/host-flow-runtime.js';
import { FlowsRpcService } from '../../src/flows/flows.rpc-service.js';
import { EventBroadcasterService } from '../../src/services/event-broadcaster.service.js';
import { getCurrentAuth, runWithAuth } from '../../src/services/auth-context.js';
import {
  defaultFlowRegistry,
  diskSpaceFlow,
  FlowRegistry,
  type FlowComponent,
  type FlowDefinition,
  type FlowEvent,
} from '../../src/shared/dto/flows.js';
import { studioCatalogFromListing } from '../../src/shared/dto/studio-policy.js';
import { StudioLedger } from '../../src/studio/ledger.js';
import { StudioRpcService } from '../../src/studio/studio.rpc-service.js';
import type {
  IOmnitronPipelinesService,
  IOmnitronStudioService,
  OmnitronAuthUser,
  Pipeline,
  PipelineRun,
} from '../../src/shared/dto/services.js';

const authority = { actor: 'reviewer', session: 'private-session' };
const workspace = { project: 'research', stack: 'local' };
const binding: FlowBinding = { identity: 'private-registration', target: { ...workspace, type: 'local' } };
const clean: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of clean.splice(0).reverse()) await cleanup();
});
function newDb() {
  const db = new Database(':memory:');
  clean.push(() => {
    db.close();
  });
  return db;
}
const manual = (
  type = 'output.notify@1',
  config: Record<string, unknown> = { title: 'New report' }
): FlowDefinition => ({
  version: 1,
  name: 'Publication',
  nodes: [
    { id: 'signal', type: 'input.manual@1', config: {} },
    { id: 'output', type, config },
  ],
  edges: [{ from: 'signal', port: 'event', to: 'output' }],
});
const request = (definition: FlowDefinition) => ({ id: randomUUID(), workspace, definition, expectedRevision: null });
function active(ledger: FlowLedger, definition: FlowDefinition) {
  const ref = request(definition),
    draft = ledger.save(ref, binding);
  return {
    ref,
    active: ledger.change({ ...ref, revision: draft.revision, activation: null }, authority, binding).active!,
  };
}
const session = (id: string) => ({
  userId: authority.actor,
  roles: ['admin'],
  permissions: [],
  metadata: { sessionId: id },
});
const user = { id: authority.actor, role: 'admin' } as OmnitronAuthUser;

describe('local flow runtime', () => {
  it('delivers a newly admitted command while another disk source is still waiting', async () => {
    const ledger = new FlowLedger(newDb());
    let release!: () => void;
    let started!: () => void;
    const observed = new Promise<void>((resolve) => {
      started = resolve;
    });
    const readDisk = vi.fn(async () => {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { freeBytes: 100, totalBytes: 200 };
    });
    const deliver = vi.fn(async ({ row }: { row: { id: string } }) => row.id);
    const runtime = new FlowRuntime(ledger, {
      scope: async () => binding,
      admit: async () => {},
      deliver,
      readDisk,
      report: vi.fn(),
    });
    active(ledger, diskSpaceFlow('/observed', 10, 20));
    const task = active(
      ledger,
      manual('output.studio@1', { threadId: randomUUID(), memberId: randomUUID(), task: 'Review the report' })
    );
    const tick = runtime.tick();
    await observed;
    try {
      const receipt = ledger.submit(task.ref, task.active.id, {
        id: 'operator-request',
        source: 'signal',
        type: 'manual',
        data: {},
      });
      runtime.wake();
      await vi.waitFor(() => expect(ledger.delivery(receipt.deliveries[0]!.id).public.status).toBe('delivered'));
      expect(readDisk).toHaveBeenCalledOnce();
      expect(deliver).toHaveBeenCalledOnce();
    } finally {
      release();
      await tick;
      await runtime.dispose();
    }
  });
  it('lets operators preview a proposed graph while restricting saved state and mutations to administrators', async () => {
    const ledger = new FlowLedger(newDb());
    const admit = vi.fn(async () => {});
    const runtime = new FlowRuntime(ledger, { scope: async () => binding, admit, deliver: vi.fn(), report: vi.fn() });
    const auth = { validateSession: vi.fn(async () => ({ ...user, role: 'operator' as const })) };
    const audit = { record: vi.fn() };
    const rpc = new FlowsRpcService(runtime, auth, audit, async () => binding, admit);
    clean.push(() => runtime.dispose());
    const definition = manual();
    const { ref, active: deployment } = active(ledger, definition);
    const event = { id: 'preview', source: 'signal', type: 'manual', data: {} };
    const change = { ...ref, revision: deployment.revision, activation: deployment.id };
    await runWithAuth({ ...session('operator-session'), roles: ['operator'] }, async () => {
      expect((await rpc.catalog()).nodes.some((node) => node.type === 'host.disk@1')).toBe(true);
      expect((await rpc.preview({ definition, event })).effects).toMatchObject([{ kind: 'notification' }]);
      for (const call of [
        () => rpc.list({ workspace }),
        () => rpc.history(ref),
        () => rpc.notifications({ workspace }),
        () => rpc.save(ref),
        () => rpc.activate(change),
        () => rpc.deactivate(change),
        () => rpc.submit({ ...ref, activation: deployment.id, event }),
        () => rpc.retryDelivery({ ...change, delivery: randomUUID() }),
      ])
        await expect(call()).rejects.toThrow('admin');
    });
    expect(admit).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(ledger.history(ref)).toEqual([]);
  });

  it('reopens disk state, retries a failed sample, and stores one notification at each crossing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'private-flow-state-'));
    clean.push(() => rm(dir, { recursive: true, force: true }));
    const file = join(dir, 'flow.sqlite');
    let now = 10_000,
      capacity = 100,
      offline = false,
      scope = binding;
    const readDisk = vi.fn(async (path: string) => {
      expect(path).toBe('/synthetic-volume');
      if (offline) throw Error('Volume is unavailable');
      return { freeBytes: capacity, totalBytes: 1000 };
    });
    function open() {
      const db = new Database(file);
      const ledger = new FlowLedger(db, defaultFlowRegistry, () => now);
      const runtime = new FlowRuntime(ledger, {
        scope: async () => scope,
        admit: async () => {},
        readDisk,
        deliver: vi.fn(),
        report: vi.fn(),
      });
      return { db, ledger, runtime };
    }
    let host = open();
    clean.push(async () => {
      await host.runtime.dispose();
      host.db.close();
    });
    const { ref, active: deployment } = active(host.ledger, diskSpaceFlow('/synthetic-volume', 100, 110, 1000));
    const initialInbox = host.ledger.notifications(workspace);
    expect(initialInbox).toEqual({ cursor: 0, items: [] });
    await host.runtime.tick();
    now += 1000;
    capacity = 99;
    await host.runtime.tick();
    const low = host.ledger.history(ref)[0]!;
    expect(low.deliveries).toMatchObject([{ kind: 'notification', status: 'delivered', title: 'Disk space is low' }]);
    expect(low.traversed.map((edge) => edge.port)).toEqual(['event', 'low']);
    const before = host.ledger.due();
    await host.runtime.dispose();
    host.db.close();
    host = open();
    expect(host.ledger.due()).toEqual(before);
    expect(() =>
      host.ledger.submit(ref, deployment.id, {
        id: 'pretend',
        source: 'disk',
        type: 'host.disk.sample',
        data: { freeBytes: 500, totalBytes: 1000 },
      })
    ).toThrow('registered provider');
    now += 1000;
    offline = true;
    await host.runtime.tick();
    expect(host.ledger.get(ref).sources[0]?.error).toBe('Volume is unavailable');
    now += 1000;
    offline = false;
    capacity = 109;
    await host.runtime.tick();
    now += 1000;
    capacity = 110;
    await host.runtime.tick();
    expect(
      host.ledger
        .history(ref)
        .flatMap((r) => r.deliveries)
        .map((d) => d.title)
    ).toEqual(['Disk space recovered', 'Disk space is low']);
    const page = host.ledger.notifications(workspace, initialInbox.cursor, 1);
    expect(page.items.map((n) => n.title)).toEqual(['Disk space is low']);
    expect(host.ledger.notifications(workspace, page.cursor).items.map((n) => n.title)).toEqual([
      'Disk space recovered',
    ]);
    expect(host.ledger.notifications({ project: 'different' }, 0).items).toEqual([]);
    const late = host.ledger.notifications(workspace);
    expect(late.items).toEqual([]);
    expect(host.ledger.notifications(workspace, late.cursor).items).toEqual([]);
    scope = { ...binding, identity: 'replacement-project' };
    now += 1000;
    await host.runtime.tick();
    expect(host.ledger.get(ref).sources[0]?.error).toMatch(/registration|registered workspace/);
    expect(readDisk).toHaveBeenCalledTimes(5);
  });

  it('pins the active draft, rejects stale edits, conflicting event identities and replaced activations', () => {
    const ledger = new FlowLedger(newDb());
    const { ref, active: deployment } = active(ledger, manual());
    const input = { id: 'sensor-42', source: 'signal', type: 'manual', data: { count: 2, label: 'record' } };
    const first = ledger.submit(ref, deployment.id, input);
    expect(ledger.submit(ref, deployment.id, { ...input, data: { label: 'record', count: 2 } })).toEqual(first);
    expect(() => ledger.submit(ref, deployment.id, { ...input, data: { count: 3 } })).toThrow('different input');
    const draft = ledger.save(
      {
        ...ref,
        expectedRevision: deployment.revision,
        definition: manual('output.notify@1', { title: 'Edited title' }),
      },
      binding
    );
    expect(draft.active?.revision).toBe(deployment.revision);
    expect(ledger.submit(ref, deployment.id, { ...input, id: 'sensor-43' }).deliveries[0]?.title).toBe('New report');
    expect(() => ledger.save({ ...ref, definition: manual(), expectedRevision: deployment.revision }, binding)).toThrow(
      'changed'
    );
    expect(() => ledger.change({ ...ref, revision: draft.revision, activation: null }, authority, binding)).toThrow(
      'changed'
    );
    expect(() =>
      ledger.change({ ...ref, revision: draft.revision, activation: deployment.id }, authority, {
        ...binding,
        identity: 'reregistered',
      })
    ).toThrow('registered workspace changed');
    const newDeployment = ledger.change(
      { ...ref, revision: draft.revision, activation: deployment.id },
      authority,
      binding
    ).active!;
    expect(() => ledger.submit(ref, deployment.id, input)).toThrow('changed');
    expect(ledger.submit(ref, newDeployment.id, input).deliveries[0]?.title).toBe('Edited title');
    expect(() => ledger.get({ ...ref, workspace: { project: 'other' } })).toThrow('not found');
  });

  it('returns the recorded event without invoking a stateful component again', async () => {
    const registry = new FlowRegistry();
    const evaluate = vi.fn<FlowComponent['evaluate']>((_config, _data, previous) => {
      if (previous) throw Error('This observation was already consumed');
      return { state: true, effect: 'notification' };
    });
    registry.register({ ...registry.get('output.notify@1'), type: 'example.once@1', evaluate });
    const ledger = new FlowLedger(newDb(), registry);
    const { ref, active: activation } = active(ledger, manual('example.once@1', { title: 'First observation' }));
    const scope = async () => binding,
      admit = async () => {};
    const host = new FlowRuntime(ledger, { scope, admit, deliver: vi.fn(), report: vi.fn() });
    clean.push(() => host.dispose());
    const rpc = new FlowsRpcService(host, { validateSession: async () => user }, { record: vi.fn() }, scope, admit);
    const event = { id: 'reading-1', source: 'signal', type: 'manual', data: { name: 'one', count: 1 } };
    const submit = (input: FlowEvent) =>
      runWithAuth(session(authority.session), () => rpc.submit({ ...ref, activation: activation.id, event: input }));
    const first = await submit(event);
    expect(await submit({ ...event, data: { count: 1, name: 'one' } })).toEqual(first);
    await expect(submit({ ...event, data: { count: 2 } })).rejects.toThrow('different input');
    await expect(submit({ ...event, data: { name: 'x'.repeat(4097) } })).rejects.toThrow('scalar fields');
    expect(evaluate).toHaveBeenCalledTimes(1);
    await expect(submit({ ...event, id: 'reading-2' })).rejects.toThrow('already consumed');
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(ledger.history(ref)).toEqual([first]);
  });

  it('refuses to resume a running definition when an installed component changes under its version', () => {
    const db = newDb(),
      one = new FlowRegistry(),
      two = new FlowRegistry();
    const custom = { ...one.get('data.select@1'), type: 'example.select@1' };
    one.register({ ...custom, implementationRevision: '1'.repeat(64) });
    two.register({ ...custom, implementationRevision: '2'.repeat(64) });
    const definition = manual();
    definition.nodes.push({ id: 'fields', type: custom.type, config: { fields: ['name'] } });
    definition.edges = [
      { from: 'signal', port: 'event', to: 'fields' },
      { from: 'fields', port: 'data', to: 'output' },
    ];
    const { ref, active: deployment } = active(new FlowLedger(db, one), definition);
    const reopened = new FlowLedger(db, two);
    expect(() =>
      reopened.submit(ref, deployment.id, { id: '1', source: 'signal', type: 'manual', data: { name: 'input' } })
    ).toThrow('components changed');
    expect(reopened.history(ref)).toEqual([]);
    expect(
      reopened.change({ ...ref, revision: deployment.revision, activation: deployment.id }, authority, null).active
    ).toBe(null);
    expect(reopened.save({ ...ref, expectedRevision: deployment.revision }, binding).revision).not.toBe(
      deployment.revision
    );
  });

  it.each(['pause', 'replace'] as const)(
    'keeps a late receiver receipt across %s and restart and never sends queued work',
    async (change) => {
      const dir = await mkdtemp(join(tmpdir(), 'private-flow-receipt-'));
      clean.push(() => rm(dir, { recursive: true, force: true }));
      const file = join(dir, 'flow.sqlite');
      const db = new Database(file);
      let closed = false;
      clean.push(() => {
        if (!closed) db.close();
      });
      const ledger = new FlowLedger(db);
      const graph = manual('output.pipeline@1', { pipelineId: 'published', revision: 'e'.repeat(64) });
      const { ref, active: deployment } = active(ledger, graph);
      const push = (id: string) =>
        ledger.submit(ref, deployment.id, { id, source: 'signal', type: 'manual', data: {} }).deliveries[0]!;
      const first = push('first'),
        queued = push('waiting');
      let markSent!: () => void, acknowledge!: (id: string) => void;
      const sent = new Promise<void>((resolve) => {
        markSent = resolve;
      });
      const ack = new Promise<string>((resolve) => {
        acknowledge = resolve;
      });
      const dispatch = vi.fn(async (_entry, check: (send?: boolean) => void) => {
        check(true);
        markSent();
        return ack;
      });
      const runtime = new FlowRuntime(ledger, {
        scope: async () => binding,
        admit: async () => {},
        deliver: dispatch,
        report: vi.fn(),
      });
      const tick = runtime.tick();
      await sent;
      const revision =
        change === 'pause'
          ? deployment.revision
          : ledger.save(
              {
                ...ref,
                definition: { ...graph, name: 'Updated release review' },
                expectedRevision: deployment.revision,
              },
              binding
            ).revision;
      ledger.change({ ...ref, revision, activation: deployment.id }, authority, change === 'pause' ? null : binding);
      expect(ledger.delivery(first.id).public).toMatchObject({ status: 'unconfirmed', result: first.id });
      expect(ledger.delivery(queued.id).public).toMatchObject({ status: 'needs-review', result: null });
      expect(() => ledger.markDispatch(ledger.delivery(queued.id).row, authority.session)).toThrow(
        'activation changed'
      );
      acknowledge(first.id);
      await tick;
      await runtime.dispose();
      db.close();
      closed = true;
      const secondDb = new Database(file);
      clean.push(() => {
        secondDb.close();
      });
      const recovered = new FlowLedger(secondDb);
      const next = new FlowRuntime(recovered, {
        scope: async () => binding,
        admit: async () => {},
        deliver: dispatch,
        report: vi.fn(),
      });
      await next.tick();
      await next.dispose();
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(recovered.history(ref).flatMap((r) => r.deliveries)).toMatchObject([
        { id: queued.id, status: 'needs-review', result: null },
        { id: first.id, status: 'delivered', result: first.id, error: null },
      ]);
    }
  );

  it('reopens an in-flight intent under the same command ID after a controller crash', async () => {
    const db = newDb();
    const ledger = new FlowLedger(db);
    const { ref, active: deployment } = active(
      ledger,
      manual('output.pipeline@1', { pipelineId: 'published', revision: 'e'.repeat(64) })
    );
    const event = { id: 'signal', source: 'signal', type: 'manual', data: {} };
    const original = ledger.submit(ref, deployment.id, event).deliveries[0]!;
    ledger.markDispatch(ledger.delivery(original.id).row, authority.session);
    const afterCrash = new FlowLedger(db);
    const receiver = vi.fn(async (entry: ReturnType<FlowLedger['delivery']>) => {
      expect(entry.row.status).toBe('dispatching');
      return entry.row.id;
    });
    const worker = new FlowRuntime(afterCrash, {
      scope: async () => binding,
      admit: async () => {},
      deliver: receiver,
      report: vi.fn(),
    });
    await worker.tick();
    await worker.tick();
    await worker.dispose();
    expect(receiver).toHaveBeenCalledTimes(1);
    expect(afterCrash.submit(ref, deployment.id, event).deliveries[0]).toMatchObject({
      id: original.id,
      status: 'delivered',
      result: original.id,
    });
  });

  it('receives matching native stack activity and refuses injected copies of daemon events', async () => {
    const ledger = new FlowLedger(newDb()),
      bus = new EventBroadcasterService(createNullLogger());
    const host = new FlowRuntime(ledger, {
      scope: async () => binding,
      admit: async () => {},
      deliver: vi.fn(),
      report: vi.fn(),
    });
    clean.push(() => host.dispose());
    const graph = manual();
    graph.nodes[0] = { id: 'signal', type: 'input.event@1', config: { eventType: 'stack.started' } };
    const { ref, active: deployment } = active(ledger, graph);
    host.listen(bus);
    expect(() =>
      ledger.submit(ref, deployment.id, { id: 'fake', source: 'signal', type: 'stack.started', data: workspace })
    ).toThrow('registered provider');
    bus.broadcast('stack.started', { project: 'other', stack: 'local' });
    bus.broadcast('stack.started', { ...workspace, type: 'local', appCount: 1, nodeCount: 1 });
    await vi.waitFor(() => expect(ledger.history(ref)).toHaveLength(1));
    expect(ledger.history(ref)[0]?.event.data).toEqual({ ...workspace, type: 'local', appCount: 1, nodeCount: 1 });
  });

  it('limits native broadcasts waiting for admission and reports how many were lost upstream of the journal', async () => {
    const ledger = new FlowLedger(newDb());
    const bus = new EventBroadcasterService(createNullLogger());
    const report = vi.fn();
    const host = new FlowRuntime(ledger, {
      scope: async () => binding,
      admit: async () => {},
      deliver: vi.fn(),
      report,
    });
    clean.push(() => host.dispose());
    const graph = manual();
    graph.nodes[0] = { id: 'signal', type: 'input.event@1', config: { eventType: 'stack.started' } };
    const { ref } = active(ledger, graph);
    host.listen(bus);
    for (let i = 0; i < 135; i++) bus.broadcast('stack.started', { ...workspace, appCount: i });
    expect(report.mock.calls.map(([error]) => String(error))).toEqual([expect.stringContaining('queue is full')]);
    await vi.waitFor(() => expect(report.mock.calls.at(-1)?.[0]?.message).toContain('dropping 7 broadcasts'));
    const committed = ledger
      .history(ref, 200)
      .reverse()
      .map((r) => r.event.data['appCount']);
    expect(committed).toEqual(Array.from({ length: 128 }, (_, i) => i));
  });

  it('grants each reviewed Studio delivery its own session while queued and future deliveries keep the activation authority', async () => {
    const db = newDb(),
      ledger = new FlowLedger(db),
      memberId = randomUUID();
    const graph = manual('output.studio@1', { threadId: randomUUID(), memberId, task: 'Review the report' });
    const { ref, active: deployment } = active(ledger, graph);
    const submit = (id: string) =>
      ledger.submit(ref, deployment.id, {
        id,
        source: 'signal',
        type: 'manual',
        data: { unselected: 'private field' },
      }).deliveries[0]!;
    const first = submit('event-1');
    const admittedSessions: unknown[] = [];
    const post = vi.fn(
      async (message: Parameters<IOmnitronStudioService['post']>[0], stack?: string, beforeEnqueue?: () => void) => {
        expect(getCurrentAuth()?.userId).toBe(authority.actor);
        expect(message.text).toBe('Review the report');
        expect(stack).toBe(workspace.stack);
        beforeEnqueue?.();
        admittedSessions.push(getCurrentAuth()?.metadata?.['sessionId']);
        return { threadId: message.threadId, turnId: message.turnId };
      }
    );
    const auth = {
      validateSession: vi.fn(async (id: string) => (['fresh-session', 'second-session'].includes(id) ? user : null)),
    };
    const host = hostFlowRuntime(ledger, {
      scope: async () => binding,
      admit: async () => {},
      report: vi.fn(),
      auth,
      pipelines: {} as IOmnitronPipelinesService,
      studio: { postIfNew: post, postReceipt: vi.fn() },
    });
    clean.push(() => host.dispose());
    await host.tick();
    expect(ledger.history(ref)[0]?.deliveries[0]?.status).toBe('needs-review');
    expect(post).not.toHaveBeenCalled();
    expect(() => ledger.retry(ref, deployment.id, first.id, { actor: 'different', session: 'fresh-session' })).toThrow(
      'original account'
    );
    expect(() => ledger.retry(ref, deployment.id, first.id, { actor: authority.actor, session: null })).toThrow(
      'Sign in'
    );
    const queued = submit('event-2');
    const rpc = new FlowsRpcService(
      host,
      auth,
      { record: async () => {} },
      async () => binding,
      async () => {}
    );
    await runWithAuth(session('fresh-session'), () =>
      rpc.retryDelivery({ ...ref, activation: deployment.id, delivery: first.id })
    );
    await vi.waitFor(() => expect(ledger.delivery(queued.id).public.status).toBe('needs-review'));
    expect(ledger.delivery(first.id).public.status).toBe('delivered');
    expect(post).toHaveBeenCalledExactlyOnceWith(
      {
        project: workspace.project,
        threadId: graph.nodes[1]!.config['threadId'],
        memberId,
        kind: 'task',
        turnId: first.id,
        text: 'Review the report',
      },
      workspace.stack,
      expect.any(Function)
    );
    const future = submit('event-3');
    await runWithAuth(session('second-session'), () =>
      rpc.retryDelivery({ ...ref, activation: deployment.id, delivery: queued.id })
    );
    await vi.waitFor(() => expect(ledger.delivery(future.id).public.status).toBe('needs-review'));
    expect(ledger.delivery(queued.id).public.status).toBe('delivered');
    expect(admittedSessions).toEqual(['fresh-session', 'second-session']);
    expect(db.prepare('SELECT 1 FROM flow_deliveries WHERE retry_session IS NOT NULL').get()).toBeUndefined();
    expect(JSON.stringify(ledger.get(ref)) + JSON.stringify(ledger.history(ref))).not.toMatch(
      /fresh-session|second-session/
    );
  });

  it('opens an existing outbox and retains only its selected retry grant across controller restarts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flow-retry-grant-'));
    clean.push(() => rm(dir, { recursive: true, force: true }));
    const file = join(dir, 'state.sqlite');
    let db = new Database(file);
    clean.push(() => {
      if (db.open) db.close();
    });
    const older = new FlowLedger(db);
    const graph = manual('output.studio@1', {
      threadId: randomUUID(),
      memberId: randomUUID(),
      task: 'Review the table',
    });
    const { ref, active: deployment } = active(older, graph);
    const event = { id: 'one', source: 'signal', type: 'manual', data: {} };
    const first = older.submit(ref, deployment.id, event).deliveries[0]!;
    const other = older.submit(ref, deployment.id, { ...event, id: 'two' }).deliveries[0]!;
    older.finish(older.delivery(first.id).row, null, 'Review required');
    db.exec('ALTER TABLE flow_deliveries DROP COLUMN retry_session');
    db.exec('ALTER TABLE flow_deliveries DROP COLUMN attempt');
    db.close();
    db = new Database(file);
    const migrated = new FlowLedger(db);
    expect(migrated.history(ref)).toHaveLength(2);
    migrated.retry(ref, deployment.id, first.id, { actor: authority.actor, session: 'one-delivery-session' });
    migrated.retry(ref, deployment.id, first.id, { actor: authority.actor, session: 'late-duplicate' });
    db.close();
    db = new Database(file);
    const reopened = new FlowLedger(db);
    expect(reopened.delivery(first.id).session).toBe('one-delivery-session');
    expect(reopened.delivery(other.id).session).toBe(authority.session);
    const authorized = reopened.delivery(first.id).row;
    expect(() => reopened.markDispatch(authorized, authority.session)).toThrow('changed');
    reopened.markDispatch(authorized, 'one-delivery-session');
    reopened.change({ ...ref, activation: deployment.id, revision: deployment.revision }, authority, null);
    expect(reopened.delivery(first.id).public.status).toBe('unconfirmed');
    expect(db.prepare('SELECT 1 FROM flow_deliveries WHERE retry_session IS NOT NULL').get()).toBeUndefined();
  });

  it.each(['late refusal', 'late dispatch', 'exact receipt'] as const)(
    'keeps the reviewed retry distinct from the preceding attempt when a controller returns a %s',
    async (outcome) => {
      const ledger = new FlowLedger(newDb());
      const { ref, active: deployment } = active(
        ledger,
        manual('output.studio@1', {
          threadId: randomUUID(),
          memberId: randomUUID(),
          task: 'Review this receipt',
        })
      );
      const { id } = ledger.submit(ref, deployment.id, { id: 'one', source: 'signal', type: 'manual', data: {} })
        .deliveries[0]!;
      const started = Promise.withResolvers<void>(),
        resume = Promise.withResolvers<void>();
      const attempts: number[] = [],
        dispatched: number[] = [];
      const deps = { admit: async () => {}, scope: async () => binding, report: vi.fn() };
      const delayed = new FlowRuntime(ledger, {
        ...deps,
        async deliver(entry, check) {
          attempts.push(entry.row.attempt);
          if (entry.row.attempt === 0) {
            started.resolve();
            await resume.promise;
            if (outcome === 'late refusal') throw Error('Earlier refusal');
            if (outcome === 'exact receipt') return entry.row.id;
          }
          check(true);
          dispatched.push(entry.row.attempt);
          return entry.row.id;
        },
      });
      const other = new FlowRuntime(ledger, {
        ...deps,
        deliver: async () => {
          throw Error('Receiver unavailable');
        },
      });
      clean.push(
        () => delayed.dispose(),
        () => other.dispose()
      );
      const waiting = delayed.tick();
      await started.promise;
      try {
        await other.tick();
        expect(ledger.delivery(id).public.status).toBe('needs-review');
        ledger.retry(ref, deployment.id, id, authority);
      } finally {
        resume.resolve();
        await waiting;
      }
      expect(ledger.delivery(id).public).toMatchObject({ status: 'delivered', result: id });
      expect(attempts).toEqual(outcome === 'exact receipt' ? [0] : [0, 1]);
      expect(dispatched).toEqual(outcome === 'exact receipt' ? [] : [1]);
    }
  );

  it('recovers the exact Studio admission after a restart, a retired target and a disconnected connector', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flow-studio-receipt-'));
    clean.push(() => rm(dir, { recursive: true, force: true }));
    const file = join(dir, 'state.sqlite');
    let db = new Database(file);
    clean.push(() => {
      if (db.open) db.close();
    });
    const auth = { validateSession: async () => user };
    const audit = { record: vi.fn(async (_entry: { action: string }) => {}) };
    const scope = async () => binding;
    const admit = async () => {};
    const open = () => {
      const ledger = new FlowLedger(db);
      const studio = new StudioRpcService(
        new StudioLedger(db),
        {
          getWorkspaceDirectory: () => dir,
          resolveProjectStack: async (target: typeof workspace) => target,
          listStacks: () => [{ name: workspace.stack }],
        } as never,
        auth,
        audit
      );
      const host = hostFlowRuntime(ledger, {
        auth,
        studio,
        scope,
        admit,
        report: vi.fn(),
        pipelines: {} as IOmnitronPipelinesService,
      });
      clean.push(() => host.dispose());
      return { ledger, studio, host, rpc: new FlowsRpcService(host, auth, audit, scope, admit) };
    };
    const first = open();
    const account = <T>(work: () => Promise<T>) => runWithAuth(session(authority.session), work);
    const local = <T>(work: () => Promise<T>) =>
      runWithAuth(
        {
          userId: 'omnitron-local',
          roles: ['admin'],
          permissions: [],
          metadata: { source: 'local-unix-socket' },
        },
        work
      );
    const catalog = studioCatalogFromListing('codex', 'codex', 'v1', [{ id: 'local-model', label: 'Local model' }]);
    const { connection } = await local(() =>
      first.studio.connectAdapter({
        project: workspace.project,
        directory: dir,
        account: user.id,
        catalog: { ...catalog, teamTools: true },
      })
    );
    const threadId = randomUUID(),
      memberId = randomUUID();
    const room = { project: workspace.project, threadId };
    const preferences = { role: 'analyst', result: 'analysis', model: 'local-model', requirements: {} } as const;
    await account(() =>
      first.studio.createTeam({
        ...workspace,
        threadId,
        title: 'Reviews',
        name: 'Lead',
        provider: 'codex',
        preferences,
        policy: { providers: ['codex'], maxMembers: 3, maxDelegations: 2, maxCostTier: 'standard' },
      })
    );
    await account(() => first.studio.addMember({ ...room, memberId, name: 'Reader', provider: 'codex', preferences }));
    const ref = request(manual('output.studio@1', { threadId, memberId, task: 'Review the table' }));
    const saved = await account(() => first.rpc.save(ref));
    const activation = (await account(() => first.rpc.activate({ ...ref, revision: saved.revision, activation: null })))
      .active!;
    const event = { id: 'review-table', type: 'manual', source: 'signal', data: {} };
    const delivery = (await account(() => first.rpc.submit({ ...ref, activation: activation.id, event })))
      .deliveries[0]!;
    // The receiver and dispatch mark committed, but the first controller never acknowledged the outbox.
    vi.spyOn(first.ledger, 'finish').mockImplementation(() => {
      throw Error('Controller stopped');
    });
    await expect(first.host.tick()).rejects.toThrow('Controller stopped');
    await first.host.dispose();
    db.close();
    db = new Database(file);
    const next = open();
    await account(() => next.studio.retireMember({ ...room, memberId }));
    await local(() => next.studio.disconnectAdapter({ connection }));
    const fullThread = vi.spyOn(next.studio, 'thread');
    await next.host.tick();
    expect(fullThread).not.toHaveBeenCalled();
    expect((await account(() => next.rpc.history(ref)))[0]?.deliveries).toMatchObject([
      { id: delivery.id, result: delivery.id, status: 'delivered' },
    ]);
    expect((await account(() => next.studio.thread(room))).turns).toMatchObject([
      { id: delivery.id, memberId, prompt: 'Review the table', status: 'cancelled' },
    ]);
    expect(audit.record.mock.calls.filter(([entry]) => entry.action === 'studio.team.post')).toHaveLength(1);
  });

  it.each([
    'shell',
    'deploy',
    'remote-node',
    'remote-stack',
    'other-project',
    'other-stack',
    'changed-revision',
  ] as const)('refuses automatic pipeline activation before dispatch for %s', async (fault) => {
    const ledger = new FlowLedger(newDb()),
      revision = 'a'.repeat(64);
    const step = {
      kind: fault === 'shell' ? 'shell' : fault === 'deploy' ? 'deploy' : 'release',
      name: 'publish',
      nodeId: fault === 'remote-node' ? 'other' : 'local',
      target: {
        project: fault === 'other-project' ? 'different' : workspace.project,
        stack: fault === 'other-stack' ? 'different' : workspace.stack,
      },
    };
    const graph = manual('output.run-pipeline@1', { pipelineId: 'publication', revision });
    const ref = request(graph),
      draft = ledger.save(ref, binding);
    const current = fault === 'remote-stack' ? { ...binding, target: { ...workspace, type: 'remote' } } : binding;
    const auth = { validateSession: async () => user },
      prepare = vi.fn(),
      start = vi.fn();
    const host = hostFlowRuntime(ledger, {
      scope: async () => current,
      admit: async () => {},
      report: vi.fn(),
      auth,
      pipelines: {
        getPipeline: async () =>
          ({
            id: 'publication',
            revision: fault === 'changed-revision' ? 'b'.repeat(64) : revision,
            steps: [step],
          }) as Pipeline,
        listWorkspace: vi.fn(),
        prepareRun: prepare,
        startRun: start,
        getRunStatus: vi.fn(),
      },
      studio: { postReceipt: vi.fn(), postIfNew: vi.fn() },
    });
    const rpc = new FlowsRpcService(
      host,
      auth,
      { record: async () => {} },
      async () => current,
      async () => {}
    );
    await expect(
      runWithAuth(session('private-session'), () =>
        rpc.activate({ ...ref, revision: draft.revision, activation: null })
      )
    ).rejects.toThrow();
    expect(ledger.get(ref).active).toBe(null);
    expect(prepare).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it('keeps a lost, unverifiable pipeline acknowledgement visible without starting it again', async () => {
    const ledger = new FlowLedger(newDb()),
      revision = 'a'.repeat(64);
    const { ref, active: deployment } = active(
      ledger,
      manual('output.run-pipeline@1', { pipelineId: 'saved', revision })
    );
    const event = { id: 'one', source: 'signal', type: 'manual', data: {} };
    const delivery = ledger.submit(ref, deployment.id, event).deliveries[0]!;
    const auth = { validateSession: async () => user };
    const run: PipelineRun = {
      id: delivery.id,
      pipelineId: 'saved',
      triggeredBy: user.id,
      status: 'awaiting-review',
      startedAt: new Date(0).toISOString(),
      completedAt: null,
      params: {},
      steps: [],
      review: {
        definitionRevision: revision,
        digest: 'd'.repeat(64),
        parameterNames: [],
        projects: [workspace.project],
        protocol: 1,
      },
    };
    const start = vi.fn(async () => {
      throw Error('Receiver disconnected');
    });
    const observe = vi.fn().mockResolvedValueOnce(null).mockRejectedValue(Error('Receipt unavailable'));
    const host = hostFlowRuntime(ledger, {
      scope: async () => binding,
      admit: async () => {},
      report: vi.fn(),
      auth,
      pipelines: {
        getPipeline: async () =>
          ({ id: 'saved', revision, steps: [{ name: 'entry', kind: 'release', target: workspace }] }) as Pipeline,
        listWorkspace: vi.fn(),
        prepareRun: async () => run,
        startRun: start,
        getRunStatus: observe,
      },
      studio: { postReceipt: vi.fn(), postIfNew: vi.fn() },
    });
    await host.tick();
    await host.tick();
    expect(ledger.submit(ref, deployment.id, event).deliveries[0]).toMatchObject({
      id: delivery.id,
      result: delivery.id,
      status: 'unconfirmed',
    });
    expect(ledger.retry(ref, deployment.id, delivery.id, authority).status).toBe('unconfirmed');
    expect(start).toHaveBeenCalledTimes(1);
  });
});
