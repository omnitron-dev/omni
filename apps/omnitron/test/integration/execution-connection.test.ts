import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { Netron, Public, Service } from '@omnitron-dev/titan/netron';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { ExecutionClient } from '../../src/daemon/execution-client.js';
import { recoveryState } from '../../src/daemon/recovery-state.js';
import { runtimeDiagnostics } from '../../src/monitoring/runtime-diagnostics.js';

@Service({ name: 'OmnitronExecution' })
class Owner {
  snapshots: unknown[] = [];
  acknowledgments = 0;
  mutations = 0;
  mutationInputs: unknown[] = [];
  capabilities?: Record<string, number>;
  unavailable = false;
  rejectAck = false;
  beforeObservation?: () => Promise<void>;
  revision = 0;
  constructor(readonly id: string) {}

  @Public()
  async snapshot(input?: { afterEvent?: number }) {
    this.snapshots.push(input);
    if (input?.afterEvent !== undefined) await this.beforeObservation?.();
    if (this.unavailable) throw new Error('Owner observation fixture is unavailable');
    return { protocol: 1, revision: ++this.revision,
      ...(this.capabilities === undefined ? {} : { capabilities: this.capabilities }),
      status: { owner: { id: this.id, pid: process.pid, startedAt: new Date().toISOString() },
        controller: { ownerId: this.id, controllerId: 'test', epoch: 1 }, phase: 'active' },
      apps: [], workers: [], events: [], acknowledgedEvent: 0, lastEvent: 0, droppedEvents: 0,
      inventoryDigest: 'fixture', devMode: false, watchedApps: [], watchEnabled: false };
  }

  @Public()
  async acknowledge() {
    this.acknowledgments++;
    if (this.rejectAck) throw new Error('Controller acknowledgment was refused');
  }

  @Public()
  async mutate(input: unknown) {
    this.mutations++;
    this.mutationInputs.push(input);
    return { value: null, snapshot: await this.snapshot() };
  }
}

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  runtimeDiagnostics.resolve('execution.observation-unavailable');
  runtimeDiagnostics.resolve('execution.acknowledgment-unavailable');
});

async function fixture() {
  const directory = await fs.mkdtemp('/tmp/omni-owner-rpc-');
  cleanup.push(() => fs.rm(directory, { recursive: true, force: true }));
  const socket = path.join(directory, 'owner.sock');
  const serve = async () => {
    const owner = new Owner(randomUUID());
    const server = new Netron(createNullLogger());
    server.registerTransportServer('unix', { name: 'owner', options: { path: socket, mode: 0o600 } });
    await server.peer.exposeService(owner);
    await server.start();
    cleanup.push(() => server.stop());
    return { owner, server };
  };
  const first = await serve();
  const client = new ExecutionClient(socket, createNullLogger());
  cleanup.push(() => client.close());
  await client.connect();
  // White-box access is confined to the fixture: no diagnostic API can drop
  // a production channel or manufacture a controller grant.
  const internals = client as unknown as {
    refresh(): Promise<void>;
    grant: { ownerId: string; controllerId: string; epoch: number };
    connection: { disconnect(): Promise<void> };
    observations: { disconnect(): Promise<void> };
  };
  internals.grant = { ownerId: first.owner.id, controllerId: 'test', epoch: 1 };
  return { ...first, client, internals, serve, socket };
}

it('waits for an in-flight observation before reporting replay activation complete', async () => {
  const { owner, client, internals } = await fixture();
  client.setLogCollector({ setCaptureStatus: () => undefined, confirmPending: async () => undefined } as never);
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const paused = new Promise<void>(resolve => { release = resolve; });
  owner.beforeObservation = async () => { entered(); await paused; };
  const poll = internals.refresh();
  await waiting;
  let activated = false;
  const activation = client.activateObservations().then(() => { activated = true; });
  try {
    await new Promise(resolve => setImmediate(resolve));
    expect(activated).toBe(false);
    expect(owner.acknowledgments).toBe(0);
  } finally {
    release();
    await Promise.all([poll, activation]);
  }
  expect(activated).toBe(true);
  expect(owner.acknowledgments).toBe(1);
  expect(owner.snapshots.filter(input => input !== undefined)).toHaveLength(1);
});

it('recovers observation failures without changing controller ownership and distinguishes failed acknowledgments', async () => {
  const { owner, client, internals } = await fixture();
  client.setLogCollector({ setCaptureStatus: () => undefined, confirmPending: async () => undefined } as never);
  await client.activateObservations();
  const before = client.state();
  owner.unavailable = true;
  await internals.refresh();
  expect(client.state()?.connection).toMatchObject({ status: 'unavailable', error: expect.stringContaining('unavailable') });
  owner.unavailable = false;
  owner.rejectAck = true;
  await internals.refresh();
  expect(client.state()?.connection).toMatchObject({ status: 'connected', error: null });
  expect(runtimeDiagnostics.snapshot().active.map(item => item.event.id)).toContain('execution.acknowledgment-unavailable');
  expect(runtimeDiagnostics.snapshot().active.map(item => item.event.id)).not.toContain('execution.observation-unavailable');
  const rejectedCount = owner.acknowledgments;
  expect(rejectedCount).toBeGreaterThan(0);
  owner.rejectAck = false;
  await internals.connection.disconnect();
  await internals.observations.disconnect();
  await internals.refresh();
  expect(owner.acknowledgments).toBeGreaterThan(rejectedCount);
  expect(client.state()?.owner.id).toBe(before?.owner.id);
  expect(client.state()?.epoch).toBe(before?.epoch);
  expect(runtimeDiagnostics.snapshot().active.map(item => item.event.id)).not.toContain('execution.acknowledgment-unavailable');
});

it('rejects another owner at the same address before sending an old cursor, acknowledgment or mutation', async () => {
  const { server, client, internals, serve } = await fixture();
  await client.activateObservations();
  await Promise.all([internals.connection.disconnect(), internals.observations.disconnect()]);
  await server.stop();
  const replacement = await serve();
  await internals.refresh();
  expect(client.state()?.connection.status).toBe('owner-changed');
  expect(replacement.owner.snapshots).toEqual([undefined]);
  expect(replacement.owner.acknowledgments).toBe(0);
  await expect(client.shutdownOwner()).rejects.toThrow('identity changed');
  expect(replacement.owner.mutations).toBe(0);
  expect(() => client.orchestrator.list()).toThrow('inventory is stale');
});

it('revalidates socket permissions on reconnect before making an RPC', async () => {
  const { owner, client, internals, socket } = await fixture();
  await Promise.all([internals.connection.disconnect(), internals.observations.disconnect()]);
  const before = owner.snapshots.length;
  await fs.chmod(socket, 0o666);
  await internals.refresh();
  expect(client.state()?.connection.status).toBe('unavailable');
  expect(owner.snapshots).toHaveLength(before);
  await fs.chmod(socket, 0o600);
  await internals.refresh();
  expect(client.state()?.connection.status).toBe('connected');
});


it('refuses pool resize on an older owner before mutation and recovery invalidation', async () => {
  const { client, owner } = await fixture();
  const before = recoveryState.token();
  await expect(client.orchestrator.scaleApp('fixture', 2, 'workers')).rejects.toThrow('does not support declared process pool resizing');
  expect(owner.mutations).toBe(0); expect(recoveryState.token()).toBe(before);
});

it.each([undefined, { applicationRuntimeResolution: 1 }, { sourceRefresh: 2 }])(
  'refuses confirmed source refresh before an incompatible owner receives new arguments: %j', async capabilities => {
    const { client, owner, internals } = await fixture();
    if (capabilities === undefined) delete owner.capabilities;
    else owner.capabilities = capabilities;
    await internals.refresh();
    const before = recoveryState.token();
    await expect(client.orchestrator.restartAfterChange('fixture/local/site', {
      generation: 'observed-generation', definitionRevision: 4,
    })).rejects.toThrow('does not support confirmed source refresh');
    expect(owner.mutations).toBe(0);
    expect(owner.mutationInputs).toEqual([]);
    expect(recoveryState.token()).toBe(before);
  });

it('sends the exact source binding through the existing owner mutation channel only when supported', async () => {
  const { client, owner, internals } = await fixture();
  owner.capabilities = { sourceRefresh: 1 };
  await internals.refresh();
  const before = recoveryState.token();
  const binding = { generation: 'observed-generation', definitionRevision: 4 };
  // This transport fixture has no applications; receipt validation belongs to
  // source-refresh-http and source-refresh owner tests, not an invented handle.
  await expect(client.orchestrator.restartAfterChange('fixture/local/site', binding)).resolves.toBeUndefined();
  expect(owner.mutations).toBe(1);
  expect(owner.mutationInputs).toEqual([{ grant: internals.grant, sequence: 1,
    method: 'restartAfterChange', args: ['fixture/local/site', binding] }]);
  expect(recoveryState.token()).not.toBe(before);
  expect(client.state()?.owner.id).toBe(owner.id);
});
