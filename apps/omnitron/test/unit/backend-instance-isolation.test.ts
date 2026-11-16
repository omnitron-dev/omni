import { DEFAULT_DAEMON_CONFIG, DEFAULT_ECOSYSTEM } from '../../src/config/defaults.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ambientHome: '/ambient-instance-must-not-be-used', daemon: vi.fn(), control: vi.fn(), candidate: vi.fn(), migrations: vi.fn(), installation: vi.fn(), inspection: vi.fn(), supervised: vi.fn(), adoption: vi.fn(), coldPreview: vi.fn(),
}));
vi.mock('../../src/daemon/daemon-client.js', () => ({ createDaemonClient: mocks.daemon }));
vi.mock('../../src/daemon/private-control-client.js', () => ({ privateControlClient: mocks.control }));
vi.mock('../../src/daemon/backend-candidate.js', () => ({ checkBackendCandidate: mocks.candidate, assertBackendMigrationsCompatible: mocks.migrations, checkBackendAdoption: mocks.adoption, previewBackendColdStart: mocks.coldPreview }));
vi.mock('../../src/daemon/runtime-installation.js', () => ({ RuntimeInstallation: { open: mocks.installation, openReadOnly: mocks.inspection } }));
vi.mock('../../src/daemon/backend-child.js', () => ({ supervisesBackendChildren: mocks.supervised }));
vi.mock('../../src/config/defaults.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/config/defaults.js')>(), get OMNITRON_HOME() { return mocks.ambientHome; },
}));

import { replaceBackend, recoverBackend } from '../../src/daemon/backend-upgrade.js';
import { recoverBackendAfterCrash } from '../../src/daemon/backend-crash-recovery.js';
import { readManagedRuntime, managedRuntimeFile } from '../../src/daemon/managed-runtime.js';
import { BackendRecoveryJournal, type BackendRecoveryRecord } from '../../src/daemon/backend-recovery-journal.js';
import { writePrivateRecord } from '../../src/daemon/execution-journal.js';
import type { OperationReceipt } from '../../src/shared/dto/execution-operations.js';
import { backendConfigurationDigest, type BackendBootRecord } from '../../src/daemon/backend-handoff-types.js';
import { PidManager } from '../../src/daemon/pid-manager.js';
import { coldStartPreview } from '../../src/commands/backend.js';
import type { BackendArtifact } from '../../src/daemon/backend-candidate.js';

const roots: string[] = [];
beforeEach(() => { vi.resetAllMocks(); mocks.ambientHome = '/ambient-instance-must-not-be-used'; mocks.supervised.mockReturnValue(false);
  mocks.migrations.mockResolvedValue({ kind: 'identical' }); });
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture(managed = false, certified = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-instance-')); roots.push(root);
  const home = path.join(root, 'home'), execution = path.join(root, 'e');
  await fs.mkdir(home, { mode: 0o700 }); await fs.mkdir(execution, { mode: 0o700 });
  const config = { protocol: 1, instanceHome: home, directory: execution, scope: 'user', cwd: home,
    environment: { OMNITRON_HOME: home },
    owner: { label: 'dev.omnitron.test.owner', unit: 'omnitron-test-owner.service', artifact: 'a'.repeat(64) },
    backend: { label: 'dev.omnitron.test.backend', unit: 'omnitron-test-backend.service', artifact: 'b'.repeat(64) },
  };
  if (managed) await writePrivateRecord(managedRuntimeFile(home), config);
  const socket = path.join(root, 'custom-public.sock'), control = path.join(execution, 'c-test.sock');
  const status = { backendHandoffReviewProtocol: 1, pid: 741, instanceHome: home, entry: '/prior/packages/0/dist/daemon/daemon-entry.js', runtime: { owner: { id: 'fixture-owner', pid: 123 }, epoch: 1 } };
  const snapshot = { inventoryDigest: 'd'.repeat(64), protocol: 1, status: { owner: status.runtime.owner }, capabilities: {} as Record<string, number> };
  const observe = vi.fn().mockImplementation(async () => snapshot);
  const prepare = vi.fn(), getOperation = vi.fn();
  const upgrade = vi.fn().mockResolvedValue({ checked: true, build: { commit: 'target' } });
  const recover = vi.fn().mockResolvedValue({ pid: 456 });
  const supervisorStatus = vi.fn().mockResolvedValue({ migrationChecksumMetadata: 1, infrastructureAdoptionPreflight: 1, backendHandoffReviewProtocol: 1 });
  mocks.daemon.mockReturnValue({ service: async (name: string) => name === 'OmnitronBackups' ? { getOperation } :
    { status: async () => ({ handoffSupported: true }), controlAddress: async () => ({ socket: control }) }, disconnect: vi.fn() });
  mocks.control.mockImplementation(async (target, service) => {
    if (target === control && service === 'OmnitronBackendControl') return { service: { status: async () => status, prepare, handoffReview }, close: vi.fn() };
    if (target === path.join(execution, 'owner.sock') && service === 'OmnitronExecution') return { service: { snapshot: observe }, close: vi.fn() };
    if (target === path.join(execution, 'supervisor.sock') && service === 'OmnitronSupervisor') return { service: { upgrade, recover, status: supervisorStatus }, close: vi.fn() };
    throw new Error(`Unexpected private control target: ${target}`);
  });
  mocks.candidate.mockResolvedValue({ runtimeHash: 'a'.repeat(64), build: { commit: 'fixture' } });
  mocks.installation.mockResolvedValue(null);
  const record: BackendBootRecord = { protocol: 1, state: { protocol: 1,
    ticket: { id: 'ticket', ownerId: 'fixture-owner',
      from: { ownerId: 'fixture-owner', controllerId: 'previous', epoch: 1 },
      to: { ownerId: 'fixture-owner', controllerId: 'next', epoch: 2 } },
    watchConfig: { ...DEFAULT_ECOSYSTEM, apps: [] },
    projects: { projects: [], stacks: [], infrastructure: [], resumeBackoff: [], reconciling: false },
    infrastructure: null, executionInventory: 'd'.repeat(64) },
    daemonConfig: { ...DEFAULT_DAEMON_CONFIG, pidFile: path.join(home, 'daemon.pid'), socketPath: socket, executionHost: { enabled: true, directory: execution } },
    previousEntry: status.entry, previousPid: status.pid, createdAt: new Date().toISOString(), cwd: home,
    environment: { OMNITRON_HOME: home },
  };
  const { ticket: _ticket, ...observedState } = record.state;
  const observedRecord = { ...record, state: observedState, controller: record.state.ticket.from, runtimeHash: 'a'.repeat(64), registryDigest: 'b'.repeat(64) };
  const admission = { backend: { pid: status.pid, controller: observedRecord.controller }, backups: [] as OperationReceipt[], configuration: {
    registryDigest: observedRecord.registryDigest, sha256: backendConfigurationDigest(observedRecord, observedRecord.registryDigest),
  } };
  const handoffReview = vi.fn(async () => ({ record: observedRecord, admission }));
  if (certified) {
    const journal = new BackendRecoveryJournal(execution);
    journal.publish({ ...record, controller: record.state.ticket.from, runtimeHash: 'a'.repeat(64), registryDigest: 'b'.repeat(64) });
    await journal.close();
  }
  return { root, home, execution, socket, control, config, record, upgrade, recover, status, snapshot, observe, prepare, supervisorStatus, admission, handoffReview, observedRecord, getOperation };
}

const coldArtifact = { coldInfrastructureProtocol: 1, runtimeHash: 'a'.repeat(64) } as BackendArtifact;

it('previews current infrastructure during backup without certifying recovery or cancelling work', async () => {
  const target = await fixture();
  vi.spyOn(PidManager.prototype, 'getPid').mockReturnValue(target.status.pid);
  const journal = new BackendRecoveryJournal(target.execution);
  journal.invalidate('Backup or restore in progress');
  const before = journal.read();
  mocks.coldPreview.mockResolvedValue({ digest: 'c'.repeat(64), containers: [] });
  try {
    await expect(coldStartPreview(coldArtifact, target.record.daemonConfig, target.home))
      .resolves.toMatchObject({ coverage: 'reviewed-declarations', digest: 'c'.repeat(64) });
    expect(mocks.daemon).toHaveBeenCalledWith(target.socket);
    expect(mocks.coldPreview).toHaveBeenCalledWith(coldArtifact, target.observedRecord);
    expect(journal.read()).toEqual(before);
    expect(target.prepare).not.toHaveBeenCalled();
    expect(target.upgrade).not.toHaveBeenCalled();
    expect(mocks.installation).not.toHaveBeenCalled();
  } finally { await journal.close(); }
});

it.each(['refused', 'pid', 'instance', 'owner', 'epoch', 'configuration'])('never falls back to historical infrastructure after a %s live review', async changed => {
  const target = await fixture();
  vi.spyOn(PidManager.prototype, 'getPid').mockReturnValue(target.status.pid);
  if (changed === 'refused') target.handoffReview.mockRejectedValue(Error('Unfinished ownership mutation'));
  if (changed === 'pid') target.status.pid++;
  if (changed === 'instance') target.status.instanceHome = '/another-instance';
  if (changed === 'owner') target.observedRecord.controller.ownerId = 'another-owner';
  if (changed === 'epoch') target.observedRecord.controller.epoch++;
  if (changed === 'configuration') target.admission.configuration.sha256 = '0'.repeat(64);
  await expect(coldStartPreview(coldArtifact, target.record.daemonConfig, target.home)).rejects.toThrow();
  expect(mocks.coldPreview).not.toHaveBeenCalled();
  expect(target.prepare).not.toHaveBeenCalled();
});

it('keeps offline historical evidence distinct from certified evidence', async () => {
  const target = await fixture();
  vi.spyOn(PidManager.prototype, 'getPid').mockReturnValue(null);
  mocks.coldPreview.mockResolvedValue({ digest: 'c'.repeat(64), containers: [] });
  await expect(coldStartPreview(coldArtifact, target.record.daemonConfig, target.home))
    .resolves.toMatchObject({ coverage: 'certified-declarations' });
  const journal = new BackendRecoveryJournal(target.execution);
  journal.invalidate('Backup or restore in progress');
  await journal.close();
  await expect(coldStartPreview(coldArtifact, target.record.daemonConfig, target.home))
    .resolves.toMatchObject({ coverage: 'historical-declarations' });
  expect(mocks.daemon).not.toHaveBeenCalled();
  expect(mocks.control).not.toHaveBeenCalled();
});

it('uses the selected socket identity even when its location differs from instance home', async () => {
  const target = await fixture();
  await expect(replaceBackend('/candidate', { socket: target.socket, checkOnly: true })).resolves.toMatchObject({ build: { commit: 'fixture' } });
  expect(mocks.daemon).toHaveBeenCalledWith(target.socket, 15000);
  expect(mocks.control.mock.calls.map(call => call[0])).toEqual([target.control]);
  expect(mocks.installation).not.toHaveBeenCalled();
  expect(mocks.migrations.mock.calls[0]?.[2]).toBe('all');
});

it.each(['unavailable', 'pid', 'owner', 'epoch'])('refuses a %s handoff review before candidate adoption or lifecycle changes', async changed => {
  const target = await fixture();
  if (changed === 'unavailable') target.handoffReview.mockRejectedValue(Error('Unfinished ownership mutation'));
  if (changed === 'pid') target.observedRecord.previousPid++;
  if (changed === 'owner') target.observedRecord.controller.ownerId = 'another-owner';
  if (changed === 'epoch') target.observedRecord.controller.epoch++;
  await expect(replaceBackend('/candidate', { socket: target.socket })).rejects.toThrow();
  expect(mocks.adoption).not.toHaveBeenCalled(); expect(target.prepare).not.toHaveBeenCalled();
  expect(target.upgrade).not.toHaveBeenCalled(); expect(mocks.installation).not.toHaveBeenCalled();
});

it('uses the fresh read-only review while the recovery certificate remains invalid', async () => {
  const target = await fixture();
  const journal = new BackendRecoveryJournal(target.execution);
  try {
    journal.invalidate('Backup or restore in progress');
    await expect(replaceBackend('/candidate', { socket: target.socket, checkOnly: true })).resolves.toMatchObject({ admission: target.admission });
    expect(journal.read()?.status).toBe('invalid');
    expect(target.prepare).not.toHaveBeenCalled();
    expect(mocks.adoption).toHaveBeenCalledExactlyOnceWith(expect.anything(), target.observedRecord);
  } finally { await journal.close(); }
});

it('refuses a backend without reviewed admission without cancelling work', async () => {
  const target = await fixture(); target.status.backendHandoffReviewProtocol = 0;
  await expect(replaceBackend('/candidate', { socket: target.socket })).rejects.toThrow('lacks reviewed handoff');
  expect(target.handoffReview).not.toHaveBeenCalled(); expect(target.prepare).not.toHaveBeenCalled();
});

it('uses only the migration scope attested by the selected private control peer', async () => {
  const target = await fixture();
  Object.assign(target.status, { schemaScope: 'node' });
  await replaceBackend('/candidate', { socket: target.socket, checkOnly: true });
  expect(mocks.migrations.mock.calls[0]?.[2]).toBe('node');
  Object.assign(target.status, { schemaScope: 'unknown' });
  await replaceBackend('/candidate', { socket: target.socket, checkOnly: true });
  expect(mocks.migrations.mock.calls[1]?.[2]).toBe('all');
});

it('delegates to the selected managed instance and never the ambient instance', async () => {
  const target = await fixture(true);
  await expect(readManagedRuntime(target.home)).resolves.toMatchObject({ instanceHome: target.home });
  await expect(replaceBackend('/candidate', { socket: target.socket, checkOnly: true })).resolves.toMatchObject({ build: { commit: 'target' } });
  expect(target.upgrade).toHaveBeenCalledWith({ directory: '/candidate', checkOnly: true, admission: target.admission });
  expect(mocks.control.mock.calls.map(call => call[0])).toEqual([target.control, path.join(target.execution, 'supervisor.sock')]);
  expect(mocks.candidate).toHaveBeenCalledWith('/candidate', undefined, undefined);
  expect(mocks.installation).not.toHaveBeenCalled();
});

it('refreshes only the confirmed managed instance launcher after an older guardian completes promotion', async () => {
  const target = await fixture(true);
  let confirmed = false;
  const candidate = 'c'.repeat(64);
  mocks.candidate.mockResolvedValue({ runtimeHash: candidate, build: { commit: 'target' } });
  const inspectionClose = vi.fn();
  mocks.inspection.mockResolvedValue({ selection: () => ({ revision: 7 }), close: inspectionClose });
  const result = { pid: 456, ownerPid: 123, ownerId: 'fixture-owner', epoch: 2, checkpoint: '/checkpoint', build: { commit: 'target' } };
  target.upgrade.mockImplementation(async () => { confirmed = true; return result; });
  const writeLauncher = vi.fn(async () => { expect(confirmed).toBe(true); return '/launcher'; });
  const close = vi.fn(), select = vi.fn();
  const exclusive = vi.fn(async (work: () => Promise<unknown>) => work());
  mocks.installation.mockResolvedValue({ exclusive, writeLauncher, close, select,
    selection: () => ({ current: candidate, revision: 8 }), activation: () => null });
  await expect(replaceBackend('/candidate', { socket: target.socket })).resolves.toEqual(result);
  expect(mocks.inspection).toHaveBeenCalledExactlyOnceWith(target.home);
  expect(inspectionClose).toHaveBeenCalledOnce();
  expect(mocks.installation).toHaveBeenCalledExactlyOnceWith(target.home);
  expect(exclusive).toHaveBeenCalledOnce();
  expect(writeLauncher).toHaveBeenCalledExactlyOnceWith();
  expect(select).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});

it.each(['candidate', 'revision', 'activation', 'result'] as const)('refuses managed launcher refresh when the confirmed %s no longer matches', async changed => {
  const target = await fixture(true), candidate = 'c'.repeat(64);
  mocks.candidate.mockResolvedValue({ runtimeHash: candidate, build: { commit: 'target' } });
  mocks.inspection.mockResolvedValue({ selection: () => ({ revision: 7 }), close: vi.fn() });
  target.upgrade.mockResolvedValue({ pid: 456, build: { commit: changed === 'result' ? 'unexpected' : 'target' } });
  const writeLauncher = vi.fn(), close = vi.fn();
  mocks.installation.mockResolvedValue({ exclusive: async (work: () => Promise<unknown>) => work(), writeLauncher, close,
    selection: () => ({ current: changed === 'candidate' ? 'd'.repeat(64) : candidate, revision: changed === 'revision' ? 9 : 8 }),
    activation: () => changed === 'activation' ? { candidate } : null });
  await expect(replaceBackend('/candidate', { socket: target.socket })).rejects.toThrow('launcher refresh is refused');
  expect(writeLauncher).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});

it('does not refresh or promote a launcher after the managed guardian refuses handoff', async () => {
  const target = await fixture(true);
  target.upgrade.mockRejectedValue(new Error('Candidate handoff failed'));
  await expect(replaceBackend('/candidate', { socket: target.socket })).rejects.toThrow('Candidate handoff failed');
  expect(mocks.installation).not.toHaveBeenCalled();
});

it.each([true, false])('explains an old guardian metadata refusal before any lifecycle change (check=%s)', async checkOnly => {
  const target = await fixture(true);
  mocks.migrations.mockResolvedValue({ kind: 'checksum-metadata', changes: [] });
  target.supervisorStatus.mockResolvedValue({ infrastructureAdoptionPreflight: 1, backendHandoffReviewProtocol: 1 });
  await expect(replaceBackend('/candidate', { socket: target.socket, checkOnly })).rejects.toThrow('backend guardian transition');
  expect(target.upgrade).not.toHaveBeenCalled(); expect(target.prepare).not.toHaveBeenCalled();
  expect(mocks.installation).not.toHaveBeenCalled();
});

it.each([true, false])('refuses a guardian without final infrastructure adoption preflight before delegating (check=%s)', async checkOnly => {
  const target = await fixture(true);
  target.supervisorStatus.mockResolvedValue({ migrationChecksumMetadata: 1 });
  await expect(replaceBackend('/candidate', { socket: target.socket, checkOnly })).rejects.toThrow('cannot verify candidate infrastructure adoption');
  expect(target.upgrade).not.toHaveBeenCalled(); expect(target.prepare).not.toHaveBeenCalled();
  expect(mocks.installation).not.toHaveBeenCalled();
});

it('delegates checked metadata transitions only to a capable guardian', async () => {
  const target = await fixture(true);
  mocks.migrations.mockResolvedValue({ kind: 'checksum-metadata', changes: [] });
  await expect(replaceBackend('/candidate', { socket: target.socket, checkOnly: true })).resolves.toMatchObject({ checked: true });
  expect(target.supervisorStatus).toHaveBeenCalledOnce();
  expect(target.upgrade).toHaveBeenCalledOnce();
});

it.each([false, true])('refuses an incompatible owner before draining or delegating (managed=%s)', async managed => {
  const target = await fixture(managed);
  mocks.candidate.mockResolvedValue({ build: { commit: 'fixture' }, executionRequirements: { stackControl: 1 } });
  for (const checkOnly of [true, false]) {
    await expect(replaceBackend('/candidate', { socket: target.socket, checkOnly })).rejects.toThrow('stackControl@1');
  }
  expect(target.upgrade).not.toHaveBeenCalled(); expect(target.prepare).not.toHaveBeenCalled();
  expect(mocks.installation).not.toHaveBeenCalled();
});

it('allows a compatible owner and refuses another owner at the advertised address', async () => {
  const target = await fixture(true);
  mocks.candidate.mockResolvedValue({ build: { commit: 'fixture' }, executionRequirements: { stackControl: 1 } });
  target.snapshot.capabilities = { stackControl: 1 };
  await expect(replaceBackend('/candidate', { socket: target.socket, checkOnly: true })).resolves.toMatchObject({ checked: true });
  target.snapshot.status.owner = { id: 'replacement-owner', pid: 456 };
  target.upgrade.mockClear();
  await expect(replaceBackend('/candidate', { socket: target.socket })).rejects.toThrow('owner identity changed');
  expect(target.upgrade).not.toHaveBeenCalled(); expect(target.prepare).not.toHaveBeenCalled();
});

it('refuses mismatched control directories and foreign targets inside a guardian', async () => {
  const target = await fixture(true);
  await writePrivateRecord(managedRuntimeFile(target.home), { ...target.config, directory: target.home });
  await expect(replaceBackend('/candidate', { socket: target.socket })).rejects.toThrow('different supervised instance');
  await writePrivateRecord(managedRuntimeFile(target.home), target.config);
  mocks.supervised.mockReturnValue(true);
  await expect(replaceBackend('/candidate', { socket: target.socket })).rejects.toThrow('guardian cannot replace another instance');
  expect(target.upgrade).not.toHaveBeenCalled(); expect(mocks.candidate).not.toHaveBeenCalled();
});

it('resolves recovery from the private checkpoint before selecting its guardian', async () => {
  const target = await fixture(true), file = path.join(target.execution, 'handoff.json');
  await writePrivateRecord(file, target.record);
  await expect(recoverBackend(file)).resolves.toMatchObject({ pid: 456 });
  expect(target.recover).toHaveBeenCalledWith({ checkpoint: file });
  expect(mocks.daemon).not.toHaveBeenCalled();
  mocks.supervised.mockReturnValue(true);
  await expect(recoverBackend(file)).rejects.toThrow('guardian cannot recover another instance');
});

it('never delegates missing, misplaced or mismatched checkpoints', async () => {
  const target = await fixture(true, false), file = path.join(target.root, 'misplaced.json');
  await expect(recoverBackend(path.join(target.execution, 'missing.json'))).rejects.toThrow('Invalid backend checkpoint');
  await writePrivateRecord(file, target.record);
  await expect(recoverBackend(file)).rejects.toThrow('outside its execution directory');
  await expect(recoverBackendAfterCrash(target.execution)).rejects.toThrow();
  expect(mocks.control).not.toHaveBeenCalled(); expect(mocks.installation).not.toHaveBeenCalled();
});

it('resolves certified crash recovery from the requested journal, including unmanaged instances', async () => {
  for (const managed of [true, false]) {
    const target = await fixture(managed);
    const journal = new BackendRecoveryJournal(target.execution);
    const record = { ...target.record, runtimeHash: 'a'.repeat(64), registryDigest: 'b'.repeat(64),
      controller: { ownerId: 'test-owner', controllerId: 'test-controller', epoch: 1 },
    } as BackendRecoveryRecord;
    journal.publish(record); await journal.close();
    if (managed) {
      await expect(recoverBackendAfterCrash(target.execution)).resolves.toMatchObject({ pid: 456 });
      expect(target.recover).toHaveBeenCalledWith({});
    } else {
      await expect(recoverBackendAfterCrash(target.execution)).rejects.toThrow('No permanent runtime');
      expect(mocks.installation).toHaveBeenCalledWith(target.home, { existing: true });
    }
    const changed = new BackendRecoveryJournal(target.execution);
    changed.publish({ ...record, daemonConfig: { ...record.daemonConfig, executionHost: { enabled: true, directory: target.home } } });
    await changed.close();
    await expect(recoverBackendAfterCrash(target.execution)).rejects.toThrow('different execution directory');
  }
});

it.each(['revision', 'inventory'])('refuses stale %s under the native selection lease before installation or retirement', async change => {
  const target = await fixture(true);
  const previous = 'a'.repeat(64), candidate = 'b'.repeat(64), inventory = 'd'.repeat(64);
  mocks.ambientHome = target.home; mocks.supervised.mockReturnValue(true);
  const install = vi.fn(), selection = { current: previous, revision: 4 };
  const fence = { current: previous, candidate, selectionRevision: 4, backendPid: 741, ownerId: 'fixture-owner', ownerPid: 123, appsDigest: inventory, admission: target.admission };
  mocks.candidate.mockImplementation(async directory => ({ directory, runtimeHash: directory === '/candidate' ? candidate : previous }));
  mocks.installation.mockResolvedValue({
    close: vi.fn(), activation: () => null, selection: () => selection, install,
    exclusive: async (work: () => Promise<void>) => {
      if (change === 'revision') selection.revision++;
      else target.snapshot.inventoryDigest = 'e'.repeat(64);
      return work();
    },
  });
  const managedEntry = vi.spyOn(fs, 'access').mockResolvedValue(undefined);
  try { await expect(replaceBackend('/candidate', { socket: target.socket, fence })).rejects.toThrow(
    change === 'revision' ? 'selection changed since rollout planning' : 'application inventory changed'); }
  finally { managedEntry.mockRestore(); }
  expect(install).not.toHaveBeenCalled(); expect(target.prepare).not.toHaveBeenCalled();
});


const pendingBackup = (): OperationReceipt => ({ protocol: 1, id: 'reviewed-backup', kind: 'backup', revision: 3, state: 'running',
  resources: [{ kind: 'database', project: 'one', stack: 'dev', name: 'ledger' }], inputDigest: 'f'.repeat(64),
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z' });

it('preserves reviewed authority when the same backup finishes before backend apply', async () => {
  const target = await fixture();
  const expected = { ...structuredClone(target.admission), backups: [pendingBackup(), { ...pendingBackup(), id: 'second-backup',
    resources: [{ kind: 'database', project: 'two', stack: 'dev', name: 'ledger' }] }] };
  target.getOperation.mockImplementation(async ({ id }: { id: string }) => ({ ...expected.backups.find(value => value.id === id), state: 'succeeded', revision: 4 }));
  const checked = await replaceBackend('/candidate', { socket: target.socket, checkOnly: true, admission: expected });
  expect(checked).toMatchObject({ checked: true, admission: expected });
  expect(target.getOperation.mock.calls).toEqual([[{ id: 'reviewed-backup' }], [{ id: 'second-backup' }]]);
  expect(mocks.daemon).toHaveBeenCalledTimes(2); // initial capability + one reused receipt reader
  expect(target.prepare).not.toHaveBeenCalled();
});

it('refuses a new or revised active backup after review without installing or preparing', async () => {
  const target = await fixture();
  const expected = { ...structuredClone(target.admission), backups: [pendingBackup()] };
  target.admission.backups = [{ ...pendingBackup(), revision: 4 }];
  await expect(replaceBackend('/candidate', { socket: target.socket, admission: expected })).rejects.toThrow('Backup operations changed');
  expect(target.getOperation).not.toHaveBeenCalled(); expect(target.prepare).not.toHaveBeenCalled();
  expect(mocks.installation).not.toHaveBeenCalled(); expect(mocks.adoption).not.toHaveBeenCalled();
});


it('binds infrastructure declarations and native identities while allowing new health observations', async () => {
  const target = await fixture();
  // A desired container and its last native observation are separate facts.
  // The candidate must inspect native resources again after the freeze.
  const desired = { name: 'database', image: 'postgres', ports: [], environment: {}, volumes: [],
    labels: { 'omnitron.project': 'one', 'omnitron.stack': 'dev' }, restart: 'unless-stopped' };
  const infrastructure = { config: {}, normalizedServices: {}, containers: [desired],
    state: { ready: true, services: { database: { name: 'database', image: 'postgres', status: 'running' as const,
      containerId: '1'.repeat(64), health: 'healthy' as const, healthCheck: { completedAt: '2026-01-01T00:00:00Z', exitCode: 0 } } } },
    usingGlobalOmnitronPg: false, needsControlPlaneDatabase: false, monitoring: true, janitorNetworks: [],
    controlPlaneContainer: { ...desired, name: 'omnitron-pg' },
    nativeState: { protocol: 1 as const }, unhealthyTicks: [], restartBackoff: [] };
  target.observedRecord.state.infrastructure = infrastructure;
  const original = backendConfigurationDigest(target.observedRecord, target.observedRecord.registryDigest);
  const frozen = structuredClone(target.observedRecord);
  frozen.state.infrastructure!.state.services['database']!.healthCheck!.completedAt = '2026-01-01T00:00:05Z';
  frozen.state.infrastructure!.nativeState = { protocol: 1, observations: [{ name: 'database', containerId: '1'.repeat(12) }] };
  expect(backendConfigurationDigest(frozen, frozen.registryDigest)).toBe(original);
  frozen.state.infrastructure!.state.services['database']!.containerId = '2'.repeat(64);
  expect(backendConfigurationDigest(frozen, frozen.registryDigest)).not.toBe(original);
  const changed = structuredClone(target.observedRecord);
  changed.state.infrastructure!.janitorNetworks.push('foreign-network');
  expect(backendConfigurationDigest(changed, changed.registryDigest)).not.toBe(original);
});
