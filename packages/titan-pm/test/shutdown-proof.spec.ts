import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProcessManager } from '../src/process-manager.js';
import { ProcessPool } from '../src/process-pool.js';
import { ProcessStatus } from '../src/types.js';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
function harness() {
  const logger: any = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), child: () => logger };
  const pm = new ProcessManager(logger, { livenessSweepIntervalMs: 0 });
  const state = pm as any;
  const worker = (id: string, terminate: () => Promise<void>) => {
    state.processes.set(id, { id, name: id, status: ProcessStatus.RUNNING, startTime: Date.now() });
    state.workers.set(id, { terminate });
  };
  return { pm, state, logger, worker };
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('ProcessManager shutdown proof', () => {
  it('shares one pending promise and preserves success for every caller', async () => {
    const { pm, worker } = harness(); const gate = deferred();
    const terminate = vi.fn(() => gate.promise); worker('worker', terminate);
    const first = pm.shutdown();
    expect(pm.shutdown({ force: true })).toBe(first);
    await Promise.resolve(); await Promise.resolve();
    gate.resolve(); await first;
    expect(terminate).toHaveBeenCalledOnce();
    expect(pm.shutdown()).toBe(first);
    expect(pm.getProcess('worker')?.status).toBe(ProcessStatus.STOPPED);
  });

  it('waits for all attempted terminations and retains a failed outcome on repeats', async () => {
    const { pm, worker } = harness(); const gate = deferred();
    const failure = new Error('worker exit not confirmed');
    const failed = vi.fn(async () => { throw failure; });
    const sibling = vi.fn(() => gate.promise);
    worker('failed', failed); worker('sibling', sibling);
    let settled = false;
    const first = pm.shutdown();
    const observed = first.catch(error => { settled = true; return error; });
    await new Promise(resolve => setImmediate(resolve));
    expect(failed).toHaveBeenCalledOnce(); expect(sibling).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    gate.resolve(); const outcome = await observed;
    expect(outcome).toBeInstanceOf(AggregateError);
    expect(outcome.errors).toContain(failure);
    expect(pm.shutdown({ force: true })).toBe(first);
    await expect(pm.shutdown()).rejects.toBe(outcome);
    expect(failed).toHaveBeenCalledOnce();
    expect(pm.getWorkerHandle('failed')).toBeDefined();
  });

  it('collects pool drain/destruction failures without skipping healthy pools or workers', async () => {
    const { pm, state, worker, logger } = harness();
    const drainFailure = new Error('requests did not drain'), destroyFailure = new Error('pool worker survived');
    const failed = { drain: vi.fn(async () => { throw drainFailure; }), destroy: vi.fn(async () => { throw destroyFailure; }) };
    const healthy = { drain: vi.fn(async () => {}), destroy: vi.fn(async () => {}) };
    state.pools.set('failed', failed); state.pools.set('healthy', healthy);
    const terminate = vi.fn(async () => {}); worker('regular', terminate);
    const outcome = await pm.shutdown().catch(error => error);
    expect(outcome.errors).toEqual([drainFailure, destroyFailure]);
    expect(failed.destroy).toHaveBeenCalledOnce(); expect(healthy.destroy).toHaveBeenCalledOnce();
    expect(terminate).toHaveBeenCalledOnce();
    expect([...state.pools.keys()]).toEqual(['failed']);
    expect(logger.info).not.toHaveBeenCalledWith('Process Manager shutdown complete');
  });

  it('keeps timeout uncertainty even if a worker eventually exits, with no timer leak', async () => {
    vi.useFakeTimers();
    const { pm, worker } = harness(); const gate = deferred();
    worker('slow', () => gate.promise);
    const first = pm.shutdown({ timeout: 20 });
    const observed = first.catch(error => error);
    await vi.advanceTimersByTimeAsync(20);
    const outcome = await observed;
    expect(outcome).toBeInstanceOf(AggregateError);
    expect(String(outcome)).toContain('termination is unconfirmed');
    expect(vi.getTimerCount()).toBe(0);
    gate.resolve(); await Promise.resolve();
    await expect(pm.shutdown()).rejects.toBe(outcome);
  });

  it('fences new process, pool, supervisor and workflow admission synchronously', async () => {
    const { pm } = harness(); const done = pm.shutdown();
    class Worker {}
    await expect(pm.spawn(Worker)).rejects.toThrow('admission is closed');
    await expect(pm.pool(Worker)).rejects.toThrow('admission is closed');
    expect(() => pm.createSupervisor(Worker)).toThrow('admission is closed');
    await expect(pm.workflow(Worker)).rejects.toThrow('admission is closed');
    await done;
  });

  it('owns a pool admitted before its initialization completes', async () => {
    const { pm, state } = harness(); const gate = deferred();
    vi.spyOn(ProcessPool.prototype, 'initialize').mockImplementation(() => gate.promise);
    const destroy = vi.spyOn(ProcessPool.prototype, 'destroy').mockResolvedValue();
    const admission = pm.pool(class Worker {}).catch(error => error);
    expect(state.pools.size).toBe(1);
    const stopped = pm.shutdown(); gate.resolve();
    expect(await admission).toBeInstanceOf(Error);
    await stopped;
    expect(destroy).toHaveBeenCalled(); expect(state.pools.size).toBe(0);
  });
});
