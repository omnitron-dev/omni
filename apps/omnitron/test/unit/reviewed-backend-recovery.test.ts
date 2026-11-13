import 'reflect-metadata';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ControllerHandoff, type ControllerGrant, type HandoffTicket } from '@omnitron-dev/titan-pm';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { DEFAULT_DAEMON_CONFIG, DEFAULT_ECOSYSTEM } from '../../src/config/defaults.js';
import type { BackendArtifact } from '../../src/daemon/backend-candidate.js';
import type { ManagedRuntime } from '../../src/daemon/managed-runtime.js';
import type { BackendBootRecord } from '../../src/daemon/backend-handoff-types.js';
import type { ExecutionSnapshot } from '../../src/daemon/execution-host.js';
import { BackendRecoveryJournal } from '../../src/daemon/backend-recovery-journal.js';
import type { BackendRecoveryRecord } from '../../src/daemon/backend-recovery-journal.js';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import { RuntimeInstallation } from '../../src/daemon/runtime-installation.js';
import { ExecutionJournal, writePrivateRecord } from '../../src/daemon/execution-journal.js';
import { ProjectRegistry } from '../../src/project/registry.js';
import { supervisorTransitionIntentDigest, type SupervisorTransition } from '../../src/daemon/supervisor-transition.js';
import { prepareReviewedBackendRecovery, checkReviewedBackendRecovery, inspectHeldBackendRecovery, acceptColdBackendRecovery, recoverReviewedBackend } from '../../src/daemon/reviewed-backend-recovery.js';

const fake = vi.hoisted(() => ({ config: undefined as ManagedRuntime | undefined, artifact: undefined as BackendArtifact | undefined,
  snapshot: vi.fn(), prepare: vi.fn(), cancel: vi.fn(), launch: vi.fn(), daemon: vi.fn(), proof: vi.fn(), candidate: vi.fn(),
  children: [] as ChildProcess[], native: vi.fn(), certificate: vi.fn(), verifyEntry: vi.fn(), shutdown: vi.fn() }));
vi.mock('../../src/daemon/owner-reconciliation.js', async original => ({
  ...await original<typeof import('../../src/daemon/owner-reconciliation.js')>(), assertCleanManagedShutdown: fake.shutdown,
}));
vi.mock('../../src/daemon/managed-runtime.js', async original => ({
  ...await original<typeof import('../../src/daemon/managed-runtime.js')>(), readManagedRuntime: async () => fake.config,
  managedJobPid: async () => process.pid, verifyManagedIsolation: vi.fn(),
}));
vi.mock('@omnitron-dev/common/process-identity', async original => ({
  ...await original<typeof import('@omnitron-dev/common/process-identity')>(), readProcessLifetime: fake.native,
}));
vi.mock('../../src/daemon/managed-owner-build.js', () => ({ attestManagedOwnerRuntime: fake.proof }));
vi.mock('../../src/daemon/backend-candidate.js', async original => ({
  ...await original<typeof import('../../src/daemon/backend-candidate.js')>(), checkBackendCandidate: fake.candidate, verifyBackendEntry: fake.verifyEntry,
}));
vi.mock('../../src/daemon/execution-client.js', () => ({ ExecutionClient: class {
  connect = fake.snapshot; recoverySnapshot = fake.snapshot; prepareReviewedReplacement = fake.prepare;
  cancelReplacement = fake.cancel; async close() {}
} }));
vi.mock('../../src/daemon/daemon-client.js', () => ({ createDaemonClient: fake.daemon }));
vi.mock('node:child_process', async original => {
  const actual = await original<typeof import('node:child_process')>();
  return { ...actual, fork: (...args: Parameters<typeof actual.fork>) => {
    const child = actual.fork(...args); fake.children.push(child);
    child.on('message', (message: { type?: string }) => {
      if (message.type === 'fixture-start') void fake.launch(child, String(args[1]?.[1])).catch((error: unknown) => child.send({ error: String(error) }));
    });
    return child;
  } };
});

const roots: string[] = [];
const instances: RuntimeInstallation[] = [];
const stores: DaemonStateStore[] = [];
beforeEach(() => { vi.resetAllMocks(); fake.native.mockReturnValue({ state: 'dead' }); fake.certificate.mockImplementation(async record => record); });
afterEach(async () => {
  for (const child of fake.children.splice(0)) if (child.exitCode === null && child.signalCode === null) {
    const ended = once(child, 'exit'); child.kill('SIGKILL'); await ended;
  }
  for (const store of stores.splice(0)) await store.dispose();
  for (const instance of instances.splice(0)) await instance.close();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function fixture() {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'reviewed-backend-'))); roots.push(home);
  const directory = path.join(home, 'execution'); await fs.mkdir(directory, { mode: 0o700 });
  await fs.writeFile(path.join(directory, 'owner.pid'), String(process.pid));
  const instance = (await RuntimeInstallation.open(home))!; instances.push(instance);
  const runtime = 'a'.repeat(64), runtimeRoot = instance.releasePath(runtime), dist = path.join(runtimeRoot, 'packages/0/dist');
  await fs.mkdir(path.join(dist, 'daemon'), { recursive: true });
  await fs.mkdir(path.join(dist, '../node_modules'));
  const require = createRequire(import.meta.url);
  await fs.symlink(path.dirname(require.resolve('tsx/package.json')), path.join(dist, '../node_modules/tsx'), 'dir');
  await fs.writeFile(path.join(dist, '../package.json'), '{"type":"module"}');
  const entry = path.join(dist, 'daemon/daemon-entry.js');
  const build = { commit: 'a'.repeat(40), dirty: false, builtAt: '2026-01-01T00:00:00.000Z' };
  await fs.writeFile(entry, `setInterval(() => {}, 1000); process.send({type:'fixture-start'});
    process.on('message', message => { if (message.error) throw Error(message.error);
      process.send({type:'backend-ready',pid:process.pid,build:${JSON.stringify(build)},execution:message.execution}); });`);
  fake.artifact = { runtimeRoot, runtimeHash: runtime, directory: dist, entry, entryHash: 'b'.repeat(64), build, execPath: process.execPath };
  fake.candidate.mockImplementation(async () => fake.artifact);
  await instance.exclusive(() => instance.select(runtime, 0));
  const owner = { id: 'fixture-owner', pid: process.pid, startedAt: build.builtAt };
  const controller = { ownerId: owner.id, controllerId: 'original', epoch: 1 };
  const journal = new ExecutionJournal(path.join(directory, 'controller.json'));
  const handoff = new ControllerHandoff(owner, controller, grant => journal.write({ protocol: 1, owner, grant }));
  const originalTicket = await handoff.prepare(controller, 'failed-candidate'); await handoff.commit(originalTicket);
  let inventory = 'c'.repeat(64);
  const snapshot = (): ExecutionSnapshot => ({ protocol: 1, status: handoff.status(), inventoryDigest: inventory,
    apps: [], workers: [], events: [], acknowledgedEvent: 0, lastEvent: 0, droppedEvents: 0,
    revision: 1, devMode: false, watchedApps: [], watchEnabled: false } as unknown as ExecutionSnapshot);
  fake.snapshot.mockImplementation(async () => structuredClone(snapshot()));
  fake.prepare.mockImplementation(async (expected: ControllerGrant, candidateId: string) => {
    const ticket = await handoff.prepare(expected, candidateId); return { ticket, snapshot: snapshot() };
  });
  fake.cancel.mockImplementation(async (ticket: HandoffTicket) => handoff.abort(ticket.from, ticket));
  fake.config = { protocol: 1, instanceHome: home, directory, cwd: home, scope: 'user', environment: { OMNITRON_HOME: home },
    owner: { artifact: 'd'.repeat(64), unit: 'test-owner.service', label: 'test-owner' },
    backend: { artifact: 'e'.repeat(64), unit: 'test-backend.service', label: 'test-backend' } };
  fake.proof.mockResolvedValue({ lifetime: 'fixture-native-owner' });
  fake.daemon.mockReturnValue({ status: async () => ({ pid: fake.children.at(-1)!.pid,
    execution: { owner, epoch: handoff.status().controller.epoch } }), disconnect: vi.fn() });
  const database = new DaemonStateStore(createNullLogger(), path.join(home, 'data/daemon-state.db')); stores.push(database); database.initSync();
  const registryDigest = ProjectRegistry.readRecoveryDigest(database.dbPath);
  const boot: BackendBootRecord = { protocol: 1, createdAt: build.builtAt, previousEntry: entry, previousPid: 999999,
    cwd: home, environment: { OMNITRON_HOME: home },
    daemonConfig: { ...DEFAULT_DAEMON_CONFIG, pidFile: path.join(home, 'daemon.pid'), socketPath: path.join(home, 'daemon.sock'),
      executionHost: { enabled: true, directory } },
    state: { protocol: 1, ticket: originalTicket, watchConfig: { ...DEFAULT_ECOSYSTEM, apps: [] }, infrastructure: null,
      projects: { projects: [], infrastructure: [], stacks: [], resumeBackoff: [], reconciling: false }, executionInventory: 'f'.repeat(64) } };
  const checkpoint = path.join(directory, 'handoff-original.json'); await writePrivateRecord(checkpoint, boot);
  // The monitor constructs its state independently, in a different property
  // order from the handoff producer. Do not derive this fixture by object rest.
  const certifiedState: BackendRecoveryRecord['state'] = { protocol: 1,
    watchConfig: structuredClone(boot.state.watchConfig), projects: structuredClone(boot.state.projects),
    infrastructure: structuredClone(boot.state.infrastructure), executionInventory: boot.state.executionInventory };
  const certified = { ...boot, state: certifiedState, controller, runtimeHash: runtime, registryDigest };
  const recovery = new BackendRecoveryJournal(directory); recovery.publish(certified); recovery.invalidate('Failed candidate startup'); await recovery.close();
  await instance.exclusive(async () => { instance.beginActivation('1'.repeat(64), runtime, checkpoint); });
  const fence = await prepareReviewedBackendRecovery(checkpoint, home);
  const id = randomUUID(), file = path.join(home, 'runtime', `supervisor-transition-${id}.json`);
  const plan: SupervisorTransition = { protocol: 1, id, phase: 'started', createdAt: build.builtAt,
    before: { ...fake.config, backend: { ...fake.config.backend, artifact: '2'.repeat(64) } }, after: fake.config,
    unit: { file: path.join(home, 'guardian.unit'), before: 'old unit', after: 'new unit' },
    backend: { runtime, pid: boot.previousPid, control: path.join(directory, 'c-original.sock'), socket: boot.daemonConfig.socketPath },
    guardianPid: 999998, owner: { id: owner.id, pid: owner.pid, inventory }, selectionRevision: fence.selection.revision,
    checkpoint, recovery: fence };
  await writePrivateRecord(file, plan);
  const intent = supervisorTransitionIntentDigest(plan);
  await instance.exclusive(async () => instance.holdReviewedRecovery(fence.activation, fence.selection, { planId: id, planFile: file, planSha256: intent }));
  fake.launch.mockImplementation(async (child: ChildProcess, bootFile: string) => {
    const next = JSON.parse(await fs.readFile(bootFile, 'utf8')) as BackendBootRecord;
    await handoff.commit(next.state.ticket);
    // Real SQLite journal transitions mirror the admitted backend lifecycle:
    // startup invalidates the old certificate, then publishes the new writer.
    const nextJournal = new BackendRecoveryJournal(directory);
    try {
      nextJournal.invalidate('Controller startup has not published a recovery snapshot');
      const { ticket, ...state } = next.state;
      child.send({ execution: { owner, phase: 'active', epoch: next.state.ticket.to.epoch } });
      const nextRecord = { ...next, state, previousPid: child.pid!, previousEntry: entry, controller: ticket.to, runtimeHash: runtime, registryDigest };
      nextJournal.publish(await fake.certificate(nextRecord));
    } finally { await nextJournal.close(); }
  });
  return { home, directory, instance, database, boot, checkpoint, fence, plan, file, intent, handoff,
    changeInventory: () => { inventory = '9'.repeat(64); }, invoke: () => recoverReviewedBackend(fake.config!, { plan: file, sha256: intent }) };
}

it('restores one harmless child from a new lineage checkpoint and accepts the new real SQLite certificate', async () => {
  const f = await fixture();
  const original = await fs.readFile(f.checkpoint);
  const result = await f.invoke();
  expect(fake.children).toHaveLength(1); expect(result.pid).toBe(fake.children[0]!.pid);
  expect(f.instance.activation()).toBeNull(); expect(f.instance.selection()?.revision).toBe(f.fence.selection.revision + 1);
  expect(await fs.readFile(f.checkpoint)).toEqual(original);
  const next = JSON.parse(await fs.readFile(result.checkpoint, 'utf8'));
  expect(next.reviewedRecovery).toMatchObject({ originalCheckpoint: f.checkpoint,
    originalCheckpointSha256: f.fence.originalCheckpointSha256, historicalExecutionDelta: 'unknown', acceptedInventoryDigest: f.fence.inventoryDigest });
  const journal = new BackendRecoveryJournal(f.directory, { readOnly: true });
  try { const current = journal.read(); expect(current?.status).toBe('ready');
    if (current?.status === 'ready') { expect(current.record.previousPid).toBe(result.pid); expect(hash(current.record)).not.toBe(f.fence.certifiedRecoveryRecordSha256); }
  } finally { await journal.close(); }
});

it('waits passively for the admitted writer to replace its real startup-invalid certificate without spawning again', async () => {
  const f = await fixture();
  const publication = Promise.withResolvers<void>();
  fake.certificate.mockImplementationOnce(async record => { await publication.promise; return record; });
  let settled = false;
  const recovery = f.invoke().finally(() => { settled = true; });
  try {
    await vi.waitFor(() => expect(fake.certificate).toHaveBeenCalledTimes(1));
    const journal = new BackendRecoveryJournal(f.directory, { readOnly: true });
    try { expect(journal.read()).toMatchObject({ status: 'invalid', reason: 'Failed candidate startup',
      reasons: ['Failed candidate startup', 'Controller startup has not published a recovery snapshot'] }); }
    finally { await journal.close(); }
    expect(settled).toBe(false); expect(fake.children).toHaveLength(1);
  } finally { publication.resolve(); await recovery; }
  await expect(recovery).resolves.toMatchObject({ pid: fake.children[0]!.pid });
  expect(fake.prepare).toHaveBeenCalledTimes(1); expect(fake.children).toHaveLength(1);
});

it.each([false, true])('rechecks the whole fence after temporary activity on the restored owner, inventory changes=%s', async changed => {
  const f = await fixture();
  const snapshot = fake.snapshot.getMockImplementation()!;
  let restoredReads = 0;
  fake.snapshot.mockImplementation(async () => {
    const current = await snapshot();
    if (current.status.controller.epoch > f.fence.controller.epoch) {
      restoredReads++;
      if (restoredReads === 2) current.status.inFlight = 1;
      if (changed && restoredReads >= 3) {
        current.status.inFlight = 1;
        current.inventoryDigest = '9'.repeat(64);
      }
    }
    return current;
  });
  if (changed) {
    await expect(f.invoke()).rejects.toThrow('Reviewed execution inventory changed');
    expect(restoredReads).toBe(3);
    expect(f.instance.activation()?.reviewedRecovery?.phase).toBe('unconfirmed');
  } else {
    await expect(f.invoke()).resolves.toMatchObject({ ownerPid: f.fence.owner.pid, epoch: f.fence.controller.epoch + 1 });
    expect(restoredReads).toBeGreaterThan(2);
    expect(f.instance.activation()).toBeNull();
  }
  expect(fake.prepare).toHaveBeenCalledOnce();
  expect(fake.children).toHaveLength(1);
});

it.each(['writer', 'registry', 'inventory', 'configuration'])('rejects a contradictory new %s certificate instead of waiting or retrying', async variant => {
  const f = await fixture();
  fake.certificate.mockImplementationOnce(async (record: BackendRecoveryRecord) => ({ ...record,
    ...(variant === 'writer' ? { controller: { ...record.controller, controllerId: 'foreign' } } : {}),
    ...(variant === 'registry' ? { registryDigest: '8'.repeat(64) } : {}),
    ...(variant === 'inventory' ? { state: { ...record.state, executionInventory: '8'.repeat(64) } } : {}),
    ...(variant === 'configuration' ? { state: { ...record.state, watchConfig: { ...record.state.watchConfig,
      apps: [{ name: 'unreviewed-restored-app', script: './other.js' }] } } } : {}),
  }));
  await expect(f.invoke()).rejects.toThrow('different writer, registry, runtime, execution inventory or configuration');
  expect(fake.children).toHaveLength(1); expect(fake.children[0]!.signalCode).not.toBeNull();
  expect(fake.prepare).toHaveBeenCalledTimes(1); expect(f.instance.activation()?.reviewedRecovery?.phase).toBe('unconfirmed');
});

it.each(['inventory', 'registry', 'checkpoint', 'selection', 'activation', 'owner', 'grant', 'native lifetime', 'plan'])
('refuses %s drift before a new ticket or child', async drift => {
  const f = await fixture();
  if (drift === 'inventory') f.changeInventory();
  if (drift === 'registry') f.database.upsertProjectSync({ name: 'another', path: f.home, added_at: f.boot.createdAt, last_seen: f.boot.createdAt });
  if (drift === 'checkpoint') await fs.appendFile(f.checkpoint, '\n');
  if (drift === 'selection' || drift === 'activation') {
    const db = new DaemonStateStore(createNullLogger(), path.join(f.home, 'runtime/state.db')); stores.push(db);
    const key = 'runtime.' + drift, value = drift === 'selection' ? { ...f.fence.selection, revision: 19 } : { ...f.instance.activation(), candidate: '8'.repeat(64) };
    db.kvSetSync(key, value);
  }
  if (drift === 'owner') fake.snapshot.mockImplementation(async () => ({ status: { ...f.handoff.status(), owner: { ...f.fence.owner, id: 'foreign' } }, inventoryDigest: f.fence.inventoryDigest }));
  if (drift === 'grant') { const ticket = await f.handoff.prepare(f.handoff.status().controller, 'foreign'); await f.handoff.commit(ticket); }
  if (drift === 'native lifetime') fake.proof.mockResolvedValue({ lifetime: 'reused-owner-pid' });
  if (drift === 'plan') await writePrivateRecord(f.file, { ...f.plan, unit: { ...f.plan.unit, after: 'changed intent' } });
  await expect(f.invoke()).rejects.toThrow();
  expect(fake.prepare).not.toHaveBeenCalled(); expect(fake.children).toHaveLength(0);
  expect(f.instance.activation()?.reviewedRecovery?.phase).toBe('held');
});

it('submits the approved grant to the real handoff fence even when takeover races its final observation', async () => {
  const f = await fixture();
  fake.prepare.mockImplementationOnce(async (expected: ControllerGrant, candidateId: string) => {
    const ticket = await f.handoff.prepare(f.handoff.status().controller, 'foreign'); await f.handoff.commit(ticket);
    return { ticket: await f.handoff.prepare(expected, candidateId), snapshot: await fake.snapshot() };
  });
  await expect(f.invoke()).rejects.toThrow('no longer owns');
  expect(fake.prepare.mock.calls[0]![0]).toEqual(f.fence.controller); expect(fake.children).toHaveLength(0);
  expect(f.instance.activation()?.reviewedRecovery?.phase).toBe('unconfirmed');
  await expect(f.invoke()).rejects.toThrow('earlier attempt'); expect(fake.prepare).toHaveBeenCalledTimes(1);
});

it('rejects an inventory change during owner prepare and cancels only its uncommitted ticket', async () => {
  const f = await fixture();
  fake.prepare.mockImplementationOnce(async (expected: ControllerGrant, candidateId: string) => {
    const ticket = await f.handoff.prepare(expected, candidateId); f.changeInventory(); return { ticket, snapshot: await fake.snapshot() };
  });
  await expect(f.invoke()).rejects.toThrow('Reviewed execution inventory changed'); expect(fake.children).toHaveLength(0);
  expect(fake.cancel).toHaveBeenCalledTimes(1); expect(f.handoff.status().controller).toEqual(f.fence.controller);
});

it('identifies the rotating pool when its worker changes between native owner observations', async () => {
  const f = await fixture();
  const before = { ...await fake.snapshot(),
    apps: [{ info: { name: 'files', pid: 4000, restarts: 0 }, startedAt: 1,
      children: [], pools: [{ name: 'transform', workerIds: ['first'] }] }],
    workers: [{ info: { id: 'first', startTime: 2 }, pid: 4001 }] };
  const after = { ...before, inventoryDigest: '9'.repeat(64),
    apps: [{ ...before.apps[0]!, pools: [{ name: 'transform', workerIds: ['second'] }] }],
    workers: [{ info: { id: 'second', startTime: 3 }, pid: 4002 }] };
  const { projectExecutionIdentity } = await import('../../src/shared/execution-identity.js');
  const identity = projectExecutionIdentity(before);
  if (!identity) throw Error('Expected a valid test pool');
  fake.snapshot.mockResolvedValueOnce(before).mockResolvedValueOnce(after);
  await expect(checkReviewedBackendRecovery({ ...f.fence, identity })).rejects.toThrow('worker pools: "files/transform"');
  expect(fake.prepare).not.toHaveBeenCalled();
  expect(f.instance.activation()?.reviewedRecovery?.phase).toBe('held');
});

it('rechecks the exact prepared receipt after artifact verification before creating any child', async () => {
  const f = await fixture();
  fake.verifyEntry.mockImplementationOnce(async () => { f.changeInventory(); });
  await expect(f.invoke()).rejects.toThrow('inventory changed');
  expect(fake.children).toHaveLength(0); expect(fake.prepare).toHaveBeenCalledTimes(1); expect(fake.cancel).toHaveBeenCalledTimes(1);
  expect(f.handoff.status().controller).toEqual(f.fence.controller);
  expect(f.instance.activation()?.reviewedRecovery?.phase).toBe('unconfirmed');
});

it('detects rotation during final artifact verification, stops only its child and retains the failed hold', async () => {
  const f = await fixture();
  fake.candidate.mockImplementationOnce(async () => fake.artifact).mockImplementationOnce(async () => {
    f.changeInventory(); return fake.artifact;
  });
  await expect(f.invoke()).rejects.toThrow('inventory changed');
  expect(fake.children).toHaveLength(1); expect(fake.children[0]!.signalCode).not.toBeNull();
  expect(f.instance.selection()?.revision).toBe(f.fence.selection.revision);
  expect(f.instance.activation()?.reviewedRecovery).toMatchObject({ phase: 'unconfirmed', checkpoint: expect.any(String) });
  const activation = f.instance.activation();
  expect(await inspectHeldBackendRecovery(f.instance)).toMatchObject({ certificate: 'ready', durableGrantMatches: true,
    writerMatches: true, registryMatches: true, environmentMatches: true, projectState: 'certified' });
  expect(f.instance.activation()).toEqual(activation);
  expect(fake.prepare).toHaveBeenCalledOnce();
});

it('preserves a committed grant after its writer exits with an invalidated SQLite certificate', async () => {
  const f = await fixture();
  const original = await fs.readFile(f.checkpoint);
  const entered = Promise.withResolvers<void>();
  const stopped = Promise.withResolvers<void>();
  fake.launch.mockImplementationOnce(async (child: ChildProcess, file: string) => {
    const next = JSON.parse(await fs.readFile(file, 'utf8')) as BackendBootRecord;
    const { ticket, ...state } = next.state;
    await f.handoff.commit(ticket);
    const journal = new BackendRecoveryJournal(f.directory);
    try {
      journal.publish({ ...next, state, previousPid: child.pid!, previousEntry: fake.artifact!.entry,
        controller: ticket.to, runtimeHash: fake.artifact!.runtimeHash, registryDigest: f.fence.registryDigest });
      journal.invalidate('loadProjectConfig');
      entered.resolve();
      await stopped.promise;
    } finally { await journal.close(); }
  });
  const failure = expect(f.invoke()).rejects.toThrow('Candidate backend exited');
  try {
    await entered.promise;
    const child = fake.children[0]!;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  } finally { stopped.resolve(); }
  await failure;
  const hold = f.instance.activation()?.reviewedRecovery;
  expect(hold).toMatchObject({ phase: 'unconfirmed', planId: f.plan.id, checkpoint: expect.any(String) });
  const derived = JSON.parse(await fs.readFile(hold!.checkpoint!, 'utf8')) as BackendBootRecord;
  const receipt = new BackendRecoveryJournal(f.directory, { readOnly: true });
  try {
    expect(receipt.read()).toMatchObject({ status: 'invalid', reason: 'loadProjectConfig', previous: {
      previousPid: fake.children[0]!.pid, controller: derived.state.ticket.to, registryDigest: f.fence.registryDigest,
    } });
  } finally { await receipt.close(); }
  expect(f.handoff.status()).toMatchObject({ phase: 'active', controller: derived.state.ticket.to, pending: derived.state.ticket });
  expect(f.instance.selection()).toEqual(f.fence.selection);
  const facts = await inspectHeldBackendRecovery(f.instance);
  expect(facts).toMatchObject({ admittedEpoch: derived.state.ticket.to.epoch, durableGrantMatches: true,
    registryMatches: true, writerMatches: true, environmentMatches: true, writerPid: fake.children[0]!.pid,
    certificate: 'invalid', projectState: 'unconfirmed', invalidation: { reason: 'loadProjectConfig' } });
  expect(facts).not.toHaveProperty('environment');
  const review = facts.currentStateReview!;
  expect(review).toMatch(/^[a-f0-9]{64}$/);
  fake.shutdown.mockRejectedValueOnce(Error('Owner is still running'));
  await expect(acceptColdBackendRecovery(f.instance, review)).rejects.toThrow('Owner is still running');
  expect(f.instance.coldRecoveryDecision(review)).toBeNull();
  expect(f.instance.activation()?.reviewedRecovery).toEqual(hold);
  f.database.kvSetSync('lifecycle:test', { phase: 'changed' });
  await expect(acceptColdBackendRecovery(f.instance, review)).rejects.toThrow('Current-state review differs');
  f.database.kvDeleteSync('lifecycle:test');
  // Old writers only recorded the first invalidation. Their earlier snapshot cannot establish the final state.
  const oldJournal = new DaemonStateStore(createNullLogger(), path.join(f.directory, 'recovery.db'));
  stores.push(oldJournal);
  const saved = oldJournal.kvGetSync<Record<string, unknown>>('backend.recovery')!;
  const { reasons: _reasons, additionalReasons: _additional, ...legacy } = saved;
  oldJournal.kvSetSync('backend.recovery', legacy);
  expect(await inspectHeldBackendRecovery(f.instance)).toMatchObject({ projectState: 'unconfirmed',
    invalidation: { history: 'first-reason-only' } });
  f.database.upsertProjectSync({ name: 'new', path: path.join(f.home, 'new'), added_at: f.boot.createdAt, last_seen: f.boot.createdAt });
  expect(await inspectHeldBackendRecovery(f.instance)).toMatchObject({ registryMatches: false, projectState: 'unconfirmed' });
  await writePrivateRecord(hold!.checkpoint!, { ...derived, cwd: f.directory });
  await expect(inspectHeldBackendRecovery(f.instance)).rejects.toThrow('Admitted checkpoint differs');
  expect(f.instance.activation()?.reviewedRecovery).toEqual(hold);
  await expect(f.invoke()).rejects.toThrow('earlier attempt');
  expect(fake.prepare).toHaveBeenCalledOnce(); expect(fake.children).toHaveLength(1);
  expect(await fs.readFile(f.checkpoint)).toEqual(original);
});

it('archives the admitted evidence exactly once before allowing a cold start from current intent', async () => {
  const f = await fixture();
  fake.candidate.mockImplementationOnce(async () => fake.artifact).mockImplementationOnce(async () => {
    f.changeInventory(); return fake.artifact;
  });
  await expect(f.invoke()).rejects.toThrow('inventory changed');
  const held = f.instance.activation()!;
  const checkpointBytes = await fs.readFile(held.reviewedRecovery!.checkpoint!);
  const journal = new BackendRecoveryJournal(f.directory);
  journal.invalidate('loadProjectConfig');
  const receipt = journal.read();
  try {
    const report = await inspectHeldBackendRecovery(f.instance);
    const review = report.currentStateReview!;
    expect(review).toBeTruthy();
    const decision = await acceptColdBackendRecovery(f.instance, review);
    expect(decision).toMatchObject({ review, epoch: report.admittedEpoch, historicalState: 'unverified' });
    expect(f.instance.activation()).toBeNull();
    expect(f.instance.selection()).toEqual(f.fence.selection);
    expect(await acceptColdBackendRecovery(f.instance, review)).toEqual(decision);
    expect(fake.shutdown).toHaveBeenCalledOnce();
    expect(journal.read()).toEqual(receipt);
    journal.invalidate('New boot');
    const history = new DaemonStateStore(createNullLogger(), path.join(f.home, 'runtime/state.db')); stores.push(history);
    const archive = history.kvGetSync<{ evidence: { receipt: unknown; admitted: BackendBootRecord } }>('runtime.recovery-history.' + review);
    expect(archive?.evidence.receipt).toEqual(receipt);
    expect(archive?.evidence.admitted).toEqual(JSON.parse(checkpointBytes.toString()));
    expect(await fs.readFile(held.reviewedRecovery!.checkpoint!)).toEqual(checkpointBytes);
  } finally { await journal.close(); }
});

it('does not treat a different owner or foreign controller as a reviewable baseline', async () => {
  const f = await fixture();
  const db = new DaemonStateStore(createNullLogger(), path.join(f.home, 'runtime/state.db')); stores.push(db);
  db.kvSetSync('runtime.activation', f.fence.activation);
  const ticket = await f.handoff.prepare(f.handoff.status().controller, 'foreign'); await f.handoff.commit(ticket);
  await expect(prepareReviewedBackendRecovery(f.checkpoint, f.home)).rejects.toThrow('original activation candidate grant');
  expect(fake.prepare).not.toHaveBeenCalled(); expect(fake.children).toHaveLength(0);
});

it.each(['watch configuration', 'project configuration'])('still rejects genuine %s drift despite independent certificate property order', async variant => {
  const f = await fixture();
  const journal = new BackendRecoveryJournal(f.directory);
  try {
    const state = journal.read();
    if (state?.status !== 'invalid' || !state.previous) throw Error('Missing fixture certificate');
    const changed = structuredClone(state.previous);
    if (variant === 'watch configuration') changed.state.watchConfig.apps.push({ name: 'unreviewed-app', script: './other.js' });
    else changed.state.projects.reconciling = true;
    journal.publish(changed); journal.invalidate('Configuration changed before preparation');
  } finally { await journal.close(); }
  const db = new DaemonStateStore(createNullLogger(), path.join(f.home, 'runtime/state.db')); stores.push(db);
  db.kvSetSync('runtime.activation', f.fence.activation);
  await expect(prepareReviewedBackendRecovery(f.checkpoint, f.home)).rejects.toThrow('Certified project/configuration ownership differs');
  expect(fake.prepare).not.toHaveBeenCalled(); expect(fake.children).toHaveLength(0);
});

it('refuses reused or unknown retired PID identity without invoking a control socket', async () => {
  const f = await fixture();
  fake.native.mockReturnValue({ state: 'alive', identity: 'unrelated-process' });
  await expect(checkReviewedBackendRecovery(f.fence, { afterGuardianStop: true })).rejects.toThrow('lifetime changed');
  fake.native.mockReturnValue({ state: 'unknown' });
  await expect(f.invoke()).rejects.toThrow('absence is unconfirmed');
  expect(fake.prepare).not.toHaveBeenCalled(); expect(fake.children).toHaveLength(0);
});
