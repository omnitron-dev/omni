import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ config: null as any, selection: null as any, activation: null as any, snapshot: null as any,
  control: vi.fn(), opened: vi.fn(), job: vi.fn(), stopFence: vi.fn(), stopped: vi.fn(), readBoot: vi.fn(), recoveryCheck: vi.fn(), hold: vi.fn() }));
vi.mock('../../src/daemon/reviewed-backend-recovery.js', async original => ({
  ...await original<typeof import('../../src/daemon/reviewed-backend-recovery.js')>(),
  checkReviewedBackendRecovery: fake.recoveryCheck, prepareReviewedBackendRecovery: vi.fn(),
}));
vi.mock('../../src/daemon/managed-runtime.js', async original => ({
  ...await original<typeof import('../../src/daemon/managed-runtime.js')>(),
  readManagedRuntime: async () => fake.config, managedJobPid: fake.job, managedGuardianStopFence: fake.stopFence, assertGuardianStopped: fake.stopped,
}));
vi.mock('../../src/daemon/backend-handoff-types.js', async original => ({
  ...await original<typeof import('../../src/daemon/backend-handoff-types.js')>(), readBackendBootRecord: fake.readBoot,
}));
vi.mock('../../src/daemon/runtime-installation.js', () => ({ RuntimeInstallation: { open: fake.opened, openReadOnly: (home: string) => fake.opened(home, { readOnly: true }) } }));
vi.mock('../../src/daemon/execution-client.js', () => ({ ExecutionClient: class {
  async connect() { return fake.snapshot; } async close() {}
} }));
vi.mock('../../src/daemon/private-control-client.js', async original => ({
  ...await original<typeof import('../../src/daemon/private-control-client.js')>(), privateControlClient: fake.control,
}));
import { checkSystemGuardian, guardianUnitProperties, replaceGuardianExec } from '../../src/daemon/system-guardian-unit.js';
import type { ManagedRuntime } from '../../src/daemon/managed-runtime.js';
import { applySupervisorTransition, readSupervisorTransition, supervisorTransitionIntentDigest, type SupervisorTransition } from '../../src/daemon/supervisor-transition.js';
import { writePrivateRecord } from '../../src/daemon/execution-journal.js';
import { projectExecutionIdentity } from '../../src/shared/execution-identity.js';

const roots: string[] = [];
beforeEach(() => {
  vi.resetAllMocks(); fake.activation = null;
  fake.opened.mockResolvedValue({ exclusive: vi.fn(async (fn: () => unknown) => fn()), close: vi.fn(), artifact: vi.fn(), settledSelection: () => fake.selection,
    selection: () => fake.selection, activation: () => fake.activation, holdReviewedRecovery: fake.hold });
});
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { force: true, recursive: true }); });
async function fixture(phase = 'prepared') {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-guardian-plan-')); roots.push(home);
  const id = randomUUID(), file = path.join(home, 'runtime', `supervisor-transition-${id}.json`);
  const before = { protocol: 1, instanceHome: home, scope: 'user', directory: path.join(home, 'e'), cwd: home,
    environment: { OMNITRON_HOME: home }, owner: { label: 'dev.omnitron.test.owner', unit: 'omnitron-test-owner.service', artifact: 'a'.repeat(64) },
    backend: { label: 'dev.omnitron.test.backend', unit: 'omnitron-test-backend.service', artifact: 'b'.repeat(64) } };
  const after = { ...before, backend: { ...before.backend, artifact: 'c'.repeat(64) } };
  const plan = { protocol: 1, id, phase, createdAt: new Date().toISOString(), before, after,
    unit: { file: path.join(home, 'backend.unit'), before: 'original unit', after: 'replacement unit' },
    backend: { runtime: 'b'.repeat(64), pid: 1001, control: path.join(home, 'e/c.sock'), socket: path.join(home, 'daemon.sock') },
    guardianPid: 1002, owner: { id: 'owner', pid: 1003, inventory: 'd'.repeat(64) } };
  fake.config = phase === 'started' ? after : before; fake.selection = { current: plan.backend.runtime };
  fake.snapshot = { status: { owner: { id: plan.owner.id, pid: plan.owner.pid } }, inventoryDigest: plan.owner.inventory };
  await fs.writeFile(plan.unit.file, phase === 'started' ? plan.unit.after : plan.unit.before, { mode: 0o600 });
  await writePrivateRecord(file, plan);
  return { file, plan };
}

it('refuses an edited native unit before preparing or retiring a backend', async () => {
  const { file, plan } = await fixture();
  await fs.writeFile(plan.unit.file, 'unrelated unit');
  await expect(applySupervisorTransition(file)).rejects.toThrow('unit changed');
  expect(fake.control).not.toHaveBeenCalled(); expect(fake.job).not.toHaveBeenCalled();
});
it('revalidates configuration and unit contents before resuming an interrupted bootstrap', async () => {
  const { file, plan } = await fixture('started');
  await fs.writeFile(plan.unit.file, 'edited while coordinator was offline');
  await expect(applySupervisorTransition(file)).rejects.toThrow('changed before resume');
  expect(fake.job).not.toHaveBeenCalled();
  await fs.writeFile(plan.unit.file, plan.unit.after); fake.config = plan.before;
  await expect(applySupervisorTransition(file)).rejects.toThrow('changed before resume');
  expect(fake.job).not.toHaveBeenCalled();
});
it('refuses a changed application inventory without changing OS jobs or backend admission', async () => {
  const { file } = await fixture('started'); fake.snapshot.inventoryDigest = 'e'.repeat(64);
  await expect(applySupervisorTransition(file)).rejects.toThrow('application inventory changed');
  expect(fake.control).not.toHaveBeenCalled(); expect(fake.job).not.toHaveBeenCalled();
});
it('cannot use a plan to change owner configuration or another instance', async () => {
  const { file, plan } = await fixture();
  plan.after.owner = { ...plan.after.owner, artifact: 'f'.repeat(64) };
  await writePrivateRecord(file, plan);
  await expect(applySupervisorTransition(file)).rejects.toThrow('Invalid supervisor transition');
  expect(fake.opened).not.toHaveBeenCalled();
});
it('rejects a startup selection changed after preparation', async () => {
  const { file } = await fixture(); fake.selection = { current: 'f'.repeat(64) };
  await expect(applySupervisorTransition(file)).rejects.toThrow('selection changed');
  expect(fake.control).not.toHaveBeenCalled(); expect(fake.job).not.toHaveBeenCalled();
});

it('preserves site-specific working directory, restart and account directives when preparing a reversible system guardian', async () => {
  const { plan } = await fixture();
  const before = { ...plan.before, scope: 'system' } as ManagedRuntime;
  const after = { ...before, backend: plan.after.backend };
  const root = path.join(before.instanceHome, 'runtime/releases', before.backend.artifact);
  const exec = 'ExecStart=' + root + '/node ' + root + '/packages/0/dist/daemon/managed-entry.js backend';
  const unit = '[Service]\nUser=root\n' + exec + '\nRestart=on-failure\nWorkingDirectory=/opt/immutable/old-version\n';
  const changed = replaceGuardianExec(unit, before, after);
  expect(changed).toBe(unit.replaceAll(before.backend.artifact, after.backend.artifact));
  expect(replaceGuardianExec(changed, after, before)).toBe(unit);
  for (const invalid of [unit.replace(' backend\n', ' owner\n'), unit.replace(exec, ''), unit + exec + '\n']) {
    expect(() => replaceGuardianExec(invalid, before, after)).toThrow('ExecStart');
  }
});
it('blocks stoppage when a system guardian cascades, has external hooks, uses drop-ins or has drifted', () => {
  const unit = 'omnitron-fixture.service';
  const facts = { ...Object.fromEntries(guardianUnitProperties.map(key => [key, ''])),
    FragmentPath: '/etc/systemd/system/' + unit, LoadState: 'loaded', NeedDaemonReload: 'no', User: 'root', Group: 'root', KillMode: 'control-group' };
  expect(() => checkSystemGuardian(unit, facts, true)).not.toThrow();
  for (const [key, value] of Object.entries({ RequiredBy: 'owner.service', PropagatesStopTo: 'owner.service', ConsistsOf: 'db.service',
    ExecStop: 'custom hook', DropInPaths: '/etc/systemd/system/override.conf', OnFailure: 'reboot.service',
    NeedDaemonReload: 'yes', FragmentPath: '/other/unit', User: 'someone' })) {
    expect(() => checkSystemGuardian(unit, { ...facts, [key]: value }, true)).toThrow();
  }
  expect(() => replaceGuardianExec('[Service]\nExecStop=/bin/kill\n', {} as ManagedRuntime, {} as ManagedRuntime)).toThrow('hooks');
  const { ConsistsOf: _unknown, ...incomplete } = facts as Record<string, string>;
  expect(() => checkSystemGuardian(unit, incomplete, true)).toThrow('ConsistsOf');
});


it('checks prepare, admission and rollback without taking the installation lease or writing the journal', async () => {
  const { file, plan } = await fixture();
  plan.backend.runtime = 'e'.repeat(64); fake.selection.current = plan.backend.runtime;
  Object.assign(plan, { linuxStop: { group: '/system.slice/daemon.service', directoryId: 'f'.repeat(64),
    guardianProcess: '5'.repeat(64), backendProcess: '6'.repeat(64) } });
  await writePrivateRecord(file, plan);
  const source = await fs.readFile(file);
  fake.job.mockResolvedValue(plan.guardianPid);
  const state = { pid: plan.backend.pid, instanceHome: plan.before.instanceHome, runtime: {
    phase: 'active', owner: plan.owner, connection: { status: 'connected' }, blockers: { terminalSessions: 0, fileTransfers: 0, pipelineRuns: 0, releaseBuilds: 0, backupOperations: 0 } },
    retired: false, ticketId: null as string | null };
  const control = { status: vi.fn(async () => state), prepare: vi.fn(), retire: vi.fn() };
  fake.control.mockResolvedValue({ service: control, close: vi.fn() });
  await expect(applySupervisorTransition(file, { checkOnly: true })).resolves.toMatchObject({ id: plan.id, phase: 'prepared', checked: true });
  const installation = await fake.opened.mock.results[0]!.value;
  expect(fake.opened).toHaveBeenCalledWith(plan.before.instanceHome, { readOnly: true });
  expect(installation.artifact.mock.calls.map((args: string[]) => args[0]).sort()).toEqual([
    plan.before.backend.artifact, plan.after.backend.artifact, plan.backend.runtime].sort());
  expect(installation.exclusive).not.toHaveBeenCalled(); expect(control.prepare).not.toHaveBeenCalled(); expect(control.retire).not.toHaveBeenCalled();
  expect(await fs.readFile(file)).toEqual(source);
  state.runtime.blockers.terminalSessions = 1;
  await expect(applySupervisorTransition(file, { checkOnly: true })).rejects.toThrow(/operations block/);
  state.runtime.blockers.terminalSessions = 0; state.ticketId = 'foreign';
  await expect(applySupervisorTransition(file, { checkOnly: true })).rejects.toThrow(/transfer/);
  expect(await fs.readFile(file)).toEqual(source);
});
it('requires reconciliation of an interrupted check and reports completion without revalidating a forward plan', async () => {
  const interrupted = await fixture('preparing');
  await expect(applySupervisorTransition(interrupted.file, { checkOnly: true })).rejects.toThrow(/reconcile/);
  const completed = await fixture('complete');
  await expect(applySupervisorTransition(completed.file, { checkOnly: true })).resolves.toMatchObject({ phase: 'complete', checked: false });
  expect(fake.opened).not.toHaveBeenCalled();
});

it('checks the Linux stop fence again after retirement before issuing a native stop, including resume', async () => {
  const { plan, file } = await fixture('retired');
  Object.assign(plan, { linuxStop: { group: '/system.slice/omnitron.service', directoryId: 'd'.repeat(64),
    guardianProcess: 'e'.repeat(64), backendProcess: 'f'.repeat(64) } });
  await writePrivateRecord(file, plan);
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const { PidManager } = await import('../../src/daemon/pid-manager.js');
  const alive = vi.spyOn(PidManager, 'isProcessAlive').mockImplementation(pid => pid === plan.guardianPid);
  try {
    Object.defineProperty(process, 'platform', { ...original, value: 'linux' });
    fake.job.mockResolvedValue(plan.guardianPid); fake.stopFence.mockRejectedValue(Error('Foreign process in the guardian cgroup'));
    await expect(applySupervisorTransition(file)).rejects.toThrow('Foreign process');
    expect(fake.stopFence).toHaveBeenCalledWith(plan.before, plan.guardianPid, plan.backend.pid, expect.objectContaining({ group: expect.any(String) }), true);
    expect(JSON.parse(await fs.readFile(file, 'utf8')).phase).toBe('retired');
    expect(fake.control).not.toHaveBeenCalled();
  } finally { Object.defineProperty(process, 'platform', original); alive.mockRestore(); }
});
it('rejects a selection revision that changed away and back to the same artifact', async () => {
  const { file, plan } = await fixture();
  Object.assign(plan, { selectionRevision: 4 }); await writePrivateRecord(file, plan);
  fake.selection.revision = 6;
  await expect(applySupervisorTransition(file, { checkOnly: true })).rejects.toThrow('selection changed');
  expect(fake.control).not.toHaveBeenCalled();
});

it.each([false, true])('rechecks the kill scope after drain and fences retirement when abort fails=%s', async abortFails => {
  const { file, plan } = await fixture();
  Object.assign(plan, { linuxStop: { group: '/system.slice/omnitron.service', directoryId: 'd'.repeat(64),
    guardianProcess: 'e'.repeat(64), backendProcess: 'f'.repeat(64) } });
  await writePrivateRecord(file, plan);
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const ticketId = randomUUID(), operations = {
    status: async () => ({ pid: plan.backend.pid, instanceHome: plan.before.instanceHome, runtime: { phase: 'active', owner: plan.owner,
      blockers: { terminalSessions: 0, fileTransfers: 0, pipelineRuns: 0, releaseBuilds: 0, backupOperations: 0 }, connection: { status: 'connected' } } }),
    prepare: vi.fn(async () => ({ file: path.join(plan.before.directory, 'handoff-' + ticketId + '.json'), ticketId })),
    abort: vi.fn(async () => { if (abortFails) throw Error('Retirement is uncertain'); }), retire: vi.fn(),
  };
  try {
    Object.defineProperty(process, 'platform', { ...original, value: 'linux' });
    fake.job.mockResolvedValue(plan.guardianPid); fake.stopFence.mockResolvedValueOnce({}).mockRejectedValueOnce(Error('Process changed while draining'));
    fake.control.mockResolvedValue({ service: operations, close: vi.fn() });
    fake.readBoot.mockResolvedValue({ previousPid: plan.backend.pid, state: { executionInventory: plan.owner.inventory, ticket: { id: ticketId, ownerId: plan.owner.id, from: { ownerId: plan.owner.id }, to: { controllerId: plan.id, ownerId: plan.owner.id } } } });
    await expect(applySupervisorTransition(file)).rejects.toThrow(abortFails ? /reconcile/ : /while draining/);
    expect(operations.prepare).toHaveBeenCalledOnce(); expect(operations.retire).not.toHaveBeenCalled();
    expect(operations.abort).toHaveBeenCalledWith({ ticketId });
    const journal = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(journal.phase).toBe(abortFails ? 'preparing' : 'prepared');
    expect(Boolean(journal.checkpoint)).toBe(abortFails);
  } finally { Object.defineProperty(process, 'platform', original); }
});

it('resumes a legacy retired journal without a historical stop fence only when no native stop is required', async () => {
  const { file, plan } = await fixture('retired');
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const { PidManager } = await import('../../src/daemon/pid-manager.js');
  const alive = vi.spyOn(PidManager, 'isProcessAlive').mockReturnValue(false);
  try {
    Object.defineProperty(process, 'platform', { ...original, value: 'linux' });
    // A new native job appeared after both former PIDs exited. Updating
    // the unit would affect an unreviewed process, so retain the checkpoint.
    fake.stopped.mockRejectedValue(Error('The previous guardian unit is not verifiably stopped'));
    await expect(applySupervisorTransition(file)).rejects.toThrow(/not verifiably stopped/);
    expect(fake.stopped).toHaveBeenCalledWith(plan.before, undefined);
    expect(fake.stopFence).not.toHaveBeenCalled(); expect(fake.control).not.toHaveBeenCalled();
    expect(JSON.parse(await fs.readFile(file, 'utf8')).phase).toBe('retired');
    expect(await fs.readFile(plan.unit.file, 'utf8')).toBe(plan.unit.before);
  } finally { Object.defineProperty(process, 'platform', original); alive.mockRestore(); }
});


it.each(['prepared', 'retired', 'started'])('names stale worker pools before any dispatch and gives phase-correct advice for %s', async phase => {
  const { file, plan } = await fixture(phase);
  const before = { status: fake.snapshot.status, inventoryDigest: plan.owner.inventory,
    apps: [{ info: { name: 'files', pid: 3000, restarts: 0 }, startedAt: 1,
      children: [], pools: [{ name: 'transform', workerIds: ['old-worker'] }] }],
    workers: [{ info: { id: 'old-worker', startTime: 2 }, pid: 3001 }] };
  Object.assign(plan.owner, { identity: projectExecutionIdentity(before) });
  await writePrivateRecord(file, plan);
  const original = await fs.readFile(file, 'utf8');
  fake.snapshot = structuredClone(before);
  fake.snapshot.inventoryDigest = 'e'.repeat(64);
  fake.snapshot.apps[0].pools[0].workerIds = ['new-worker'];
  fake.snapshot.workers = [{ info: { id: 'new-worker', startTime: 3 }, pid: 3002 }];
  const error = await applySupervisorTransition(file).catch(cause => cause as Error);
  expect(error).toBeInstanceOf(Error);
  if (!(error instanceof Error)) throw new Error('Expected supervisor transition refusal');
  expect(error.message).toContain('worker pools: "files/transform"');
  expect(error.message).toContain(phase === 'prepared' ? 'prepare a new guardian transition plan' : 'Reconcile this transition checkpoint');
  if (phase !== 'prepared') expect(error.message).not.toContain('prepare a new guardian transition plan');
  expect(fake.control).not.toHaveBeenCalled(); expect(fake.job).not.toHaveBeenCalled();
  expect(await fs.readFile(file, 'utf8')).toBe(original);
});

async function reviewedFixture() {
  const source = await fixture();
  const plan = source.plan as unknown as SupervisorTransition;
  plan.selectionRevision = 8;
  plan.checkpoint = path.join(plan.before.directory, `handoff-${randomUUID()}.json`);
  fake.selection = { protocol: 1, revision: 8, current: plan.backend.runtime, previous: null,
    bootstrap: plan.after.backend.artifact, selectedAt: plan.createdAt };
  fake.activation = { candidate: 'e'.repeat(64), previous: plan.backend.runtime,
    checkpoint: plan.checkpoint, startedAt: plan.createdAt };
  plan.recovery = { protocol: 1, instanceHome: plan.before.instanceHome, activation: fake.activation,
    selection: fake.selection, owner: { id: plan.owner.id, pid: plan.owner.pid, startedAt: plan.createdAt },
    inventoryDigest: plan.owner.inventory, originalCheckpointSha256: 'f'.repeat(64),
    certifiedRecoveryRecordSha256: '4'.repeat(64), registryDigest: '5'.repeat(64),
    controller: { ownerId: plan.owner.id, controllerId: 'candidate', epoch: 2 }, pending: null,
    ownerLifetime: 'boot:owner-start', ownerArtifact: plan.before.owner.artifact,
    managedOwnerSha256: '6'.repeat(64), retiredBackendLifetime: 'boot:backend-start',
    identity: { protocol: 1, owner: { id: plan.owner.id, pid: plan.owner.pid }, appCount: 0, workerCount: 0,
      workersDigest: '7'.repeat(64), groups: [] }, historicalExecutionDelta: 'unknown' };
  plan.linuxStop = { group: '/system.slice/fixture.service', directoryId: '1'.repeat(64),
    guardianProcess: '2'.repeat(64), backendProcess: '3'.repeat(64) };
  fake.job.mockResolvedValue(plan.guardianPid);
  const state = { pid: plan.backend.pid, instanceHome: plan.before.instanceHome,
    retired: true, ticketId: 'original-ticket', runtime: { owner: plan.owner } };
  const control = { status: vi.fn(async () => state), prepare: vi.fn(), retire: vi.fn() };
  fake.control.mockResolvedValue({ service: control, close: vi.fn() });
  fake.readBoot.mockResolvedValue({ previousPid: plan.backend.pid, state: { ticket: { id: state.ticketId } } });
  await writePrivateRecord(source.file, plan);
  return { file: source.file, plan, state, control };
}

it('checks explicit retired recovery without rewriting the failed checkpoint, taking a lease or admitting work', async () => {
  const { file, plan, control } = await reviewedFixture();
  const before = await fs.readFile(file);
  await expect(applySupervisorTransition(file, { checkOnly: true })).resolves.toMatchObject({
    checked: true, reviewedRecovery: { historicalExecutionDelta: 'unknown', acceptedInventory: plan.owner.inventory },
  });
  expect(fake.recoveryCheck).toHaveBeenCalledWith(plan.recovery);
  expect(fake.hold).not.toHaveBeenCalled();
  expect((await fake.opened.mock.results[0]!.value).exclusive).not.toHaveBeenCalled();
  expect(control.prepare).not.toHaveBeenCalled(); expect(control.retire).not.toHaveBeenCalled();
  expect(await fs.readFile(file)).toEqual(before);
});

it('refuses changed reviewed ownership before inspecting or stopping OS jobs', async () => {
  const { file } = await reviewedFixture();
  fake.recoveryCheck.mockRejectedValue(Error('Reviewed controller grant changed'));
  await expect(applySupervisorTransition(file)).rejects.toThrow('Reviewed controller grant changed');
  expect(fake.job).not.toHaveBeenCalled(); expect(fake.control).not.toHaveBeenCalled(); expect(fake.hold).not.toHaveBeenCalled();
});

it.each(['active', 'ticket', 'foreign-hold', 'uncertain-hold'])('refuses %s recovery state before a native stop', async variant => {
  const { file, plan, state, control } = await reviewedFixture();
  if (variant === 'active') state.retired = false;
  if (variant === 'ticket') state.ticketId = 'other-ticket';
  if (variant.endsWith('hold')) fake.activation = { ...fake.activation, reviewedRecovery: {
    planId: variant === 'foreign-hold' ? randomUUID() : plan.id, planFile: file,
    planSha256: supervisorTransitionIntentDigest(plan), phase: variant === 'foreign-hold' ? 'held' : 'unconfirmed',
  } };
  await expect(applySupervisorTransition(file)).rejects.toThrow(/retired controller|reviewed recovery|uncertain attempt/);
  expect(fake.hold).not.toHaveBeenCalled(); expect(control.prepare).not.toHaveBeenCalled(); expect(control.retire).not.toHaveBeenCalled();
});

it('seals every authority-bearing field while allowing only progress and result to advance', async () => {
  const { plan } = await reviewedFixture();
  const digest = supervisorTransitionIntentDigest(plan);
  expect(supervisorTransitionIntentDigest({ ...plan, phase: 'started', result: { backendPid: 4001, guardianPid: 4002, ownerPid: plan.owner.pid } })).toBe(digest);
  for (const key of ['protocol', 'id', 'createdAt', 'before', 'after', 'unit', 'backend', 'owner',
    'guardianPid', 'selectionRevision', 'linuxStop', 'recovery'] as const) {
    const modified = { ...plan, [key]: 'edited' } as unknown as SupervisorTransition;
    expect(supervisorTransitionIntentDigest(modified), key).not.toBe(digest);
  }
});

it('binds the progress checkpoint to the immutable failed activation', async () => {
  const { file, plan } = await reviewedFixture();
  plan.checkpoint = path.join(plan.before.directory, 'unrelated.json');
  await writePrivateRecord(file, plan);
  await expect(readSupervisorTransition(file)).rejects.toThrow('Reviewed recovery does not match');
  expect(fake.opened).not.toHaveBeenCalled();
});
