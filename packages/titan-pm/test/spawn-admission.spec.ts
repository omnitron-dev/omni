import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProcessManager } from '../src/process-manager.js';
import { ProcessPool } from '../src/process-pool.js';
import { ProcessStatus, type ISpawnOptions, type IWorkerExitInfo } from '../src/types.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.restoreAllMocks(); });

function fixture() {
  const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const pm = new ProcessManager(logger as never, { livenessSweepIntervalMs: 0 });
  const spawn = vi.fn(async (_source: unknown, options: ISpawnOptions) => {
    let alive = true;
    const listeners = new Set<(exit: IWorkerExitInfo) => void>();
    return { id: options.processId, status: ProcessStatus.RUNNING, isAlive: () => alive,
      proxy: { __processId: options.processId, work: async () => 'served' },
      onExit: (listener: (exit: IWorkerExitInfo) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
      terminate: vi.fn(async () => { alive = false; for (const listener of listeners)
        listener({ workerId: options.processId!, serviceName: 'worker', code: 0, signal: null, expected: true }); }),
    };
  });
  Object.assign(pm, { spawner: { spawn } });
  cleanup.push(() => pm.shutdown());
  return { pm, spawn, logger };
}

describe('parent process admission', () => {
  it('awaits approval before registry/events/native spawn and strips the callback from child config', async () => {
    const { pm, spawn } = fixture(); const gate = deferred();
    const announced = vi.fn(); pm.on('process:spawn', announced);
    const beforeSpawn = vi.fn(() => gate.promise);
    const starting = pm.spawn('./worker.js', { beforeSpawn, name: 'verified' });
    expect(beforeSpawn).toHaveBeenCalledOnce();
    expect(pm.listProcesses()).toEqual([]); expect(announced).not.toHaveBeenCalled(); expect(spawn).not.toHaveBeenCalled();
    gate.resolve(); await starting;
    expect(spawn).toHaveBeenCalledOnce(); expect(announced).toHaveBeenCalledOnce();
    expect(spawn.mock.calls[0]![1]).not.toHaveProperty('beforeSpawn');
    expect(spawn.mock.calls[0]![1].config).not.toHaveProperty('beforeSpawn');
  });

  it('refuses failed admission without creating a process or announcing a native crash', async () => {
    const { pm, spawn } = fixture(); const crashed = vi.fn(); pm.on('process:crash', crashed);
    await expect(pm.spawn('./worker.js', { beforeSpawn: () => { throw new Error('artifact changed'); } })).rejects.toThrow('artifact changed');
    expect(spawn).not.toHaveBeenCalled(); expect(pm.listProcesses()).toEqual([]); expect(crashed).not.toHaveBeenCalled();
  });

  it('rechecks manager shutdown after an awaiting admission', async () => {
    const { pm, spawn } = fixture(); const gate = deferred();
    const starting = pm.spawn('./worker.js', { beforeSpawn: () => gate.promise });
    const rejected = expect(starting).rejects.toThrow('admission is closed');
    await pm.shutdown(); gate.resolve(); await rejected;
    expect(spawn).not.toHaveBeenCalled(); expect(pm.listProcesses()).toEqual([]);
  });

  it('retains the parent callback across supervisor restart, including a denied restart', async () => {
    const { pm, spawn } = fixture();
    const beforeSpawn = vi.fn(async () => {});
    const supervisor = pm.createSupervisor({ maxRestarts: 0, children: [
      { name: 'single', process: './worker.js', spawnOptions: { beforeSpawn } },
    ] });
    cleanup.push(() => supervisor.stop());
    await supervisor.start(); await supervisor.restartChild('single');
    expect(beforeSpawn).toHaveBeenCalledTimes(2); expect(spawn).toHaveBeenCalledTimes(2);
    beforeSpawn.mockRejectedValueOnce(new Error('receipt no longer matches'));
    const failed = vi.fn(); supervisor.on('child:start-failed', failed);
    await supervisor.restartChild('single');
    expect(beforeSpawn).toHaveBeenCalledTimes(3); expect(spawn).toHaveBeenCalledTimes(2);
    expect(failed).toHaveBeenCalledWith('single', expect.objectContaining({ message: 'receipt no longer matches' }));
  });

  it('preserves the serving worker on pool admission refusal and reports settlement only after successful retirement', async () => {
    const { pm, spawn, logger } = fixture(); const beforeSpawn = vi.fn(async () => {});
    const pool = new ProcessPool(pm, './worker.js', { size: 1, spawnOptions: { beforeSpawn },
      healthCheck: { enabled: false }, heartbeat: { enabled: false }, maxLifetime: 0, recycleAfter: 0 }, logger as never);
    cleanup.push(() => pool.destroy()); await pool.initialize();
    const oldId = pool.getWorkerIds()[0]!; const old = pm.getWorkerHandle(oldId)!;
    const replace = () => (pool as unknown as { replaceWorker(id: string): Promise<void> }).replaceWorker(oldId);
    const settled = vi.fn(() => expect(pool.membershipChanging).toBe(false)); pool.on('pool:membership-settled', settled);
    beforeSpawn.mockRejectedValueOnce(new Error('digest mismatch'));
    await expect(replace()).rejects.toThrow('digest mismatch');
    expect(spawn).toHaveBeenCalledOnce(); expect(old.isAlive()).toBe(true); expect(old.terminate).not.toHaveBeenCalled();
    expect(pool.getWorkerIds()).toEqual([oldId]); expect(settled).toHaveBeenCalledOnce();
    await expect(pool.execute('work')).resolves.toBe('served');
    await replace();
    expect(spawn).toHaveBeenCalledTimes(2); expect(old.isAlive()).toBe(false); expect(settled).toHaveBeenCalledTimes(2);
  });

  it('retains the same parent admission when a supervisor owns the pool', async () => {
    const { pm, spawn } = fixture(); const beforeSpawn = vi.fn(async () => {});
    const supervisor = pm.createSupervisor({ maxRestarts: 0, children: [{ name: 'workers', process: './worker.js',
      poolOptions: { size: 1, spawnOptions: { beforeSpawn }, healthCheck: { enabled: false },
        heartbeat: { enabled: false }, maxLifetime: 0, recycleAfter: 0 } }] });
    cleanup.push(() => supervisor.stop()); await supervisor.start();
    const pool = supervisor.getChildProxy('workers') as ProcessPool<unknown>;
    const old = pool.getWorkerIds()[0]!;
    beforeSpawn.mockRejectedValueOnce(new Error('supervised admission refused'));
    await expect((pool as unknown as { replaceWorker(id: string): Promise<void> }).replaceWorker(old))
      .rejects.toThrow('supervised admission refused');
    expect(beforeSpawn).toHaveBeenCalledTimes(2); expect(spawn).toHaveBeenCalledOnce();
    expect(pm.getWorkerHandle(old)!.isAlive()).toBe(true);
    expect(pool.getWorkerIds()).toEqual([old]);
  });

  it('cleans every admitted worker when another initial admission rejects', async () => {
    const { pm, spawn } = fixture();
    let attempts = 0;
    const rejection = new Error('second admission refused');
    const failed = await pm.pool('./worker.js', { size: 2, spawnOptions: { beforeSpawn: () => {
      if (++attempts === 2) throw rejection;
    } } }).catch(error => error);
    expect(failed).toBeInstanceOf(AggregateError); expect(failed.errors).toEqual([rejection]);
    expect(spawn).toHaveBeenCalledOnce();
    const worker = await spawn.mock.results[0]!.value;
    expect(worker.isAlive()).toBe(false); expect(worker.terminate).toHaveBeenCalledOnce();
    expect(pm.getWorkerHandle(worker.id!)).toBeUndefined();
  });

  it('retains failed initialization cleanup for the manager’s normal shutdown retry', async () => {
    const { pm, spawn } = fixture(); const realSpawn = spawn.getMockImplementation()!;
    const exitFailure = new Error('native exit not confirmed');
    spawn.mockImplementationOnce(async (...args) => {
      const worker = await realSpawn(...args);
      worker.terminate.mockRejectedValueOnce(exitFailure);
      return worker;
    });
    let attempts = 0;
    const rejection = new Error('second admission refused');
    const failed = await pm.pool('./worker.js', { size: 2, spawnOptions: { beforeSpawn: () => {
      if (++attempts === 2) throw rejection;
    } } }).catch(error => error);
    expect(failed).toBeInstanceOf(AggregateError); expect(failed.errors[0].errors).toEqual([rejection]);
    expect(failed.errors[1].errors).toContain(exitFailure);
    expect(String(failed)).toContain('cleanup is unconfirmed');
    const worker = await spawn.mock.results[0]!.value;
    expect(worker.isAlive()).toBe(true); expect(pm.getWorkerHandle(worker.id!)).toBe(worker);
    await pm.shutdown();
    expect(worker.terminate).toHaveBeenCalledTimes(2); expect(worker.isAlive()).toBe(false);
    expect(pm.getWorkerHandle(worker.id!)).toBeUndefined();
  });

  it('does not spawn a replacement when pool teardown arrives during admission', async () => {
    const { pm, spawn, logger } = fixture(); const gate = deferred(), entered = deferred();
    const beforeSpawn = vi.fn(async () => {});
    const pool = new ProcessPool(pm, './worker.js', { size: 1, spawnOptions: { beforeSpawn },
      healthCheck: { enabled: false }, heartbeat: { enabled: false }, maxLifetime: 0, recycleAfter: 0 }, logger as never);
    await pool.initialize();
    beforeSpawn.mockImplementationOnce(async () => { entered.resolve(); await gate.promise; });
    const replacing = (pool as unknown as { replaceWorker(id: string): Promise<void> }).replaceWorker(pool.getWorkerIds()[0]!);
    const rejected = expect(replacing).rejects.toThrow('stopped accepting workers');
    await entered.promise; expect(pool.membershipChanging).toBe(true);
    const stopping = pool.destroy(); gate.resolve(); await rejected; await stopping;
    expect(spawn).toHaveBeenCalledOnce(); expect(pool.getWorkerIds()).toEqual([]);
  });
});
