import { DEFAULT_DAEMON_CONFIG, DEFAULT_ECOSYSTEM } from '../../src/config/defaults.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ambientHome: '/ambient-instance-must-not-be-used', daemon: vi.fn(), control: vi.fn(), candidate: vi.fn(), migrations: vi.fn(), installation: vi.fn(), supervised: vi.fn(), adoption: vi.fn(),
}));
vi.mock('../../src/daemon/daemon-client.js', () => ({ createDaemonClient: mocks.daemon }));
vi.mock('../../src/daemon/private-control-client.js', () => ({ privateControlClient: mocks.control }));
vi.mock('../../src/daemon/backend-candidate.js', () => ({ checkBackendCandidate: mocks.candidate, assertBackendMigrationsCompatible: mocks.migrations, checkBackendAdoption: mocks.adoption }));
vi.mock('../../src/daemon/runtime-installation.js', () => ({ RuntimeInstallation: { open: mocks.installation } }));
vi.mock('../../src/daemon/backend-child.js', () => ({ supervisesBackendChildren: mocks.supervised }));
vi.mock('../../src/config/defaults.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/config/defaults.js')>(), get OMNITRON_HOME() { return mocks.ambientHome; },
}));

import { replaceBackend, recoverBackend } from '../../src/daemon/backend-upgrade.js';
import { recoverBackendAfterCrash } from '../../src/daemon/backend-crash-recovery.js';
import { readManagedRuntime, managedRuntimeFile } from '../../src/daemon/managed-runtime.js';
import { BackendRecoveryJournal, type BackendRecoveryRecord } from '../../src/daemon/backend-recovery-journal.js';
import { writePrivateRecord } from '../../src/daemon/execution-journal.js';
import type { BackendBootRecord } from '../../src/daemon/backend-handoff-types.js';

const roots: string[] = [];
beforeEach(() => { vi.resetAllMocks(); mocks.ambientHome = '/ambient-instance-must-not-be-used'; mocks.supervised.mockReturnValue(false);
  mocks.migrations.mockResolvedValue({ kind: 'identical' }); });
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
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
  const status = { pid: 741, instanceHome: home, entry: '/prior/packages/0/dist/daemon/daemon-entry.js', runtime: { owner: { id: 'fixture-owner', pid: 123 }, epoch: 1 } };
  const snapshot = { inventoryDigest: 'd'.repeat(64), protocol: 1, status: { owner: status.runtime.owner }, capabilities: {} as Record<string, number> };
  const observe = vi.fn().mockImplementation(async () => snapshot);
  const prepare = vi.fn();
  const upgrade = vi.fn().mockResolvedValue({ checked: true, build: { commit: 'target' } });
  const recover = vi.fn().mockResolvedValue({ pid: 456 });
  const supervisorStatus = vi.fn().mockResolvedValue({ migrationChecksumMetadata: 1, infrastructureAdoptionPreflight: 1 });
  mocks.daemon.mockReturnValue({ service: async () => ({ status: async () => ({ handoffSupported: true }), controlAddress: async () => ({ socket: control }) }), disconnect: vi.fn() });
  mocks.control.mockImplementation(async (target, service) => {
    if (target === control && service === 'OmnitronBackendControl') return { service: { status: async () => status, prepare }, close: vi.fn() };
    if (target === path.join(execution, 'owner.sock') && service === 'OmnitronExecution') return { service: { snapshot: observe }, close: vi.fn() };
    if (target === path.join(execution, 'supervisor.sock') && service === 'OmnitronSupervisor') return { service: { upgrade, recover, status: supervisorStatus }, close: vi.fn() };
    throw new Error(`Unexpected private control target: ${target}`);
  });
  mocks.candidate.mockResolvedValue({ build: { commit: 'fixture' } });
  mocks.installation.mockResolvedValue(null);
  const record: BackendBootRecord = { protocol: 1, state: { protocol: 1,
    ticket: { id: 'ticket', ownerId: 'fixture-owner',
      from: { ownerId: 'fixture-owner', controllerId: 'previous', epoch: 1 },
      to: { ownerId: 'fixture-owner', controllerId: 'next', epoch: 2 } },
    watchConfig: { ...DEFAULT_ECOSYSTEM, apps: [] },
    projects: { projects: [], stacks: [], infrastructure: [], resumeBackoff: [], reconciling: false },
    infrastructure: null, executionInventory: 'c'.repeat(64) },
    daemonConfig: { ...DEFAULT_DAEMON_CONFIG, pidFile: path.join(home, 'daemon.pid'), socketPath: socket, executionHost: { enabled: true, directory: execution } },
    previousEntry: status.entry, previousPid: status.pid, createdAt: new Date().toISOString(), cwd: home,
    environment: { OMNITRON_HOME: home },
  };
  if (certified) {
    const journal = new BackendRecoveryJournal(execution);
    journal.publish({ ...record, controller: record.state.ticket.from, runtimeHash: 'a'.repeat(64), registryDigest: 'b'.repeat(64) });
    await journal.close();
  }
  return { root, home, execution, socket, control, config, record, upgrade, recover, status, snapshot, observe, prepare, supervisorStatus };
}

it('uses the selected socket identity even when its location differs from instance home', async () => {
  const target = await fixture();
  await expect(replaceBackend('/candidate', { socket: target.socket, checkOnly: true })).resolves.toMatchObject({ build: { commit: 'fixture' } });
  expect(mocks.daemon).toHaveBeenCalledWith(target.socket, 15000);
  expect(mocks.control.mock.calls.map(call => call[0])).toEqual([target.control]);
  expect(mocks.installation).not.toHaveBeenCalled();
  expect(mocks.migrations.mock.calls[0]?.[2]).toBe('all');
});

it.each(['invalid', 'pid', 'owner', 'epoch'])('refuses a %s recovery certificate before candidate adoption or lifecycle changes', async changed => {
  const target = await fixture();
  const journal = new BackendRecoveryJournal(target.execution);
  try {
    const saved = journal.read();
    if (saved?.status !== 'ready') throw new Error('Fixture certificate missing');
    if (changed === 'invalid') journal.invalidate('Unfinished ownership mutation');
    else {
      if (changed === 'pid') saved.record.previousPid++;
      if (changed === 'owner') saved.record.controller.ownerId = 'another-owner';
      if (changed === 'epoch') saved.record.controller.epoch++;
      journal.publish(saved.record);
    }
  } finally { await journal.close(); }
  await expect(replaceBackend('/candidate', { socket: target.socket })).rejects.toThrow('current recovery certificate');
  expect(mocks.adoption).not.toHaveBeenCalled(); expect(target.prepare).not.toHaveBeenCalled();
  expect(target.upgrade).not.toHaveBeenCalled(); expect(mocks.installation).not.toHaveBeenCalled();
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
  expect(target.upgrade).toHaveBeenCalledWith({ directory: '/candidate', checkOnly: true });
  expect(mocks.control.mock.calls.map(call => call[0])).toEqual([target.control, path.join(target.execution, 'supervisor.sock')]);
  expect(mocks.candidate).toHaveBeenCalledWith('/candidate', undefined, undefined);
});

it.each([true, false])('explains an old guardian metadata refusal before any lifecycle change (check=%s)', async checkOnly => {
  const target = await fixture(true);
  mocks.migrations.mockResolvedValue({ kind: 'checksum-metadata', changes: [] });
  target.supervisorStatus.mockResolvedValue({ infrastructureAdoptionPreflight: 1 });
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
  const fence = { current: previous, candidate, selectionRevision: 4, backendPid: 741, ownerId: 'fixture-owner', ownerPid: 123, appsDigest: inventory };
  mocks.candidate.mockImplementation(async directory => ({ directory, runtimeHash: directory === '/candidate' ? candidate : previous }));
  mocks.installation.mockResolvedValue({
    close: vi.fn(), activation: () => null, selection: () => selection, install,
    exclusive: async (work: () => Promise<void>) => {
      if (change === 'revision') selection.revision++;
      else target.snapshot.inventoryDigest = 'e'.repeat(64);
      return work();
    },
  });
  await expect(replaceBackend('/candidate', { socket: target.socket, fence })).rejects.toThrow(
    change === 'revision' ? 'selection changed since rollout planning' : 'application inventory changed');
  expect(install).not.toHaveBeenCalled(); expect(target.prepare).not.toHaveBeenCalled();
});
