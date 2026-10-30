import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  daemon: vi.fn(), control: vi.fn(), candidate: vi.fn(), installation: vi.fn(), supervised: vi.fn(),
}));
vi.mock('../../src/daemon/daemon-client.js', () => ({ createDaemonClient: mocks.daemon }));
vi.mock('../../src/daemon/private-control-client.js', () => ({ privateControlClient: mocks.control }));
vi.mock('../../src/daemon/backend-candidate.js', () => ({ checkBackendCandidate: mocks.candidate }));
vi.mock('../../src/daemon/runtime-installation.js', () => ({ RuntimeInstallation: { open: mocks.installation } }));
vi.mock('../../src/daemon/backend-child.js', () => ({ supervisesBackendChildren: mocks.supervised }));
vi.mock('../../src/config/defaults.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/config/defaults.js')>(), OMNITRON_HOME: '/ambient-instance-must-not-be-used',
}));

import { replaceBackend, recoverBackend } from '../../src/daemon/backend-upgrade.js';
import { recoverBackendAfterCrash } from '../../src/daemon/backend-crash-recovery.js';
import { readManagedRuntime, managedRuntimeFile } from '../../src/daemon/managed-runtime.js';
import { BackendRecoveryJournal, type BackendRecoveryRecord } from '../../src/daemon/backend-recovery-journal.js';
import { writePrivateRecord } from '../../src/daemon/execution-journal.js';
import type { BackendBootRecord } from '../../src/daemon/backend-handoff-types.js';

const roots: string[] = [];
beforeEach(() => { vi.resetAllMocks(); mocks.supervised.mockReturnValue(false); });
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture(managed = false) {
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
  const status = { instanceHome: home, entry: '/prior/packages/0/dist/daemon/daemon-entry.js' };
  const upgrade = vi.fn().mockResolvedValue({ checked: true, build: { commit: 'target' } });
  const recover = vi.fn().mockResolvedValue({ pid: 456 });
  mocks.daemon.mockReturnValue({ service: async () => ({ status: async () => ({ handoffSupported: true }), controlAddress: async () => ({ socket: control }) }), disconnect: vi.fn() });
  mocks.control.mockImplementation(async (target, service) => {
    if (target === control && service === 'OmnitronBackendControl') return { service: { status: async () => status }, close: vi.fn() };
    if (target === path.join(execution, 'supervisor.sock') && service === 'OmnitronSupervisor') return { service: { upgrade, recover }, close: vi.fn() };
    throw new Error(`Unexpected private control target: ${target}`);
  });
  mocks.candidate.mockResolvedValue({ build: { commit: 'fixture' } });
  mocks.installation.mockResolvedValue(null);
  const record = { protocol: 1, state: { protocol: 1, ticket: { id: 'ticket' }, executionInventory: 'c'.repeat(64) },
    daemonConfig: { pidFile: path.join(home, 'daemon.pid'), socketPath: socket, executionHost: { enabled: true, directory: execution } },
    previousEntry: status.entry, previousPid: 999999, createdAt: new Date().toISOString(), cwd: home,
    environment: { OMNITRON_HOME: home },
  } as BackendBootRecord;
  return { root, home, execution, socket, control, config, record, upgrade, recover, status };
}

it('uses the selected socket identity even when its location differs from instance home', async () => {
  const target = await fixture();
  await expect(replaceBackend('/candidate', { socket: target.socket, checkOnly: true })).resolves.toMatchObject({ build: { commit: 'fixture' } });
  expect(mocks.daemon).toHaveBeenCalledWith(target.socket, 15000);
  expect(mocks.control.mock.calls.map(call => call[0])).toEqual([target.control]);
  expect(mocks.installation).not.toHaveBeenCalled();
});

it('delegates to the selected managed instance and never the ambient instance', async () => {
  const target = await fixture(true);
  await expect(readManagedRuntime(target.home)).resolves.toMatchObject({ instanceHome: target.home });
  await expect(replaceBackend('/candidate', { socket: target.socket, checkOnly: true })).resolves.toMatchObject({ build: { commit: 'target' } });
  expect(target.upgrade).toHaveBeenCalledWith({ directory: '/candidate', checkOnly: true });
  expect(mocks.control.mock.calls.map(call => call[0])).toEqual([target.control, path.join(target.execution, 'supervisor.sock')]);
  expect(mocks.candidate).not.toHaveBeenCalled();
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
  const target = await fixture(true), file = path.join(target.root, 'misplaced.json');
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
