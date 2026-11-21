import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { runtimeArtifactDigest } from '../../src/shared/runtime-artifact.js';
import { RuntimeBackupWindow, type BackupWindowRequest } from '../../src/daemon/runtime-backup-window.js';
import * as privateControl from '../../src/daemon/private-control-client.js';
import { stackStopCommand } from '../../src/commands/stack.js';
import * as managedRuntime from '../../src/daemon/managed-runtime.js';
import * as runtimeHost from '../../src/daemon/runtime-update-host.js';
import * as output from '../../src/commands/output.js';
import { OWNER_LAUNCHD_LABEL, LAUNCHD_LABEL } from '../../src/commands/service-units.js';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecutionOutcomeUnknownError, type ExecutionResource } from '@xec-sh/core';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { Netron } from '@omnitron-dev/titan/netron';
import { UnixSocketTransport } from '@omnitron-dev/titan/netron/transport/unix';
import { Public, Service } from '@omnitron-dev/titan/decorators';
import * as daemonClient from '../../src/daemon/daemon-client.js';
import { backupCreateCommand } from '../../src/commands/backup.js';
import { BackupRpcService } from '../../src/services/backup.rpc-service.js';
import { createAuthContextWrapper } from '../../src/services/auth-context.js';
import { testExecution } from '../fixtures/execution.js';
import { ExecutionService } from '../../src/execution/execution.service.js';
import { recoveryState } from '../../src/daemon/recovery-state.js';
import { OmnitronDaemon } from '../../src/daemon/daemon.js';
import { restartConfigurationDigest } from '../../src/project/runtime-restart.js';
import { BackendRecoveryMonitor } from '../../src/daemon/backend-recovery-monitor.js';
import { BackendRecoveryJournal } from '../../src/daemon/backend-recovery-journal.js';
import { BackendControlService } from '../../src/daemon/backend-control.js';
import { readBackendBootRecord, backendConfigurationDigest } from '../../src/daemon/backend-handoff-types.js';
import { DEFAULT_DAEMON_CONFIG, DEFAULT_ECOSYSTEM } from '../../src/config/defaults.js';
import { fileURLToPath } from 'node:url';
import * as runtimeUpdate from '../../src/daemon/runtime-update.js';
import { writePrivateRecord } from '../../src/daemon/execution-journal.js';
import type { RuntimeUpdatePhase, RuntimeUpdatePlan } from '../../src/shared/dto/runtime-update.js';

const fixture = vi.hoisted(() => ({ home: '', runCandidate: vi.fn() }));
vi.mock('@xec-sh/ops/release', async original => ({ ...await original<Record<string, unknown>>(), releaseCommand: fixture.runCandidate }));
vi.mock('../../src/config/defaults.js', async original => ({
  ...await original<Record<string, unknown>>(), get OMNITRON_HOME() { return fixture.home; },
}));
const { BackupService } = await import('../../src/services/backup.service.js');
const { DaemonStateStore } = await import('../../src/daemon/daemon-state-store.service.js');
const logger = createNullLogger();
let store: InstanceType<typeof DaemonStateStore>, backups: InstanceType<typeof BackupService>, executor: ExecutionService;
let mode: 'complete' | 'wait' | 'unknown';
let submitted: ExecutionResource[];
const containers = { one: 'a'.repeat(64), two: 'b'.repeat(64) };
const image = `sha256:${'c'.repeat(64)}`;
const projects = {
  listProjectRegistrations: () => [{ name: 'one' }, { name: 'two' }], getRunningStacks: () => ['dev'],
  getInfraManager: () => ({ listInstances: () => [], getInstance: (project: keyof typeof containers) => ({
    getConnectionInfo: () => ({ host: '127.0.0.1', port: 5432, user: 'fixture', password: 'never-journal-this' }),
    getPostgresDatabases: () => ['ledger'], getResolvedContainerName: () => project,
  }) }),
};

async function liveControllerFixture() {
  const directory = path.join(fixture.home, 'execution'); fs.mkdirSync(directory, { mode: 0o700 });
  const grant = { ownerId: 'fixture-owner', controllerId: 'fixture-controller', epoch: 1 };
  const snapshot = { status: { owner: { id: grant.ownerId, pid: 123 }, controller: grant, phase: 'active', inFlight: 0 }, inventoryDigest: 'e'.repeat(64) };
  const projectState = { projects: [], stacks: [], infrastructure: [], resumeBackoff: [], reconciling: false };
  const project = { recoveryRegistryDigest: () => 'd'.repeat(64), captureRecoveryState: () => structuredClone(projectState),
    prepareHandoff: vi.fn(async () => structuredClone(projectState)), resumeAfterHandoff: vi.fn() };
  const dc = { ...DEFAULT_DAEMON_CONFIG, executionHost: { enabled: true, directory },
    socketPath: path.join(fixture.home, 'daemon.sock'), pidFile: path.join(fixture.home, 'daemon.pid') };
  const execution = { state: () => ({ phase: 'active', owner: snapshot.status.owner, epoch: grant.epoch }),
    recoverySnapshot: vi.fn(async () => structuredClone(snapshot)), controlledOwnerSnapshot: vi.fn(async () => structuredClone(snapshot)),
    prepare: vi.fn(async (candidateId: string) => ({ snapshot, ticket: { id: randomUUID(), ownerId: grant.ownerId,
      from: grant, to: { ...grant, controllerId: candidateId, epoch: 2 } } })), abort: vi.fn(), abortCandidate: vi.fn() };
  const watchConfig = { ...DEFAULT_ECOSYSTEM, apps: [] };
  const daemon = Object.create(OmnitronDaemon.prototype) as OmnitronDaemon;
  const gate = { drain: vi.fn(async () => ({ drained: true })), reopen: vi.fn() };
  const monitor = new BackendRecoveryMonitor(directory, { runtimeHash: 'a'.repeat(64),
    entry: fileURLToPath(new URL('../../src/daemon/daemon-entry.js', import.meta.url)) } as never, dc, execution as never,
  () => ({ watchConfig, projects: project as never, infrastructure: null }));
  const journal = new BackendRecoveryJournal(directory);
  Object.assign(daemon, { dc, watchConfig, backupService: backups, execution, recoveryMonitor: monitor,
    app: { netron: { inbound: gate }, container: { resolveAsync: async () => project } },
    initializeRecoveryMonitor: async () => null });
  await monitor.start();
  return { daemon, control: new BackendControlService(daemon, vi.fn()), journal, gate, execution,
    close: async () => { await monitor.close(false); await journal.close(); } };
}

beforeEach(() => {
  fixture.runCandidate.mockReset();
  fixture.home = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-operation-'));
  store = new DaemonStateStore(logger, path.join(fixture.home, 'state.sqlite'));
  executor = new ExecutionService(logger); mode = 'complete'; submitted = [];
  vi.spyOn(executor, 'inspectDockerTarget').mockImplementation(async name => ({ id: containers[name as keyof typeof containers], image }));
  vi.spyOn(executor, 'execute').mockImplementation(async command => {
    const intent: ExecutionResource = { type: 'docker-container', operationId: command.operationId!, daemonId: 'fixture-daemon' };
    const resource: ExecutionResource = { ...intent, id: createHash('sha256').update(intent.operationId).digest('hex') };
    await command.onResource!(intent, command.signal!);
    await command.onResource!(resource, command.signal!);
    submitted.push(resource);
    if (mode === 'unknown') throw new ExecutionOutcomeUnknownError({ adapter: 'docker', resource });
    // Real process/streams plus real SQLite receipts, with only the daemon
    // ownership protocol faked. No real Docker service or database is used.
    return testExecution.execute({ ...command, adapter: 'local', adapterOptions: { type: 'local' },
      command: process.execPath, args: ['-e', mode === 'wait'
        ? 'process.stdout.write("partial");setInterval(()=>{},1000)'
        : 'process.stdout.end("SELECT 1;\\n")'] });
  });
  backups = new BackupService({ logger } as never, store, executor, projects as never);
});
afterEach(async () => {
  await Promise.all(backups.listOperations().filter(operation => operation.state !== 'unknown')
    .map(operation => backups.cancelOperation(operation.id, operation.revision)));
  for (const operation of backups.listOperations()) recoveryState.release(`execution.operation.${operation.id}`);
  backups.dispose(); await executor.dispose(); await store.dispose(); vi.restoreAllMocks();
  fs.rmSync(fixture.home, { recursive: true, force: true });
});

async function runtimeReceipt(phase: RuntimeUpdatePhase, artifact = 'b'.repeat(64)) {
  const original = 'a'.repeat(64);
  const plan: RuntimeUpdatePlan = { protocol: 1, instance: fixture.home, backupOperations: [],
    target: { artifact, commit: 'b'.repeat(40) }, before: { backend: original, owner: original, guardian: original,
      backendCommit: 'a'.repeat(40), ownerCommit: 'a'.repeat(40), scope: 'user', ownerId: 'original', ownerPid: 123,
      ownerLifetime: '01234567-0000-0000-0000-000000000001:1234', guardianPid: 124, backendPid: 125, revision: 1,
      retiredPids: [], console: null, consoleCommit: null }, stacks: [], excluded: [], watches: [],
    infrastructure: { schemaScope: 'all', digest: 'c'.repeat(64), database: null, containers: [] } };
  const receipt = { protocol: 1 as const, plan, digest: runtimeUpdate.runtimeUpdatePlanDigest(plan), phase, updatedAt: new Date().toISOString() };
  await writePrivateRecord(path.join(fixture.home, 'runtime/local-updates/current.json'), receipt);
  return receipt;
}

async function maintenanceTarget() {
  const stage = path.join(fixture.home, 'unbound-runtime'), releases = path.join(fixture.home, 'runtime/releases');
  fs.mkdirSync(path.join(stage, 'packages/0/dist/cli'), { recursive: true });
  fs.mkdirSync(path.join(stage, 'packages/0/webapp/dist'), { recursive: true });
  for (const output of ['dist', 'webapp/dist'])
    fs.writeFileSync(path.join(stage, 'packages/0', output, 'BUILD.json'), JSON.stringify({ commit: 'a'.repeat(40), dirty: false, builtAt: new Date().toISOString() }));
  fs.writeFileSync(path.join(stage, 'node'), 'fixture', { mode: 0o700 });
  fs.writeFileSync(path.join(stage, 'packages/0/dist/cli/omnitron.js'), '// sealed fixture');
  const target = await runtimeArtifactDigest(stage);
  fs.writeFileSync(path.join(stage, 'RUNTIME.json'), JSON.stringify({ protocol: 1, sha256: target, platform: process.platform, arch: process.arch, nodeVersion: process.version, packages: 1 }));
  fs.mkdirSync(releases, { recursive: true }); fs.renameSync(stage, path.join(releases, target));
  return { id: randomUUID(), review: 'e'.repeat(64), target, project: 'one', stack: 'dev', callerPid: process.ppid, minutes: 1 };
}

function candidatePreview(target: string, action = 'retain', coverage = 'reviewed-declarations', current = target) {
  const infrastructure = { coverage, intentDigest: 'd'.repeat(64), containers: [{ name: 'sample-dev-gateway', action, id: 'c'.repeat(64) }] };
  return JSON.stringify({ ok: true, data: { checked: true, candidate: target, current, schemaScope: 'all', infrastructure } });
}

function localStopStatus() {
  return { applicationStopBackupWindowProtocol: 1, instanceHome: fixture.home, daemonSocket: path.join(fixture.home, 'daemon.sock') };
}

describe('foreground backup window before a reviewed application stop', () => {
  it('releases a pending acquisition during artifact verification without pausing schedules later', async () => {
    const request = await maintenanceTarget(), window = new RuntimeBackupWindow(fixture.home, backups);
    const checking = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
    const verify = runtimeHost.verifyRuntimeUpdateTarget;
    vi.spyOn(runtimeHost, 'verifyRuntimeUpdateTarget').mockImplementationOnce(async (...args) => {
      checking.resolve(); await resume.promise; return verify(...args);
    });
    const drain = vi.spyOn(backups, 'prepareHandoff');
    const acquire = expect(window.acquire(request)).rejects.toThrow('live local caller');
    await checking.promise; await window.release(request.id); resume.resolve(); await acquire;
    expect(drain).not.toHaveBeenCalled();
    expect(window.active).toBe(false);
  });

  it('preserves the application on an older local controller that cannot hold backups', async () => {
    const stop = vi.fn(), release = vi.fn(), acquire = vi.fn();
    const previous = process.exitCode;
    vi.spyOn(daemonClient, 'createDaemonClient').mockReturnValue({ service: async (name: string) =>
      name === 'OmnitronBackend' ? { controlAddress: async () => ({ socket: 'local-fixture' }) } : {
        reviewStackStop: async () => ({ digest: 'a'.repeat(64), keepInfrastructure: true }), stopStack: stop, stopStackForRuntime: stop,
      }, disconnect: vi.fn() } as never);
    vi.spyOn(privateControl, 'privateControlClient').mockResolvedValue({
      service: { status: async () => ({}), backupWindowAcquire: acquire, backupWindowRelease: release }, close: vi.fn(),
    } as never);
    try {
      await stackStopCommand('one', 'dev', { keepInfrastructure: true, review: 'a'.repeat(64), forRuntime: 'b'.repeat(64) });
      expect(process.exitCode).toBe(1);
      expect(stop).not.toHaveBeenCalled(); expect(acquire).not.toHaveBeenCalled(); expect(release).not.toHaveBeenCalled();
    } finally { process.exitCode = previous; }
  });

  it('checks the staged candidate in dry-run and refuses a later gateway replacement before backup or stop admission', async () => {
    const { target, project, stack, review } = await maintenanceTarget();
    const window = { status: localStopStatus, backupWindowAcquire: vi.fn(), backupWindowRelease: vi.fn() };
    const stop = vi.fn(), ordinaryStop = vi.fn(), close = vi.fn(), disconnect = vi.fn();
    vi.spyOn(daemonClient, 'createDaemonClient').mockReturnValue({ service: async (name: string) =>
      name === 'OmnitronBackend' ? { controlAddress: async () => ({ socket: 'fixture-private-control' }) } : {
        reviewStackStop: async () => ({ digest: review, keepInfrastructure: true, targets: [] }), stopStack: ordinaryStop, stopStackForRuntime: stop,
      }, disconnect } as never);
    vi.spyOn(privateControl, 'privateControlClient').mockResolvedValue({ service: window, close } as never);
    const rollback = 'a'.repeat(64);
    const candidate = fixture.runCandidate.mockResolvedValueOnce(candidatePreview(target))
      .mockResolvedValueOnce(candidatePreview(target, 'replace')).mockResolvedValueOnce(candidatePreview(target, 'replace'))
      .mockResolvedValueOnce(candidatePreview(target, 'retain', 'historical-declarations'))
      .mockResolvedValueOnce(candidatePreview(target, 'retain', 'reviewed-declarations', rollback)).mockResolvedValueOnce(candidatePreview(rollback, 'start'));
    const result = vi.spyOn(output, 'emitJson').mockReturnValue(true);
    const error = vi.spyOn(output, 'emitError').mockReturnValue(true);
    const options = { keepInfrastructure: true, forRuntime: target };
    const previous = process.exitCode;
    try {
      await stackStopCommand(project, stack, { ...options, dryRun: true });
      expect(result).toHaveBeenCalledWith(expect.objectContaining({ digest: review, backupWindow: expect.objectContaining({ target,
        infrastructure: expect.objectContaining({ containers: [{ name: 'sample-dev-gateway', id: 'c'.repeat(64) }] }) }) }));
      expect(error).not.toHaveBeenCalled();
      for (const mode of [{ review }, { dryRun: true }]) {
        await stackStopCommand(project, stack, { ...options, ...mode });
        expect(error).toHaveBeenLastCalledWith(expect.stringContaining('sample-dev-gateway: replace'), expect.anything());
        expect(process.exitCode).toBe(1);
      }
      await stackStopCommand(project, stack, { ...options, review });
      expect(error).toHaveBeenLastCalledWith(expect.stringContaining('historical-declarations'), expect.anything());
      await stackStopCommand(project, stack, { ...options, review });
      expect(error).toHaveBeenLastCalledWith(expect.stringContaining(`sample-dev-gateway: start. Inspect omnitron backend select ${rollback} --check`), expect.anything());
      const directory = path.join(fixture.home, 'runtime/releases', target);
      expect(candidate.mock.calls.map(([, , args]) => args[4])).toEqual([target, target, target, target, target, rollback]);
      for (const [cwd, node, args] of candidate.mock.calls) {
        expect(cwd).toBe(fixture.home);
        expect(node).toBe(path.join(directory, 'node'));
        expect(args).toEqual([path.join(directory, 'packages/0/dist/cli/omnitron.js'), '--json', 'backend', 'select', expect.any(String), '--check']);
      }
      expect(window.backupWindowAcquire).not.toHaveBeenCalled(); expect(window.backupWindowRelease).not.toHaveBeenCalled();
      expect(stop).not.toHaveBeenCalled(); expect(ordinaryStop).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledTimes(5); expect(disconnect).toHaveBeenCalledTimes(5);
    } finally { process.exitCode = previous; }
  });

  it('moves the same admission from the CLI stop into the durable native update while a scheduled tick is due', async () => {
    const request = await maintenanceTarget();
    fixture.runCandidate.mockResolvedValue(candidatePreview(request.target));
    const window = new RuntimeBackupWindow(fixture.home, backups);
    if (process.platform !== 'darwin') vi.spyOn(runtimeHost, 'assertLocalUpdatePlatform').mockImplementation(() => {});
    vi.spyOn(managedRuntime, 'readManagedRuntime').mockResolvedValue({ scope: 'user', owner: { label: OWNER_LAUNCHD_LABEL }, backend: { label: LAUNCHD_LABEL } } as never);
    const native = Object.assign(Object.create(OmnitronDaemon.prototype), {
      backupWindow: window, backupService: backups, watchConfig: { apps: [] },
      execution: { state: () => ({ phase: 'active' }), controlledOwnerSnapshot: async () => ({
        status: { owner: { id: 'fixture-owner' }, controller: { epoch: 1 } }, inventoryDigest: 'e'.repeat(64) }) },
      app: { container: { resolveAsync: async () => ({ recoveryRegistryDigest: () => 'd'.repeat(64), captureRuntimeRestart: async () => ({ projects: [], stacks: [] }) }) } },
      recoveryMonitor: { status: () => ({ status: 'ready' }), certify: vi.fn() },
    }) as OmnitronDaemon;
    const stopAdmitted = Promise.withResolvers<string>();
    const project = {
      reviewStackStop: vi.fn(async () => ({ digest: request.review, keepInfrastructure: true, targets: [{ node: 'local' }] })),
      stopStack: vi.fn(),
      stopStackForRuntime: vi.fn(async (data: { project: string; stack: string; review: string; backupWindowId: string }) => {
        const claim = window.admitStop(data.backupWindowId, data.project, data.stack, data.review);
        stopAdmitted.resolve(data.backupWindowId);
        return { status: 'stopped', stopOperation: { phase: 'stopped', keepInfrastructure: true, backupWindow: claim, nodes: [] } };
      }),
    };
    const control = {
      service: {
        status: localStopStatus,
        // CLI and daemon share this test worker; use the actual separate vitest parent lifetime.
        backupWindowAcquire: (input: BackupWindowRequest) => native.acquireBackupWindow({ ...input, callerPid: process.ppid }),
        backupWindowWait: ({ id }: { id: string }) => window.wait(id),
        backupWindowRelease: ({ id }: { id: string }) => window.release(id),
      }, close: vi.fn(),
    };
    vi.spyOn(privateControl, 'privateControlClient').mockResolvedValue(control as never);
    vi.spyOn(daemonClient, 'createDaemonClient').mockReturnValue({
      service: async (name: string) => name === 'OmnitronBackend' ? { controlAddress: async () => ({ socket: 'fixture-private-control' }) } : project,
      disconnect: vi.fn(),
    } as never);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    store.kvSetSync('backup:schedules', { 'one/dev/ledger': 'hourly' });
    await backups.restoreSchedules();
    expect((await backups.getStatus()).schedules[0]!.armed).toBe(true);
    const command = stackStopCommand(request.project, request.stack, { keepInfrastructure: true, review: request.review, forRuntime: request.target, backupWindowMinutes: '3' });
    const id = await stopAdmitted.promise;
    const cancel = vi.spyOn(backups, 'cancelOperation');
    try {
      expect((await backups.getStatus()).schedules[0]!.armed).toBe(false);
      await vi.advanceTimersByTimeAsync(60_001);
      vi.useRealTimers();
      await expect(backups.createBackup('one/dev/ledger')).rejects.toThrow('paused');
      expect(executor.execute).not.toHaveBeenCalled();
      expect(() => window.admitStop(id, request.project, request.stack, request.review)).toThrow('unavailable');
      const base = await runtimeReceipt('draining');
      const plan = { ...base.plan, target: { ...base.plan.target, artifact: request.target }, before: { ...base.plan.before, backendPid: process.pid },
        excluded: [{ project: request.project, stack: request.stack, reason: 'disabled' as const }] };
      const digest = runtimeUpdate.runtimeUpdatePlanDigest(plan);
      await expect(window.transfer(digest)).rejects.toThrow('does not match');
      await writePrivateRecord(path.join(fixture.home, 'runtime/local-updates/current.json'), { ...base, plan, digest });
      const review = await native.reviewRuntimeRestart([]);
      await native.prepareRuntimeRestart({ stacks: [], backups: [], planDigest: digest, configurationSha256: restartConfigurationDigest(review.configuration) });
      expect(await window.wait(id)).toEqual({ state: 'transferred', digest });
      expect(backups.ownsHandoff('runtime-update:' + digest)).toBe(true);
      await command;
      expect(project.stopStack).not.toHaveBeenCalled();
      expect(project.stopStackForRuntime).toHaveBeenCalledOnce();
      expect(cancel).not.toHaveBeenCalled();
      await writePrivateRecord(path.join(fixture.home, 'runtime/local-updates/current.json'), { ...base, plan, digest, phase: 'accepted' });
      await native.releaseRuntimeRestart(digest);
      expect(backups.ownsHandoff('runtime-update:' + digest)).toBe(false);
    } finally { vi.useRealTimers(); await window.release(id); await command; }
  });

  it('refuses a newly scheduled database backup before any stop and preserves its original receipt', async () => {
    const request = await maintenanceTarget(), window = new RuntimeBackupWindow(fixture.home, backups);
    fixture.runCandidate.mockResolvedValue(candidatePreview(request.target));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      store.kvSetSync('backup:schedules', { 'one/dev/ledger': 'hourly' });
      mode = 'wait';
      await backups.restoreSchedules();
      await vi.advanceTimersByTimeAsync(60_001);
    } finally { vi.useRealTimers(); }
    await vi.waitFor(() => expect(submitted).toHaveLength(1));
    const existing = backups.listOperations();
    expect(existing).toHaveLength(1);
    const cancel = vi.spyOn(backups, 'cancelOperation');
    await expect(window.acquire(request)).rejects.toThrow('changed after review');
    const stop = vi.fn(), ordinary = vi.fn(), previousExit = process.exitCode;
    vi.spyOn(daemonClient, 'createDaemonClient').mockReturnValue({ service: async (name: string) =>
      name === 'OmnitronBackend' ? { controlAddress: async () => ({ socket: 'local-fixture' }) } : {
        reviewStackStop: async () => ({ digest: request.review, keepInfrastructure: true }),
        stopStackForRuntime: stop, stopStack: ordinary,
      }, disconnect: vi.fn() } as never);
    vi.spyOn(privateControl, 'privateControlClient').mockResolvedValue({ service: {
      status: localStopStatus,
      backupWindowAcquire: (input: BackupWindowRequest) => window.acquire({ ...input, callerPid: process.ppid }),
      backupWindowRelease: ({ id }: { id: string }) => window.release(id),
    }, close: vi.fn() } as never);
    try {
      await stackStopCommand(request.project, request.stack, { keepInfrastructure: true, review: request.review, forRuntime: request.target });
      expect(process.exitCode).toBe(1);
      expect(stop).not.toHaveBeenCalled();
      expect(ordinary).not.toHaveBeenCalled();
    } finally { process.exitCode = previousExit; }
    expect(window.active).toBe(false);
    expect(backups.listOperations()).toEqual(existing);
    expect(cancel).not.toHaveBeenCalled();
    expect(() => window.admitStop(request.id, request.project, request.stack, request.review)).toThrow('unavailable');
  });

  it.each(['owner-exited', 'expired'] as const)('rearms the original schedules when the foreground holder is %s', async reason => {
    const request = await maintenanceTarget(), window = new RuntimeBackupWindow(fixture.home, backups);
    const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},30000)'], { stdio: 'ignore' });
    await once(child, 'spawn');
    store.kvSetSync('backup:schedules', { 'one/dev/ledger': 'hourly' });
    await backups.restoreSchedules();
    try {
      if (reason === 'expired') vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
      await window.acquire({ ...request, callerPid: child.pid! });
      expect((await backups.getStatus()).schedules[0]!.armed).toBe(false);
      expect(() => window.admitStop(request.id, 'other', request.stack, request.review)).toThrow();
      if (reason === 'expired') await vi.advanceTimersByTimeAsync(61_000);
      else { const exited = once(child, 'exit'); child.kill(); await exited; }
      expect(await window.wait(request.id)).toEqual({ state: reason });
      expect((await backups.getStatus()).schedules[0]!.armed).toBe(true);
      expect(await backups.listSchedules()).toEqual({ 'one/dev/ledger': 'hourly' });
    } finally {
      vi.useRealTimers(); await window.release(request.id);
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
  }, 7000);
});

describe('backup admission follows the native runtime receipt', () => {
  it.each(['draining', 'stopping', 'starting', 'verifying', 'failed', 'stopping-candidate', 'restoring', 'recovery-required'] as const)(
    'a replacement backend preserves schedules and denies new effects in %s', async phase => {
      store.kvSetSync('backup:schedules', { 'one/dev/ledger': 'hourly' });
      const receipt = await runtimeReceipt(phase);
      await backups.restoreSchedules();
      await expect(backups.createBackup('one/dev/ledger')).rejects.toThrow('paused for runtime update');
      expect(executor.execute).not.toHaveBeenCalled();
      expect(backups.listOperations()).toEqual([]);
      expect(await backups.getStatus()).toMatchObject({ admission: { status: 'paused', runtimeUpdate: { digest: receipt.digest, phase } },
        schedules: [{ armed: false, nextRunAt: null }] });
      expect(await backups.listSchedules()).toEqual({ 'one/dev/ledger': 'hourly' });
    });

  it.each(['accepted', 'rolled-back', 'aborted'] as const)('resumes from %s after a lost acknowledgement without another release command', async phase => {
    store.kvSetSync('backup:schedules', { 'one/dev/ledger': 'hourly' });
    await runtimeReceipt('starting');
    await Promise.all([backups.restoreSchedules(), backups.restoreSchedules()]);
    expect((await backups.getStatus()).schedules[0]!.armed).toBe(false);
    await runtimeReceipt(phase); // Simulate terminal fsync followed by loss of the CLI reply.
    await vi.waitFor(async () => expect((await backups.getStatus()).schedules[0]!.armed).toBe(true), { timeout: 4000 });
    const next = (await backups.getStatus()).schedules[0]!.nextRunAt;
    await Promise.all([backups.restoreSchedules(), backups.restoreSchedules()]);
    expect((await backups.getStatus()).schedules[0]!.nextRunAt).toBe(next);
    expect((await backups.getStatus()).admission).toBeUndefined();
    await expect(backups.createBackup('one/dev/ledger')).resolves.toBeTruthy();
    expect(executor.execute).toHaveBeenCalledOnce();
  });

  it('does not let a stale terminal receipt release a newer held digest', async () => {
    store.kvSetSync('backup:schedules', { all: 'hourly' });
    const held = await runtimeReceipt('verifying', 'c'.repeat(64));
    await backups.restoreSchedules();
    await runtimeReceipt('accepted');
    await expect(backups.restoreSchedules()).rejects.toThrow('held runtime update has no terminal receipt');
    expect((await backups.getStatus()).admission?.status).toBe('unconfirmed');
    await expect(backups.createBackup('one/dev/ledger')).rejects.toThrow('held runtime update');
    expect(executor.execute).not.toHaveBeenCalled();
    await writePrivateRecord(path.join(fixture.home, 'runtime/local-updates', held.digest + '.json'), { ...held, phase: 'accepted' });
    await backups.restoreSchedules();
    expect((await backups.getStatus()).schedules[0]!.armed).toBe(true);
  });

  it.each(['missing', 'corrupt', 'dangling'] as const)('keeps a %s held receipt visibly unconfirmed instead of silently resuming', async defect => {
    store.kvSetSync('backup:schedules', { all: 'hourly' });
    await runtimeReceipt('restoring');
    await backups.restoreSchedules();
    const file = path.join(fixture.home, 'runtime/local-updates/current.json');
    if (defect === 'corrupt') fs.writeFileSync(file, '{');
    else {
      fs.unlinkSync(file);
      if (defect === 'dangling') fs.symlinkSync(path.join(fixture.home, 'absent.json'), file);
    }
    await expect(backups.restoreSchedules()).rejects.toThrow();
    expect(await backups.getStatus()).toMatchObject({ admission: { status: 'unconfirmed' }, schedules: [{ armed: false }] });
    await expect(backups.createBackup('one/dev/ledger')).rejects.toThrow();
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('closes scheduling before an in-flight receipt read can arm timers after disposal', async () => {
    store.kvSetSync('backup:schedules', { all: 'hourly' });
    let complete!: (value: null) => void;
    vi.spyOn(runtimeUpdate, 'readRuntimeUpdateReceipt').mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const restoring = backups.restoreSchedules();
    backups.dispose();
    complete(null);
    await restoring;
    expect((await backups.getStatus()).schedules[0]!.armed).toBe(false);
    await expect(backups.createBackup('one/dev/ledger')).rejects.toThrow('paused');
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('rechecks admission after target discovery before persisting or dispatching a new database effect', async () => {
    vi.mocked(executor.inspectDockerTarget).mockImplementationOnce(async () => {
      await runtimeReceipt('draining');
      return { id: containers.one, image };
    });
    await expect(backups.createBackup('one/dev/ledger')).rejects.toThrow('paused for runtime update');
    expect(executor.execute).not.toHaveBeenCalled();
    expect(backups.listOperations()).toEqual([]);
  });

  it('a late terminal read may arm a timer but cannot admit work after a newer transition starts', async () => {
    store.kvSetSync('backup:schedules', { all: 'hourly' });
    await runtimeReceipt('accepted');
    const read = runtimeUpdate.readRuntimeUpdateReceipt;
    vi.spyOn(runtimeUpdate, 'readRuntimeUpdateReceipt').mockImplementationOnce(async (...args) => {
      const terminal = await read(...args);
      await runtimeReceipt('draining', 'c'.repeat(64));
      return terminal;
    });
    await backups.restoreSchedules();
    expect((await backups.getStatus()).schedules[0]!.armed).toBe(true);
    await expect(backups.createBackup('one/dev/ledger')).rejects.toThrow('paused for runtime update');
    expect(executor.execute).not.toHaveBeenCalled();
    expect(backups.listOperations()).toEqual([]);
    expect((await backups.getStatus()).schedules[0]!.armed).toBe(false);
    await runtimeReceipt('accepted', 'c'.repeat(64));
    await vi.waitFor(async () => expect((await backups.getStatus()).schedules[0]!.armed).toBe(true), { timeout: 4000 });
  });

  it('does not release unknown database claims when a runtime receipt becomes terminal', async () => {
    mode = 'unknown';
    await expect(backups.createBackup('one/dev/ledger')).rejects.toThrow();
    const unknown = backups.listOperations()[0]!;
    await runtimeReceipt('recovery-required');
    await backups.restoreSchedules();
    await runtimeReceipt('accepted');
    await backups.restoreSchedules();
    mode = 'complete';
    await expect(backups.createBackup('one/dev/ledger')).rejects.toThrow();
    expect(backups.getOperation(unknown.id)).toEqual(unknown);
    expect(executor.execute).toHaveBeenCalledOnce();
  });
});

describe('durable backup execution', () => {
  it('finishes a single CLI backup across a real Netron timeout using the archived operation', async () => {
    @Service({ name: 'OmnitronDaemon' })
    class Daemon {
      @Public() async ping(): Promise<boolean> { return true; }
    }
    const socket = path.join(os.tmpdir(), `backup-${randomUUID().slice(0, 8)}.sock`);
    const server = new Netron(logger, { id: 'backup-fixture' });
    server.registerTransport('unix', () => new UnixSocketTransport());
    server.registerTransportServer('unix', { name: 'unix', options: { path: socket, invocationWrapper: createAuthContextWrapper() } });
    server.setTransportAuthContext('unix', {
      userId: 'omnitron-local', roles: ['admin'], permissions: [], metadata: { source: 'local-unix-socket' },
    });
    vi.spyOn(daemonClient, 'createDaemonClient').mockImplementation(() => new daemonClient.DaemonClient(socket, 1_000));

    const gate = Promise.withResolvers<void>();
    const execute = vi.mocked(executor.execute).getMockImplementation()!;
    vi.mocked(executor.execute).mockImplementationOnce(async command => { await gate.promise; return execute(command); });
    const create = vi.spyOn(backups, 'createBackup');
    const read = backups.getOperation.bind(backups);
    const observed: Array<{ id: string; state?: string }> = [];
    vi.spyOn(backups, 'getOperation').mockImplementation(id => {
      const receipt = read(id);
      observed.push({ id, ...(receipt && { state: receipt.state }) });
      if (receipt?.state === 'running') gate.resolve();
      return receipt;
    });
    const exitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await server.start();
      await server.peer.exposeService(new Daemon());
      await server.peer.exposeService(new BackupRpcService(backups, null));
      await backupCreateCommand('one/dev/ledger');
      const id = create.mock.calls[0]?.[1]?.operationId;
      expect(id).toEqual(expect.any(String));
      expect(create).toHaveBeenCalledOnce();
      expect(submitted).toHaveLength(1);
      expect(observed[0]).toEqual({ id, state: 'running' });
      expect(observed.at(-1)).toEqual({ id, state: 'succeeded' });
      expect(store.selectBackupsSync().map(row => row.id)).toEqual([id]);
      expect(process.exitCode).toBeUndefined();
    } finally {
      gate.resolve();
      process.exitCode = exitCode;
      await server.stop();
    }
  });

  it('persists ownership before execution and success only after archive/index completion', async () => {
    const operationId = randomUUID();
    const record = await backups.createBackup('one/dev/ledger', { operationId });
    expect(backups.getOperation(operationId)).toMatchObject({ state: 'succeeded', execution: submitted[0],
      observation: { resource: submitted[0], state: 'absent' }, artifact: { id: record.id, sizeBytes: record.size } });
    expect(store.selectBackupsSync()).toHaveLength(1);
    expect(JSON.stringify(backups.getOperation(operationId))).not.toContain('never-journal-this');
    const command = vi.mocked(executor.execute).mock.calls[0]![0];
    expect(command.adapterOptions).toMatchObject({ type: 'docker', runMode: 'run', pull: 'never', image,
      network: `container:${containers.one}`, resources: { cpus: 1, pidsLimit: 64 } });
    await expect(backups.createBackup('one/dev/ledger', { operationId })).rejects.toThrow('already exists');
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });

  it('cancels a dump for handoff without waiting its 30 minute budget or losing history/schedules', async () => {
    const retained = await backups.createBackup('one/dev/ledger');
    await backups.setSchedule('all', 'hourly');
    mode = 'wait';
    const operationId = randomUUID();
    const run = backups.createBackup('one/dev/ledger', { operationId }).catch(error => error);
    await vi.waitFor(() => expect(backups.getOperation(operationId)?.execution?.id).toBeTruthy());
    const started = performance.now();
    await backups.prepareHandoff();
    expect(performance.now() - started).toBeLessThan(5000);
    expect(await run).toBeInstanceOf(Error);
    expect(backups.getOperation(operationId)?.state).toBe('cancelled');
    expect((await backups.listBackups()).map(row => row.id)).toEqual([retained.id]);
    expect(store.kvGetSync('backup:schedules')).toEqual({ all: 'hourly' });
    expect(backups.activeOperationCount()).toBe(0);
    expect(backups.listOperations()).toEqual([]);
  });

  it('records a recovered container identity after cancellation using the executor recovery signal', async () => {
    const operationId = randomUUID();
    const resource: ExecutionResource = { type: 'docker-container', operationId,
      daemonId: 'fixture-daemon', id: 'd'.repeat(64) };
    vi.mocked(executor.execute).mockImplementationOnce(async command => {
      const pending = { ...resource }; delete pending.id;
      await command.onResource!(pending, command.signal!);
      await new Promise<void>(resolve => command.signal!.addEventListener('abort', () => resolve(), { once: true }));
      expect(command.signal!.aborted).toBe(true);
      await command.onResource!(resource, AbortSignal.timeout(5000));
      // Xec has identified and removed the unstarted helper before reporting cancellation.
      throw new Error('Owned helper cleanup completed after cancellation');
    });
    const run = backups.createBackup('one/dev/ledger', { operationId }).catch(error => error);
    await vi.waitFor(() => expect(backups.getOperation(operationId)?.execution).toMatchObject({ operationId }));
    const receipt = backups.getOperation(operationId)!;
    await backups.cancelOperation(operationId, receipt.revision);
    expect(await run).toBeInstanceOf(Error);
    expect(backups.getOperation(operationId)).toMatchObject({ state: 'cancelled', execution: resource,
      observation: { resource, state: 'absent' } });
    expect(store.selectBackupsSync()).toEqual([]);
    expect(backups.listOperations()).toEqual([]);
  });

  it('serializes one database while independent project allocations can execute concurrently', async () => {
    mode = 'wait';
    const first = backups.createBackup('one/dev/ledger').catch(error => error);
    await vi.waitFor(() => expect(submitted).toHaveLength(1));
    await expect(backups.createBackup('one/dev/ledger')).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    const second = backups.createBackup('two/dev/ledger').catch(error => error);
    await vi.waitFor(() => expect(submitted).toHaveLength(2));
    await Promise.all(backups.listOperations().map(operation => backups.cancelOperation(operation.id, operation.revision)));
    await Promise.all([first, second]);
    expect(backups.listOperations()).toEqual([]);
  });

  it('keeps unknown resources and staging through restart, rejects stale reviews and uses executor observation', async () => {
    mode = 'unknown';
    const id = randomUUID();
    await expect(backups.createBackup('one/dev/ledger', { operationId: id })).rejects.toThrow();
    const receipt = backups.getOperation(id)!;
    expect(receipt.state).toBe('unknown');
    expect(() => backups.reviewHandoffOperations()).toThrow('unconfirmed');
    const directory = path.join(fixture.home, 'backups');
    const partial = fs.readdirSync(directory).filter(name => name.endsWith('.partial'));
    expect(partial).toHaveLength(1);
    const restarted = new BackupService({ logger } as never, store, executor, projects as never);
    expect(fs.readdirSync(directory).filter(name => name.endsWith('.partial'))).toEqual(partial);
    const inspect = vi.spyOn(executor, 'inspectExecution').mockResolvedValue({ resource: submitted[0]!, state: 'absent' });
    await expect(restarted.reconcileOperation(id, receipt.revision - 1)).rejects.toMatchObject({ code: 'OPERATION_REVISION_CONFLICT' });
    expect(inspect).not.toHaveBeenCalled();
    expect(await restarted.reconcileOperation(id, receipt.revision)).toMatchObject({ state: 'failed', code: 'BACKUP_INTERRUPTED' });
    expect(inspect).toHaveBeenCalledWith(submitted[0]);
    expect(restarted.listOperations()).toEqual([]);
    expect(store.selectBackupsSync()).toEqual([]);
    restarted.dispose();
  });

  it('requires exact reviewed operations and the same transition owner to resume schedules', async () => {
    mode = 'wait';
    const first = backups.createBackup('one/dev/ledger').catch(error => error);
    await vi.waitFor(() => expect(submitted).toHaveLength(1));
    const reviewed = backups.reviewHandoffOperations();
    const second = backups.createBackup('two/dev/ledger').catch(error => error);
    await vi.waitFor(() => expect(submitted).toHaveLength(2));
    await expect(backups.prepareHandoff(reviewed, 'plan-one')).rejects.toThrow('changed after review');
    expect(backups.listOperations()).toHaveLength(2);
    await backups.prepareHandoff(backups.reviewHandoffOperations(), 'plan-one');
    await Promise.all([first, second]);
    await expect(backups.resumeAfterHandoff('plan-two')).rejects.toThrow('owning transition');
    await expect(backups.createBackup('one/dev/ledger')).rejects.toThrow('paused');
    await backups.resumeAfterHandoff('plan-one');
    mode = 'complete';
    await expect(backups.createBackup('one/dev/ledger')).resolves.toBeTruthy();
  });

  it('retains uncertainty and staging after review while admitting a new dump and a controller handoff', async () => {
    mode = 'unknown';
    const id = randomUUID();
    await expect(backups.createBackup('one/dev/ledger', { operationId: id })).rejects.toThrow();
    const prior = backups.getOperation(id)!;
    const directory = path.join(fixture.home, 'backups');
    const partial = fs.readdirSync(directory).filter(name => name.endsWith('.partial'));
    const reviewed = backups.acknowledgeUnknownBackup(id, prior.revision, 'operator', 'Retain the lost acknowledgement');
    expect(reviewed.state).toBe('unknown'); expect(backups.listOperations()).toEqual([]);
    expect(backups.listOperations(true)).toEqual([reviewed]);
    expect(backups.reviewHandoffOperations()).toEqual([]);
    const reopened = new BackupService({ logger } as never, store, executor, projects as never);
    expect(fs.readdirSync(directory).filter(name => name.endsWith('.partial'))).toEqual(partial);
    mode = 'complete';
    const next = await reopened.createBackup('one/dev/ledger');
    expect(reopened.getOperation(id)).toEqual(reviewed);
    expect(store.selectBackupsSync().map(value => value.id)).toEqual([next.id]);
    const effects = vi.mocked(executor.execute).mock.calls.length;
    await expect(reopened.restoreBackup(next.id)).rejects.toThrow('still blocks non-backup effects');
    expect(executor.execute).toHaveBeenCalledTimes(effects);
    await reopened.prepareHandoff();
    await reopened.resumeAfterHandoff();
    reopened.dispose();
  });

  it('does not accept a review while this backend still owns the operation', async () => {
    mode = 'wait';
    const id = randomUUID();
    const running = backups.createBackup('one/dev/ledger', { operationId: id }).catch(error => error);
    await vi.waitFor(() => expect(backups.getOperation(id)?.execution?.id).toBeTruthy());
    expect(() => backups.acknowledgeUnknownBackup(id, backups.getOperation(id)!.revision, 'operator', 'Review'))
      .toThrow('still owns');
    await backups.cancelOperation(id, backups.getOperation(id)!.revision); await running;
  });

  it('accepts a reviewed attempt that completed naturally without executing or cancelling it again', async () => {
    mode = 'wait';
    const run = backups.createBackup('one/dev/ledger').catch(error => error);
    await vi.waitFor(() => expect(submitted).toHaveLength(1));
    const reviewed = backups.reviewHandoffOperations();
    await backups.cancelOperation(reviewed[0]!.id, reviewed[0]!.revision);
    await run;
    const cancel = vi.spyOn(backups, 'cancelOperation');
    await backups.prepareHandoff(reviewed, 'reviewed-plan');
    expect(cancel).not.toHaveBeenCalled();
    expect(executor.execute).toHaveBeenCalledTimes(1);
    await backups.resumeAfterHandoff('reviewed-plan');
  });

  it.each([false, true])('freezes the reviewed backend checkpoint through the real backup journal (completed before apply=%s)', async completed => {
    const controller = await liveControllerFixture();
    mode = 'wait';
    const run = backups.createBackup('one/dev/ledger').catch(error => error);
    try {
      await vi.waitFor(() => expect(submitted).toHaveLength(1));
      const review = await controller.control.handoffReview();
      expect(controller.journal.read()?.status).toBe('invalid');
      expect(review.admission.backups).toHaveLength(1);
      expect(controller.execution.prepare).not.toHaveBeenCalled(); expect(controller.gate.drain).not.toHaveBeenCalled();
      if (completed) {
        const receipt = review.admission.backups[0]!;
        await backups.cancelOperation(receipt.id, receipt.revision); await run;
      }
      const cancel = vi.spyOn(backups, 'cancelOperation');
      const prepared = await controller.control.prepare({ candidateId: randomUUID(), admission: review.admission });
      const record = await readBackendBootRecord(prepared.file);
      expect(record.configuration).toEqual(review.admission.configuration);
      expect(record.state.ticket.from).toEqual(review.admission.backend.controller);
      expect(record.state.projects).toEqual(review.record.state.projects);
      expect(record.state.infrastructure).toEqual(review.record.state.infrastructure);
      expect(backendConfigurationDigest(record, review.admission.configuration.registryDigest)).toBe(review.admission.configuration.sha256);
      expect(await run).toBeInstanceOf(Error);
      expect(cancel).toHaveBeenCalledTimes(completed ? 0 : 1);
      expect(executor.execute).toHaveBeenCalledTimes(1);
      await expect(backups.createBackup('two/dev/ledger')).rejects.toThrow('paused');
      await controller.control.abort({ ticketId: prepared.ticketId });
      mode = 'complete'; await expect(backups.createBackup('two/dev/ledger')).resolves.toBeTruthy();
    } finally { await controller.close(); }
  });

  it('refuses a new backup after review before cancelling any operation or draining ingress', async () => {
    const controller = await liveControllerFixture();
    mode = 'wait';
    const first = backups.createBackup('one/dev/ledger').catch(error => error);
    try {
      await vi.waitFor(() => expect(submitted).toHaveLength(1));
      const review = await controller.control.handoffReview();
      const second = backups.createBackup('two/dev/ledger').catch(error => error);
      await vi.waitFor(() => expect(submitted).toHaveLength(2));
      const cancel = vi.spyOn(backups, 'cancelOperation');
      await expect(controller.control.prepare({ candidateId: randomUUID(), admission: review.admission })).rejects.toThrow(/review|changed/i);
      expect(cancel).not.toHaveBeenCalled(); expect(controller.execution.prepare).not.toHaveBeenCalled();
      expect(controller.gate.drain).not.toHaveBeenCalled();
      for (const receipt of backups.listOperations()) await backups.cancelOperation(receipt.id, receipt.revision);
      await Promise.all([first, second]);
    } finally { await controller.close(); }
  });

  it('reviews a busy backup without a certificate, then admits only after cancellation and strict capture', async () => {
    mode = 'wait';
    const run = backups.createBackup('one/dev/ledger').catch(error => error);
    await vi.waitFor(() => expect(submitted).toHaveLength(1));
    let ready = false;
    const certificate = vi.fn(async () => { ready = recoveryState.token() !== null; });
    const daemon = Object.create(OmnitronDaemon.prototype) as OmnitronDaemon;
    const project = { recoveryRegistryDigest: () => 'd'.repeat(64), captureRuntimeRestart: async () => ({ projects: [], stacks: [] }) };
    Object.assign(daemon, { backupService: backups, watchConfig: { apps: [] }, runtimeRestartAdmission: null,
      execution: { state: () => ({ phase: 'active' }), controlledOwnerSnapshot: async () => ({
        status: { owner: { id: 'fixture-owner' }, controller: { epoch: 1 } }, inventoryDigest: 'e'.repeat(64),
      }) }, app: { container: { resolveAsync: async () => project } },
      recoveryMonitor: { status: () => ({ status: ready ? 'ready' : 'pending' }), certify: certificate },
    });
    const review = await daemon.reviewRuntimeRestart([]);
    expect(review.backups).toHaveLength(1);
    expect(certificate).not.toHaveBeenCalled();
    await expect(daemon.captureRuntimeRestart([])).rejects.toMatchObject({ code: 'RUNTIME_OBSERVATION_PENDING',
      details: { stage: 'controller', pid: process.pid } });
    const request = { planDigest: 'f'.repeat(64), configurationSha256: restartConfigurationDigest(review.configuration),
      stacks: [], backups: review.backups };
    expect(await daemon.prepareRuntimeRestart(request)).toEqual(review.configuration);
    expect(await run).toBeInstanceOf(Error);
    expect(certificate).toHaveBeenCalledOnce();
    await expect(daemon.prepareRuntimeRestart(request)).resolves.toEqual(review.configuration);
    expect(executor.execute).toHaveBeenCalledTimes(1);
    await expect(daemon.releaseRuntimeRestart('a'.repeat(64))).rejects.toThrow('another plan');
    await expect(backups.createBackup('one/dev/ledger')).rejects.toThrow('paused');
    const read = store.kvGetSync.bind(store);
    vi.spyOn(store, 'kvGetSync').mockImplementation((key, options) => {
      if (key === 'backup:schedules') throw new Error('schedule state unreadable');
      return read(key, options);
    });
    await expect(daemon.releaseRuntimeRestart(request.planDigest)).rejects.toThrow('schedule state unreadable');
    await expect(backups.createBackup('one/dev/ledger')).rejects.toThrow('paused');
    vi.mocked(store.kvGetSync).mockRestore();
    await daemon.releaseRuntimeRestart(request.planDigest);
    mode = 'complete';
    await expect(backups.createBackup('one/dev/ledger')).resolves.toBeTruthy();
  });
});
