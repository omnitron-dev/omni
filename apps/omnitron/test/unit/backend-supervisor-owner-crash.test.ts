import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), boot: vi.fn() }));
vi.mock('../../src/daemon/execution-journal.js', () => ({ readPrivateRecord: mocks.read, writePrivateRecord: mocks.write }));
vi.mock('../../src/daemon/managed-runtime.js', () => ({ hostBootIdentity: mocks.boot, managedJobPid: vi.fn(), verifyManagedIsolation: vi.fn() }));
vi.mock('../../src/config/saved.js', () => ({ readSavedDaemonConfig: () => ({}), savedDaemonOverrides: () => ({}) }));
import { BackendSupervisorService } from '../../src/daemon/backend-supervisor.js';
import { PidManager } from '../../src/daemon/pid-manager.js';
import type { ManagedRuntime } from '../../src/daemon/managed-runtime.js';
afterEach(() => vi.restoreAllMocks());

async function tick(receipt: unknown, writeFails = false) {
  mocks.read.mockResolvedValue(receipt); mocks.boot.mockResolvedValue('current-boot');
  mocks.write.mockReset();
  if (writeFails) mocks.write.mockRejectedValue(new Error('ENOSPC'));
  else mocks.write.mockResolvedValue(undefined);
  vi.spyOn(PidManager.prototype, 'getPid').mockReturnValue(null);
  vi.spyOn(PidManager.prototype, 'isRunning').mockReturnValue(false);
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => { if (writeFails) throw new Error('ENOSPC'); return true; });
  const finish = vi.fn();
  const service = new BackendSupervisorService({ directory: '/isolated-owner', instanceHome: '/isolated-home' } as ManagedRuntime, finish);
  Object.assign(service, { lastExit: { code: 0, signal: null }, state: { pid: 30, backendPid: 20, ownerPid: 10, state: 'ready', reason: null, at: '' } });
  await (service as unknown as { tick(): Promise<void> }).tick();
  stderr.mockRestore();
  return { service, finish, status: await service.status() };
}

describe('guardian distinguishes a crashed owner from clean shutdown', () => {
  it.each([null, { clean: false, pid: 10, bootId: 'current-boot' },
    { clean: true, pid: 99, bootId: 'current-boot' }, { clean: true, pid: 10, bootId: 'old-boot' }])
  ('keeps recovery blocked for absent/dirty/stale receipt: %j', async receipt => {
    const result = await tick(receipt);
    expect(result.finish).not.toHaveBeenCalled();
    expect(result.status.state).toBe('blocked');
    expect(result.status.reason).toMatch(/reconciliation/);
  });
  it('exits cleanly only for its observed owner and current host boot', async () => {
    const result = await tick({ clean: true, pid: 10, bootId: 'current-boot' });
    expect(result.finish).toHaveBeenCalledWith(0);
    expect(result.status.state).toBe('stopping');
  });
  it('retains in-memory failure evidence when both private persistence and stderr are full', async () => {
    const result = await tick({ clean: false, pid: 10, bootId: 'current-boot' }, true);
    expect(result.finish).not.toHaveBeenCalled();
    expect(result.status.state).toBe('blocked');
    expect(result.status.persistenceError).toContain('ENOSPC');
  });
});
