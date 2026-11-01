import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { ProcessManager } from '../../src/process-manager.js';
import { ProcessPool } from '../../src/process-pool.js';
import { ProcessSupervisor } from '../../src/process-supervisor.js';
import { WorkerHandle } from '../../src/process-spawner.js';
import { ProcessStatus } from '../../src/types.js';

const death = vi.hoisted(() => vi.fn());
vi.mock('../../src/confirm-death.js', () => ({ confirmDeath: death }));
const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('termination acknowledgements', () => {
  it('does not confuse a closed IPC channel or an expired deadline with process exit', async () => {
    vi.useFakeTimers();
    death.mockResolvedValue({ dead: false, state: 'alive', waitedMs: 2000 });
    const child: any = Object.assign(new EventEmitter(), {
      // Our own PID is used only for the read-only liveness probe; signals
      // go to this test double, never to the OS.
      pid: process.pid, exitCode: null, signalCode: null, connected: false, kill: vi.fn(),
    });
    const handle: any = Object.assign(Object.create(WorkerHandle.prototype), { id: 'child', logger });
    let completed = false;
    const stopped = handle.terminateChildProcess(child, 100).finally(() => { completed = true; });
    const rejection = expect(stopped).rejects.toThrow('did not confirm exit');
    child.emit('error', Object.assign(new Error('IPC closed'), { code: 'ERR_IPC_CHANNEL_CLOSED' }));
    await Promise.resolve();
    expect(completed).toBe(false);
    await vi.runAllTimersAsync();
    await rejection;
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(child.listenerCount('exit')).toBe(0);
    expect(child.listenerCount('error')).toBe(0);
  });

  it('retains manager ownership on failure and routes retry through the same deadline and cleanup', async () => {
    const terminate = vi.fn().mockRejectedValueOnce(new Error('still alive')).mockResolvedValue(undefined);
    const disconnect = vi.fn().mockRejectedValue(new Error('socket gone'));
    const pm: any = Object.assign(Object.create(ProcessManager.prototype), {
      processes: new Map([['p', { status: ProcessStatus.RUNNING }]]),
      workers: new Map([['p', { terminate }]]), serviceProxies: new Map([['p', { __destroy: disconnect }]]),
      inFlightSpawns: new Map(), killRequested: new Set(), logger, emit: vi.fn(),
      healthChecker: { stopMonitoring: vi.fn() }, metricsCollector: { stopCollection: vi.fn() },
      registry: { unregister: vi.fn() },
    });
    await expect(pm.kill('p', 'SIGTERM', { shutdownTimeout: 500 })).rejects.toThrow('still alive');
    expect(pm.workers.has('p')).toBe(true);
    expect(pm.registry.unregister).not.toHaveBeenCalled();
    await expect(pm.kill('p', 'SIGTERM', { shutdownTimeout: 500 })).resolves.toBe(true);
    expect(terminate).toHaveBeenLastCalledWith({ shutdownTimeout: 500 });
    expect(pm.workers.size).toBe(0);
    expect(pm.processes.get('p').status).toBe(ProcessStatus.STOPPED);
  });

  it('attempts every supervisor child and keeps only unconfirmed children for retry', async () => {
    let next = 0;
    const manager: any = {
      spawn: vi.fn(async () => ({ __processId: `p${++next}` })), on: vi.fn(), off: vi.fn(),
      kill: vi.fn().mockRejectedValueOnce(new Error('permission denied')).mockResolvedValue(true),
    };
    const supervisor = ProcessSupervisor.fromConfig(manager, {
      children: [{ name: 'one', process: './one.js' }, { name: 'two', process: './two.js' }],
    }, logger);
    await supervisor.start();
    await expect(supervisor.stop()).rejects.toThrow('permission denied');
    expect(manager.kill).toHaveBeenCalledTimes(2);
    expect(supervisor.getChildNames()).toEqual(['two']);
    await supervisor.stop();
    expect(supervisor.getChildNames()).toEqual([]);
  });

  it('joins every pool termination before rejecting and retains survivors', async () => {
    let next = 0;
    const manager: any = {
      spawn: vi.fn(async () => ({ __processId: `p${++next}` })),
      kill: vi.fn().mockRejectedValueOnce(new Error('still alive')).mockResolvedValue(true),
    };
    const pool = new ProcessPool(manager, './worker.js', { size: 2, healthCheck: { enabled: false } }, logger);
    await pool.initialize();
    await expect(pool.destroy()).rejects.toThrow('still alive');
    expect(manager.kill).toHaveBeenCalledTimes(2);
    expect(pool.getWorkerIds()).toEqual(['p1']);
    await pool.destroy();
    expect(pool.getWorkerIds()).toEqual([]);
  });

  it('does not let a late pool spawn escape a completed destroy', async () => {
    let release!: (proxy: { __processId: string }) => void;
    const manager: any = {
      spawn: vi.fn(() => new Promise(resolve => { release = resolve; })), kill: vi.fn().mockResolvedValue(true),
    };
    const pool = new ProcessPool(manager, './worker.js', { size: 1, healthCheck: { enabled: false } }, logger);
    const starting = expect(pool.initialize()).rejects.toThrow('shutting down');
    let destroyed = false;
    const stopping = pool.destroy().then(() => { destroyed = true; });
    await Promise.resolve();
    expect(destroyed).toBe(false);
    release({ __processId: 'late' });
    await starting;
    await stopping;
    expect(manager.kill).toHaveBeenCalledWith('late');
    expect(pool.getWorkerIds()).toEqual([]);
  });
});
