import 'reflect-metadata';
import fs from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ isolation: vi.fn(), replace: vi.fn(), recover: vi.fn(), reviewed: vi.fn(),
  candidate: vi.fn(), write: vi.fn(), ping: vi.fn() }));
vi.mock('../../src/daemon/managed-runtime.js', () => ({ verifyManagedIsolation: mocks.isolation, managedJobPid: vi.fn(), hostBootIdentity: vi.fn() }));
vi.mock('../../src/daemon/backend-upgrade.js', () => ({ replaceBackend: mocks.replace, assertKernelHandoffFence: vi.fn(), recoverBackend: mocks.recover }));
vi.mock('../../src/daemon/reviewed-backend-recovery.js', () => ({ recoverReviewedBackend: mocks.reviewed }));
vi.mock('../../src/daemon/daemon-client.js', () => ({ createDaemonClient: () => ({ ping: mocks.ping, disconnect: vi.fn() }) }));
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
  mocks.recover.mockResolvedValue({ pid: 20 });
  mocks.reviewed.mockResolvedValue({ pid: 20 });
  mocks.ping.mockResolvedValue({ pid: 20 });
  mocks.write.mockResolvedValue(undefined);
  vi.spyOn(RuntimeInstallation, 'openReadOnly').mockResolvedValue(null);
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

it('admits exactly one reviewed operation while the held guardian is still publishing blocked status', async () => {
  const service = fixture();
  vi.spyOn(RuntimeInstallation, 'openReadOnly').mockResolvedValue({
    activation: () => ({ reviewedRecovery: { planId: 'reviewed-plan', phase: 'held' } }), close: vi.fn(),
  } as unknown as RuntimeInstallation);
  const publishing = Promise.withResolvers<void>(), published = Promise.withResolvers<void>();
  mocks.write.mockImplementationOnce(() => { publishing.resolve(); return published.promise; });
  const tick = (service as unknown as { tick(): Promise<void> }).tick();
  await publishing.promise;
  expect(await service.status()).toMatchObject({ state: 'blocked', reason: expect.stringContaining('reviewed-plan (held)') });
  const result = service.recoverReviewed({ plan: '/reviewed-plan', sha256: 'a'.repeat(64) }).catch(error => error);
  try {
    expect((await service.status()).operationPending).toBe(true);
    expect(mocks.reviewed).not.toHaveBeenCalled();
    await expect(service.recoverReviewed({ plan: '/reviewed-plan', sha256: 'a'.repeat(64) })).rejects.toThrow(/busy/);
  } finally { published.resolve(); await tick; }
  expect(await result).toMatchObject({ pid: 20 });
  expect(mocks.reviewed).toHaveBeenCalledTimes(1);
  expect(mocks.recover).not.toHaveBeenCalled();
  expect(await service.status()).toMatchObject({ state: 'ready', operationPending: false });
});

it('yields initial inspection to a reserved command before any automatic recovery can start', async () => {
  const service = fixture();
  Object.assign(service, { children: new Map() });
  vi.spyOn(PidManager.prototype, 'getPid').mockReturnValueOnce(null);
  const reading = Promise.withResolvers<void>(), read = Promise.withResolvers<null>();
  vi.spyOn(RuntimeInstallation, 'openReadOnly').mockImplementationOnce(() => { reading.resolve(); return read.promise; });
  const open = vi.spyOn(RuntimeInstallation, 'open').mockResolvedValue(null);
  const tick = (service as unknown as { tick(): Promise<void> }).tick();
  await reading.promise;
  const result = service.upgrade({ directory: '/candidate', checkOnly: true }).catch(error => error);
  try {
    expect(mocks.replace).not.toHaveBeenCalled();
    await expect(service.upgrade({ directory: '/other-candidate', checkOnly: true })).rejects.toThrow(/busy/);
  } finally { read.resolve(null); await tick; }
  expect(await result).toMatchObject({ checked: true });
  expect(mocks.replace).toHaveBeenCalledTimes(1);
  expect(mocks.recover).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});

it('refuses an explicit command once the monitor has entered automatic recovery', async () => {
  const service = fixture();
  Object.assign(service, { children: new Map() });
  vi.spyOn(PidManager.prototype, 'getPid').mockReturnValueOnce(null);
  vi.spyOn(RuntimeInstallation, 'open').mockResolvedValue({
    activation: () => ({ checkpoint: '/original-checkpoint' }), selection: () => ({ current: 'a'.repeat(64) }),
    artifact: vi.fn().mockResolvedValue({}), close: vi.fn(),
  } as unknown as RuntimeInstallation);
  const recovering = Promise.withResolvers<void>(), recovered = Promise.withResolvers<void>();
  mocks.recover.mockImplementationOnce(async () => {
    recovering.resolve(); await recovered.promise;
    Object.assign(service, { children: new Map([[20, {}]]) });
    return { pid: 20 };
  });
  const tick = (service as unknown as { tick(): Promise<void> }).tick();
  await recovering.promise;
  try {
    expect((await service.status()).operationPending).toBe(true);
    await expect(service.recoverReviewed({ plan: '/reviewed-plan', sha256: 'a'.repeat(64) })).rejects.toThrow(/busy/);
  } finally { recovered.resolve(); await tick; }
  expect(mocks.recover).toHaveBeenCalledTimes(1);
  expect(mocks.reviewed).not.toHaveBeenCalled();
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
