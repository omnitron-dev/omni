import 'reflect-metadata';
import fs from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ isolation: vi.fn(), replace: vi.fn(), candidate: vi.fn(), write: vi.fn() }));
vi.mock('../../src/daemon/managed-runtime.js', () => ({ verifyManagedIsolation: mocks.isolation, managedJobPid: vi.fn(), hostBootIdentity: vi.fn() }));
vi.mock('../../src/daemon/backend-upgrade.js', () => ({ replaceBackend: mocks.replace, assertKernelHandoffFence: vi.fn(), recoverBackend: vi.fn() }));
vi.mock('../../src/daemon/backend-candidate.js', () => ({ checkBackendCandidate: mocks.candidate, verifyBackendEntry: vi.fn() }));
vi.mock('../../src/daemon/execution-journal.js', () => ({ readPrivateRecord: vi.fn(), writePrivateRecord: mocks.write }));
vi.mock('../../src/config/saved.js', () => ({ readSavedDaemonConfig: () => ({}), savedDaemonOverrides: () => ({}) }));
import { BackendSupervisorService } from '../../src/daemon/backend-supervisor.js';
import { PidManager } from '../../src/daemon/pid-manager.js';
import type { ManagedRuntime } from '../../src/daemon/managed-runtime.js';
import { RuntimeInstallation } from '../../src/daemon/runtime-installation.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(PidManager.prototype, 'getPid').mockReturnValue(20);
  vi.spyOn(PidManager.prototype, 'isRunning').mockReturnValue(true);
  vi.spyOn(fs, 'access').mockResolvedValue(undefined);
  mocks.isolation.mockResolvedValue(undefined);
  mocks.candidate.mockResolvedValue({ directory: '/isolated-candidate' });
  mocks.replace.mockResolvedValue({ checked: true, build: { commit: 'a'.repeat(40) } });
  mocks.write.mockResolvedValue(undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function fixture() {
  const service = new BackendSupervisorService({ directory: '/isolated-owner', instanceHome: '/isolated-home' } as ManagedRuntime, vi.fn());
  Object.assign(service, { children: new Map([[20, {}]]), state: { pid: 30, backendPid: 20, ownerPid: 10, state: 'ready', reason: null, at: '' } });
  return service;
}
async function inspecting(service: BackendSupervisorService) {
  const observed = Promise.withResolvers<void>();
  mocks.isolation.mockImplementationOnce(() => observed.promise);
  const tick = (service as unknown as { tick(): Promise<void> }).tick();
  await vi.waitFor(() => expect(mocks.isolation).toHaveBeenCalledTimes(1));
  return { release: () => observed.resolve(), tick };
}

it('admits one operator request after an in-flight health inspection without racing it', async () => {
  const service = fixture(), observation = await inspecting(service);
  expect((await service.status()).operationPending).toBe(false);
  const operation = service.upgrade({ directory: '/candidate', checkOnly: true });
  // Observe early refusal as a value, so this regression cannot leak an unhandled rejection.
  const result = operation.catch(error => error);
  await Promise.resolve();
  expect((await service.status()).operationPending).toBe(true);
  expect(mocks.replace).not.toHaveBeenCalled();
  await expect(service.upgrade({ directory: '/candidate', checkOnly: true })).rejects.toThrow(/busy/);
  observation.release(); await observation.tick;
  expect(await result).toMatchObject({ checked: true });
  expect(mocks.replace).toHaveBeenCalledTimes(1);
  expect((await service.status()).operationPending).toBe(false);
});

it('bounds admission and never executes a timed-out request after the probe finishes', async () => {
  const service = fixture(), observation = await inspecting(service);
  vi.useFakeTimers();
  const result = service.upgrade({ directory: '/candidate', checkOnly: true }).catch(error => error);
  await vi.advanceTimersByTimeAsync(10_001);
  expect(await result).toBeInstanceOf(Error);
  observation.release(); await observation.tick;
  expect(mocks.replace).not.toHaveBeenCalled();
  expect((await service.status()).operationPending).toBe(false);
});

it('refuses a request waiting for observation if shutdown starts before admission', async () => {
  const service = fixture(), observation = await inspecting(service);
  const result = service.upgrade({ directory: '/candidate', checkOnly: true }).catch(error => error);
  // stop() owns the shutdown side effects; this test isolates its admission barrier.
  Object.assign(service, { stopping: true });
  observation.release(); await observation.tick;
  expect(await result).toBeInstanceOf(Error);
  expect(mocks.replace).not.toHaveBeenCalled();
});

it('does not queue behind a recovery operation or bypass failed isolation', async () => {
  const service = fixture();
  Object.assign(service, { busy: true });
  await expect(service.upgrade({ directory: '/candidate', checkOnly: true })).rejects.toThrow(/busy/);
  Object.assign(service, { busy: false });
  const observation = await inspecting(service);
  const result = service.upgrade({ directory: '/candidate', checkOnly: true }).catch(error => error);
  mocks.isolation.mockRejectedValueOnce(new Error('Owner isolation cannot be verified'));
  observation.release(); await observation.tick;
  expect(await result).toMatchObject({ message: 'Owner isolation cannot be verified' });
  expect(mocks.replace).not.toHaveBeenCalled();
});

it.each(['held', 'applying', 'unconfirmed'] as const)('retains durable %s recovery on restart instead of automatic adoption or a second operator path', async phase => {
  const service = fixture();
  const close = vi.fn();
  vi.spyOn(RuntimeInstallation, 'openReadOnly').mockResolvedValue({
    activation: () => ({ reviewedRecovery: { planId: 'reviewed-plan', phase } }), close,
  } as unknown as RuntimeInstallation);
  await (service as unknown as { tick(): Promise<void> }).tick();
  expect(await service.status()).toMatchObject({ state: 'blocked', reviewedRecovery: 1,
    reason: expect.stringContaining(`reviewed-plan (${phase})`) });
  expect(mocks.isolation).not.toHaveBeenCalled();
  await expect(service.recover({ checkpoint: '/ignored-original' })).rejects.toThrow('held for reviewed plan');
  await expect(service.upgrade({ directory: '/candidate' })).rejects.toThrow('held for reviewed plan');
  expect(mocks.replace).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(3);
});
