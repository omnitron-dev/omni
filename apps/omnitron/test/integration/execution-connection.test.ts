import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { Netron, Public, Service } from '@omnitron-dev/titan/netron';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { ControllerHandoff, type ControllerGrant } from '@omnitron-dev/titan-pm';
import { ExecutionClient } from '../../src/daemon/execution-client.js';
import { recoveryState } from '../../src/daemon/recovery-state.js';
import { runtimeDiagnostics } from '../../src/monitoring/runtime-diagnostics.js';
import { attestManagedOwnerRuntime } from '../../src/daemon/managed-owner-build.js';

vi.mock('../../src/daemon/managed-owner-build.js', () => ({ attestManagedOwnerRuntime: vi.fn() }));

@Service({ name: 'OmnitronExecution' })
class Owner {
  readonly startedAt = new Date().toISOString();
  controllerId = 'test';
  epoch = 1;
  phase = 'active';
  snapshots: unknown[] = [];
  acknowledgments = 0;
  mutations = 0;
  mutationInputs: unknown[] = [];
  preparationInputs: unknown[] = [];
  mutationValue: unknown;
  capabilities?: Record<string, number>;
  unavailable = false;
  rejectAck = false;
  beforeObservation?: () => Promise<void>;
  afterObservation?: () => Promise<void>;
  revision = 0;
  constructor(readonly id: string) {}

  @Public()
  async snapshot(input?: { afterEvent?: number }) {
    this.snapshots.push(input);
    if (input?.afterEvent !== undefined) await this.beforeObservation?.();
    if (this.unavailable) throw new Error('Owner observation fixture is unavailable');
    const snapshot = { protocol: 1, revision: ++this.revision,
      ...(this.capabilities === undefined ? {} : { capabilities: this.capabilities }),
      status: { owner: { id: this.id, pid: process.pid, startedAt: this.startedAt },
        controller: { ownerId: this.id, controllerId: this.controllerId, epoch: this.epoch }, phase: this.phase },
      apps: [], workers: [], events: [], acknowledgedEvent: 0, lastEvent: 0, droppedEvents: 0,
      inventoryDigest: 'fixture', devMode: false, watchedApps: [], watchEnabled: false };
    if (input?.afterEvent !== undefined) await this.afterObservation?.();
    return snapshot;
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
    return { value: this.mutationValue, snapshot: await this.snapshot() };
  }

  @Public()
  async prepare(input: { grant: ControllerGrant; candidateId: string }) {
    this.preparationInputs.push(input);
    const owner = { id: this.id, pid: process.pid, startedAt: this.startedAt };
    const fence = new ControllerHandoff(owner, { ownerId: this.id, controllerId: this.controllerId, epoch: this.epoch }, async () => {});
    const ticket = await fence.prepare(input.grant, input.candidateId);
    return { ticket, snapshot: { ...await this.snapshot(), status: fence.status() } };
  }
}

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  runtimeDiagnostics.resolve('execution.observation-unavailable');
  runtimeDiagnostics.resolve('execution.acknowledgment-unavailable');
  vi.mocked(attestManagedOwnerRuntime).mockReset();
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
  const client = new ExecutionClient(socket, createNullLogger(), 'test');
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

const runtimeProof = () => ({ build: { commit: 'a'.repeat(40), dirty: false, builtAt: '2026-11-12T00:00:00Z' },
  packageRoot: '/fixture/owner', executable: '/fixture/node', lifetime: 'native-boot:birth',
  target: { platform: process.platform, arch: process.arch, node: process.version, abi: process.versions.modules,
    executableSha256: 'b'.repeat(64), libc: null } });

it('sends the reviewed grant unchanged over Netron and lets the actual owner fence reject takeover', async () => {
  const { owner, client } = await fixture();
  const reviewed = { ownerId: owner.id, controllerId: 'test', epoch: 1 };
  owner.controllerId = 'foreign'; owner.epoch = 2;
  await expect(client.prepareReviewedReplacement(reviewed, 'replacement')).rejects.toThrow('no longer owns');
  expect(owner.preparationInputs).toEqual([{ grant: reviewed, candidateId: 'replacement' }]);
  expect(owner.mutations).toBe(0);
  const current = { ownerId: owner.id, controllerId: 'foreign', epoch: 2 };
  await expect(client.prepareReviewedReplacement(current, 'replacement')).resolves.toMatchObject({ ticket: { from: current, to: { epoch: 3 } } });
});

it.each(['takeover', 'new-epoch', 'prepared'])('refuses installed execution authority on a stable %s observation before native admission', async change => {
  const { owner, client } = await fixture();
  if (change === 'takeover') { owner.controllerId = 'foreign'; owner.epoch = 2; }
  if (change === 'new-epoch') owner.epoch = 2;
  if (change === 'prepared') owner.phase = 'prepared';
  await expect(client.orchestrator.getExecutionOwnerRuntime!()).rejects.toThrow('controller changed');
  expect(attestManagedOwnerRuntime).not.toHaveBeenCalled();
  expect(owner.mutations).toBe(0);
});

it('binds native runtime proof to the held grant before and after its asynchronous inspection', async () => {
  const { owner, client } = await fixture();
  vi.mocked(attestManagedOwnerRuntime).mockResolvedValue(runtimeProof());
  await expect(client.orchestrator.getExecutionOwnerRuntime!()).resolves.toMatchObject({
    root: '/fixture/owner', executable: '/fixture/node', execution: { ownerId: owner.id, pid: process.pid, epoch: 1, lifetime: 'native-boot:birth' },
  });
  vi.mocked(attestManagedOwnerRuntime).mockImplementationOnce(async () => {
    owner.controllerId = 'foreign'; owner.epoch = 2;
    return runtimeProof();
  });
  await expect(client.orchestrator.getExecutionOwnerRuntime!()).rejects.toThrow('controller changed');
  expect(owner.mutations).toBe(0);
});

it('refuses an older controlled response after a newer observation has already recorded takeover', async () => {
  const { owner, client } = await fixture();
  const captured = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let held = false;
  owner.afterObservation = async () => {
    if (held) return;
    held = true;
    captured.resolve();
    await release.promise;
  };
  const admission = client.controlledOwnerSnapshot();
  const refusal = expect(admission).rejects.toThrow('controller changed');
  try {
    await captured.promise;
    owner.controllerId = 'foreign'; owner.epoch = 2;
    await client.recoverySnapshot();
    expect(client.state()!.epoch).toBe(2);
  } finally {
    release.resolve();
  }
  await refusal;
  expect(attestManagedOwnerRuntime).not.toHaveBeenCalled();
  expect(client.state()!.epoch).toBe(2);
  expect(owner.mutations).toBe(0);
});

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

it('preserves the owner source receipt independently of subsequent inventory', async () => {
  const { client, owner, internals } = await fixture();
  owner.capabilities = { sourceRefresh: 1 };
  await internals.refresh();
  owner.mutationValue = { process: { name: 'fixture/local/site', status: 'online', generation: 'confirmed' },
    source: { name: 'fixture/local/site', generation: 'confirmed', directory: '/fixture/source', definitionRevision: 3 } };
  // The snapshot deliberately has no application; the result belongs to the
  // completed mutation and must not be reconstructed from a newer inventory.
  await expect(client.orchestrator.restartAfterChange('fixture/local/site', {
    generation: 'observed', definitionRevision: 7,
  })).resolves.toEqual(owner.mutationValue);
  expect(client.orchestrator.list()).toEqual([]);
});
