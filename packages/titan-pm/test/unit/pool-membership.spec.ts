import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProcessPool } from '../../src/process-pool.js';
import type { IProcessManager, IProcessPoolOptions } from '../../src/types.js';
import type { ILogger } from '@omnitron-dev/titan/module/logger';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const pools: ProcessPool<unknown>[] = [];
const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ILogger;

async function fixture(size = 1, options: IProcessPoolOptions = {}) {
  let next = 0;
  const manager = {
    spawn: vi.fn(async (): Promise<{ __processId: string; __getHealth?: () => Promise<{ status: string }> }> => ({
      __processId: `worker-${++next}`, __getHealth: vi.fn(async () => ({ status: 'healthy' })),
    })),
    kill: vi.fn(async (_id: string) => true),
  };
  const pool = new ProcessPool(manager as unknown as IProcessManager, './worker.js', {
    size, healthCheck: { enabled: false }, heartbeat: { enabled: false }, recycleAfter: 0, maxLifetime: 0, ...options,
  }, logger);
  pools.push(pool);
  await pool.initialize();
  return { pool, manager };
}

afterEach(async () => {
  await Promise.all(pools.splice(0).map(pool => pool.destroy()));
  vi.restoreAllMocks();
});

describe('pool membership acknowledgments', () => {
  it('fences a retiring proxy before its asynchronous termination starts', async () => {
    const { pool, manager } = await fixture();
    const old = await manager.spawn.mock.results[0]!.value;
    const oldCall = vi.fn(async () => 'old');
    Object.assign(old, { work: oldCall });
    manager.spawn.mockResolvedValueOnce(Object.assign({ __processId: 'replacement' }, { work: async () => 'new' }));
    const entered = deferred<void>(), exited = deferred<boolean>();
    manager.kill.mockImplementationOnce(async () => { entered.resolve(); return exited.promise; });
    const replacing = (pool as unknown as { replaceWorker(id: string): Promise<void> }).replaceWorker('worker-1');
    await entered.promise;
    expect(pool.getWorkerIds()).toEqual(['worker-1', 'replacement']);
    await expect(pool.execute('work')).resolves.toBe('new');
    await expect(pool.execute('work')).resolves.toBe('new');
    expect(oldCall).not.toHaveBeenCalled();
    exited.resolve(true);
    await replacing;
  });

  it('finishes an admitted long call before planned retirement and admits new calls only to the replacement', async () => {
    vi.useFakeTimers();
    const { pool, manager } = await fixture(1, { requestTimeout: 10_000 });
    const response = deferred<string>(), draining = deferred<void>();
    const old = await manager.spawn.mock.results[0]!.value;
    Object.assign(old, { work: vi.fn(() => response.promise) });
    manager.spawn.mockResolvedValueOnce(Object.assign({ __processId: 'replacement' }, { work: async () => 'new' }));
    vi.spyOn(logger, 'debug').mockImplementation((_data, message) => {
      if (message === 'Waiting for worker to finish active requests') draining.resolve();
    });
    try {
      const admitted = pool.execute('work');
      const replacing = (pool as unknown as { replaceWorker(id: string): Promise<void> }).replaceWorker('worker-1');
      await draining.promise;
      await vi.advanceTimersByTimeAsync(5_100);
      expect(manager.kill).not.toHaveBeenCalled();
      await expect(pool.execute('work')).resolves.toBe('new');
      response.resolve('finished once');
      await expect(admitted).resolves.toBe('finished once');
      await vi.advanceTimersByTimeAsync(50);
      await replacing;
      expect(manager.kill).toHaveBeenCalledExactlyOnceWith('worker-1');
    } finally { response.resolve('cleanup'); vi.useRealTimers(); }
  });

  it('resumes queued requests when a fully retired pool gains a new worker', async () => {
    const { pool, manager } = await fixture();
    const entered = deferred<void>(), exited = deferred<boolean>();
    manager.kill.mockImplementationOnce(async () => { entered.resolve(); return exited.promise; });
    const shrinking = pool.scale(0);
    await entered.promise;
    const request = pool.execute('work');
    expect(pool.pending).toBe(1);
    manager.spawn.mockResolvedValueOnce(Object.assign({ __processId: 'replacement' }, { work: async () => 'new' }));
    const growing = pool.scale(1);
    exited.resolve(true);
    await shrinking;
    await growing;
    await expect(request).resolves.toBe('new');
    expect(pool.pending).toBe(0);
  });

  it('reserves capacity synchronously and wakes the next queued request on completion', async () => {
    const { pool, manager } = await fixture(1, { maxQueueSize: 1 });
    const response = deferred<string>();
    const old = await manager.spawn.mock.results[0]!.value;
    const work = vi.fn().mockImplementationOnce(() => response.promise).mockResolvedValue('next');
    Object.assign(old, { work });
    const first = pool.execute('work'), second = pool.execute('work');
    await expect(pool.execute('work')).rejects.toThrow('Pool queue is full');
    expect(work).toHaveBeenCalledTimes(1);
    response.resolve('first');
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('next');
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('queues instead of invoking an unhealthy worker and resumes after confirmed health recovery', async () => {
    const intervals = vi.spyOn(globalThis, 'setInterval');
    const { pool, manager } = await fixture(1, { healthCheck: { enabled: true, interval: 600_000, unhealthyThreshold: 0 } });
    const old = await manager.spawn.mock.results[0]!.value;
    const work = vi.fn().mockRejectedValueOnce(new Error('unhealthy')).mockResolvedValue('recovered');
    Object.assign(old, { work });
    await expect(pool.execute('work')).rejects.toThrow('unhealthy');
    const queued = pool.execute('work');
    expect(pool.pending).toBe(1);
    expect(work).toHaveBeenCalledTimes(1);
    const tick = intervals.mock.calls.find(([, delay]) => delay === 600_000)![0] as () => Promise<void>;
    await tick();
    await expect(queued).resolves.toBe('recovered');
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid initial sizes before initialization can spawn workers', () => {
    for (const size of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => new ProcessPool({} as IProcessManager, './worker.js', { size }, logger))
        .toThrow('non-negative safe integer');
    }
  });

  it('rejects malformed sizes before touching any worker and retains zero-size support', async () => {
    const { pool, manager } = await fixture();
    for (const size of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2' as unknown as number]) {
      await expect(pool.scale(size)).rejects.toThrow('non-negative safe integer');
    }
    expect(manager.spawn).toHaveBeenCalledTimes(1);
    expect(manager.kill).not.toHaveBeenCalled();
    await pool.scale(0);
    expect(pool.size).toBe(0);
    await pool.scale(2);
    expect(pool.size).toBe(2);
  });

  it('serializes concurrent targets against the completed membership', async () => {
    const { pool, manager } = await fixture();
    const pending = deferred<{ __processId: string }>();
    manager.spawn.mockImplementationOnce(() => pending.promise);
    const events: Array<{ from: number; to: number; observed: number }> = [];
    pool.on('pool:scaled', ({ from, to }) => events.push({ from, to, observed: pool.size }));
    const growing = pool.scale(3);
    const shrinking = pool.scale(1);
    expect(manager.kill).not.toHaveBeenCalled();
    pending.resolve({ __processId: 'delayed-worker' });
    await growing;
    await shrinking;
    expect(events).toEqual([{ from: 1, to: 3, observed: 3 }, { from: 3, to: 1, observed: 1 }]);
    expect(pool.size).toBe(1);
    expect(manager.spawn).toHaveBeenCalledTimes(3);
    expect(manager.kill).toHaveBeenCalledTimes(2);
  });

  it('joins late successful spawns before reporting a failed resize or admitting the next target', async () => {
    const { pool, manager } = await fixture();
    const pending = deferred<{ __processId: string }>();
    manager.spawn.mockRejectedValueOnce(new Error('spawn refused')).mockImplementationOnce(() => pending.promise);
    const success = vi.fn();
    pool.on('pool:scaled', success);
    let finished = false;
    const failed = expect(pool.scale(3).finally(() => { finished = true; })).rejects.toThrow('spawn refused');
    const retry = pool.scale(2);
    await Promise.resolve();
    await Promise.resolve();
    expect(finished).toBe(false);
    pending.resolve({ __processId: 'survivor' });
    await failed;
    await retry;
    expect(pool.size).toBe(2);
    expect(manager.spawn).toHaveBeenCalledTimes(3);
    expect(success).not.toHaveBeenCalled();
  });

  it('joins all exits and retains unconfirmed workers after partial shrink', async () => {
    const { pool, manager } = await fixture(3);
    const pending = deferred<boolean>();
    manager.kill.mockRejectedValueOnce(new Error('exit not confirmed')).mockImplementationOnce(() => pending.promise);
    let finished = false;
    const success = vi.fn();
    pool.on('pool:scaled', success);
    const failed = expect(pool.scale(1).finally(() => { finished = true; })).rejects.toThrow('exit not confirmed');
    const retry = pool.scale(2);
    await Promise.resolve();
    await Promise.resolve();
    expect(finished).toBe(false);
    pending.resolve(true);
    await failed;
    await retry;
    expect(pool.getWorkerIds()).toEqual(['worker-1', 'worker-3']);
    expect(manager.kill).toHaveBeenCalledTimes(2);
    expect(success).not.toHaveBeenCalled();
  });

  it('refuses success if the manager returned a duplicate worker identity', async () => {
    const { pool, manager } = await fixture();
    manager.spawn.mockResolvedValueOnce({ __processId: 'worker-1' });
    const success = vi.fn();
    pool.on('pool:scaled', success);
    await expect(pool.scale(2)).rejects.toThrow('requested 2, observed 1');
    expect(success).not.toHaveBeenCalled();
    expect(pool.size).toBe(1);
  });

  it('joins an admitted resize before acknowledging destroy and refuses queued resizing', async () => {
    const { pool, manager } = await fixture();
    const pending = deferred<{ __processId: string }>();
    manager.spawn.mockImplementationOnce(() => pending.promise);
    const growing = expect(pool.scale(2)).rejects.toThrow('not confirmed');
    const queued = expect(pool.scale(3)).rejects.toThrow('preempted');
    let destroyed = false;
    const stopping = pool.destroy().then(() => { destroyed = true; });
    await Promise.resolve();
    expect(destroyed).toBe(false);
    pending.resolve({ __processId: 'late-worker' });
    await growing;
    await queued;
    await stopping;
    expect(pool.size).toBe(0);
    expect(manager.spawn).toHaveBeenCalledTimes(2);
    expect(manager.kill.mock.calls.map(([id]) => id).sort()).toEqual(['late-worker', 'worker-1']);
    await expect(pool.scale(1)).rejects.toThrow('shutdown');
  });

  it('does not replace a worker already removed by a preceding resize', async () => {
    const { pool, manager } = await fixture(2);
    const pending = deferred<boolean>();
    manager.kill.mockImplementationOnce(() => pending.promise);
    const shrinking = pool.scale(1);
    // Health monitoring uses this exact membership operation after its async probe.
    const replacement = (pool as unknown as { replaceWorker(id: string): Promise<void> }).replaceWorker('worker-1');
    pending.resolve(true);
    await shrinking;
    await replacement;
    expect(pool.getWorkerIds()).toEqual(['worker-2']);
    expect(manager.spawn).toHaveBeenCalledTimes(2);
    expect(manager.kill).toHaveBeenCalledTimes(1);
  });

  it('fills only the deficit when initialization is retried after a partial failure', async () => {
    let next = 0;
    const manager = {
      spawn: vi.fn(async () => ({ __processId: `worker-${++next}` }))
        .mockRejectedValueOnce(new Error('temporarily unavailable')),
      kill: vi.fn(async () => true),
    };
    const pool = new ProcessPool(manager as unknown as IProcessManager, './worker.js', {
      size: 2, healthCheck: { enabled: false }, recycleAfter: 0, maxLifetime: 0,
    }, logger);
    pools.push(pool);
    const initialized = vi.fn();
    pool.on('pool:initialized', initialized);
    await expect(pool.initialize()).rejects.toThrow('temporarily unavailable');
    expect(pool.size).toBe(1);
    expect(initialized).not.toHaveBeenCalled();
    await pool.initialize();
    expect(pool.size).toBe(2);
    expect(manager.spawn).toHaveBeenCalledTimes(3);
    expect(initialized).toHaveBeenCalledExactlyOnceWith({ size: 2, class: 'worker' });
  });

  it('observes a failed health replacement without an unhandled timer rejection', async () => {
    const intervals = vi.spyOn(globalThis, 'setInterval');
    const { pool, manager } = await fixture(1, { healthCheck: { enabled: true, interval: 600_000, unhealthyThreshold: 1 } });
    const proxy = await manager.spawn.mock.results[0]!.value;
    proxy.__getHealth = async () => { throw new Error('unhealthy'); };
    manager.spawn.mockRejectedValueOnce(new Error('replacement refused'));
    const tick = intervals.mock.calls.find(([, delay]) => delay === 600_000)![0] as () => Promise<void>;
    await expect(tick()).resolves.toBeUndefined();
    expect(pool.getWorkerIds()).toEqual(['worker-1']);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(Error) }),
      'Pool health recovery incomplete; remaining workers are still owned');
  });

  it('observes health recovery preempted by an explicit resize', async () => {
    const intervals = vi.spyOn(globalThis, 'setInterval');
    const { pool, manager } = await fixture(1, { healthCheck: { enabled: true, interval: 600_000, unhealthyThreshold: 1 } });
    const proxy = await manager.spawn.mock.results[0]!.value;
    proxy.__getHealth = async () => { throw new Error('unhealthy'); };
    const pending = deferred<{ __processId: string }>();
    manager.spawn.mockImplementationOnce(() => pending.promise);
    const growing = pool.scale(2);
    const recovering = deferred<void>();
    vi.spyOn(logger, 'info').mockImplementation((_data, message) => {
      if (message === 'Replacing unhealthy worker') recovering.resolve();
    });
    const tick = intervals.mock.calls.find(([, delay]) => delay === 600_000)![0] as () => Promise<void>;
    const checking = tick();
    await recovering.promise;
    const shrinking = pool.scale(1);
    await expect(checking).resolves.toBeUndefined();
    pending.resolve({ __processId: 'new-worker' });
    await growing;
    await shrinking;
    expect(pool.size).toBe(1);
    expect(manager.spawn).toHaveBeenCalledTimes(2);
    expect(logger.debug).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(Error) }),
      'Pool health recovery deferred to an explicit lifecycle operation');
  });

  it('reuses a retained replacement while the previous worker refuses to exit', async () => {
    const { pool, manager } = await fixture();
    const recovery = pool as unknown as { replaceWorker(id: string): Promise<void> };
    manager.kill.mockRejectedValueOnce(new Error('still alive')).mockRejectedValueOnce(new Error('still alive'));
    await expect(recovery.replaceWorker('worker-1')).rejects.toThrow('still alive');
    expect(pool.getWorkerIds()).toEqual(['worker-1', 'worker-2']);
    await expect(recovery.replaceWorker('worker-1')).rejects.toThrow('still alive');
    expect(pool.getWorkerIds()).toEqual(['worker-1', 'worker-2']);
    expect(manager.spawn).toHaveBeenCalledTimes(2);
    // A failed replacement cannot itself start an unbounded replacement chain.
    await expect(recovery.replaceWorker('worker-2')).rejects.toThrow('previous worker worker-1 is still unconfirmed');
    expect(manager.spawn).toHaveBeenCalledTimes(2);
    await recovery.replaceWorker('worker-1');
    expect(pool.getWorkerIds()).toEqual(['worker-2']);
    expect(manager.spawn).toHaveBeenCalledTimes(2);
  });

  it('creates a fresh replacement only if the retained replacement has since been removed', async () => {
    const { pool, manager } = await fixture();
    const recovery = pool as unknown as { replaceWorker(id: string): Promise<void>; shutdownWorker(id: string): Promise<void> };
    manager.kill.mockRejectedValueOnce(new Error('still alive'));
    await expect(recovery.replaceWorker('worker-1')).rejects.toThrow('still alive');
    // Retire the replacement through the same per-worker shutdown used by
    // resizing. The unconfirmed old proxy must never accept a blocking call.
    await recovery.shutdownWorker('worker-2');
    expect(pool.getWorkerIds()).toEqual(['worker-1']);
    await recovery.replaceWorker('worker-1');
    expect(pool.getWorkerIds()).toEqual(['worker-3']);
    expect(manager.spawn).toHaveBeenCalledTimes(3);
  });
});
