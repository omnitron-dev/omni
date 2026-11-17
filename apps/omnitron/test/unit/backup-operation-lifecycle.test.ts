import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecutionOutcomeUnknownError, type ExecutionResource } from '@xec-sh/core';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
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

const fixture = vi.hoisted(() => ({ home: '' }));
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

describe('durable backup execution', () => {
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
    await expect(daemon.captureRuntimeRestart([])).rejects.toThrow('idle recovery certificate');
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
