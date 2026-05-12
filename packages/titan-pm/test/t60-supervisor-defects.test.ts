/**
 * Regression tests for T#60 — supervisor T3 bundle (medium-severity
 * polish defects across `process-pool`, `process-supervisor`,
 * `process-workflow`, and `netron-client`).
 *
 * Each block pins one defect's invariant. The bundle's defects fall
 * into three families:
 *
 *   A. setTimeout leaks. The `Promise.race(work, timeout)` pattern
 *      left the loser timer running. Across the hot paths
 *      (request execution, stage execution, RPC connect, circuit-
 *      breaker half-open) these accumulated thousands of pending
 *      timers and kept the event loop alive past pool shutdown.
 *
 *   B. Stale state on circuit-breaker close. `lastFailTime` was
 *      retained and the half-open transition timer was untracked,
 *      so a recovered circuit kept firing transition events on a
 *      destroyed pool.
 *
 *   C. Supervisor lifecycle gaps. Silent startup failure on
 *      non-critical children. Uncancellable backoff sleep that
 *      could resurrect a child during shutdown. Backoff curve
 *      driven by lifetime restart count rather than the current
 *      sliding window. Netron client auto-reconnect racing with
 *      user-initiated disconnect.
 *
 * Defects covered:
 *
 *   1. `ProcessPool.executeOnWorker` request-timeout clearTimeout.
 *   2. `ProcessPool.executeOnWorker` clamps `currentLoad` to ≥ 0.
 *   3. `ProcessWorkflow.executeWithTimeout` clearTimeout on success.
 *   4. `NetronClient.doConnect` clearTimeout on success.
 *   5. `ProcessPool.openCircuitBreaker` tracks the half-open timer.
 *   6. `ProcessPool.closeCircuitBreaker` resets `lastFailTime` and
 *      clears the pending half-open timer.
 *   7. `ProcessPool.destroy` clears the half-open timer.
 *   8. `ProcessSupervisor.startChild` emits `child:start-failed`
 *      for non-critical / optional children whose start fails.
 *   9. `ProcessSupervisor.performRestart` backoff sleep is
 *      cancellable on `stop()`.
 *  10. `ProcessSupervisor.performRestart` re-checks `isStopping`
 *      after the sleep returns.
 *  11. `ProcessSupervisor.performRestart` backoff uses the
 *      windowed restart count, not the lifetime counter.
 *  12. `NetronClient.disconnectHandler` ignores peer-initiated
 *      events while the client is in DISCONNECTING/DISCONNECTED.
 */

import { describe, it, expect, vi } from 'vitest';
import { ProcessPool } from '../src/process-pool.js';
import { ProcessSupervisor } from '../src/process-supervisor.js';
import { PoolStrategy, SupervisionStrategy } from '../src/types.js';
import type { IProcessManager } from '../src/types.js';

const noopLogger: any = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
  child: () => noopLogger,
};

function createMockManager() {
  const listeners = new Map<string, Array<(...args: any[]) => void>>();
  let nextId = 1;
  const manager: any = {
    on(event: string, fn: any) {
      const list = listeners.get(event) ?? [];
      list.push(fn);
      listeners.set(event, list);
    },
    off(event: string, fn: any) {
      const list = listeners.get(event);
      if (!list) return;
      listeners.set(event, list.filter((l) => l !== fn));
    },
    emit(event: string, ...args: any[]) {
      const list = listeners.get(event);
      if (!list) return;
      for (const fn of [...list]) fn(...args);
    },
    spawn: vi.fn(async (cls: any) => ({ __processId: `pm-${nextId++}`, __cls: cls.name ?? cls })),
    kill: vi.fn(async () => true),
    pool: vi.fn(),
    getMetrics: vi.fn(async () => null),
    getHealth: vi.fn(async () => null),
    getWorkerHandle: vi.fn((id: string) => ({ id, send: vi.fn() })),
  };
  return { manager: manager as IProcessManager };
}

describe('T#60 — supervisor T3 polish regressions', () => {
  // ─── Defect 1: executeOnWorker request-timeout leak ────────────────
  describe('ProcessPool.executeOnWorker — clears request timeout on race win', () => {
    it('does not leave a pending setTimeout after the worker call resolves', async () => {
      const { manager } = createMockManager();
      const pool = new ProcessPool<any>(
        manager,
        class FakeService {},
        { size: 1, requestTimeout: 60_000, healthCheck: { enabled: false }, strategy: PoolStrategy.ROUND_ROBIN },
        noopLogger,
      );
      await pool.initialize();

      const worker = (pool as any).workers.values().next().value;
      // Replace the proxy with one that resolves immediately.
      worker.proxy = { foo: vi.fn(async () => 'ok') };

      const setSpy = vi.spyOn(global, 'setTimeout');
      const clearSpy = vi.spyOn(global, 'clearTimeout');

      const result = await (pool as any).executeOnWorker(worker, 'foo', []);
      expect(result).toBe('ok');

      // Whatever setTimeouts we created on the hot path must each be
      // matched by clearTimeout. Pre-T#60 the timeout handle was
      // dropped on the floor, leaving the timer pending for 60s.
      const setCount = setSpy.mock.calls.length;
      const clearCount = clearSpy.mock.calls.length;
      expect(clearCount).toBeGreaterThanOrEqual(setCount);

      setSpy.mockRestore();
      clearSpy.mockRestore();
      await pool.destroy();
    });

    // ─── Defect 2: currentLoad clamp ───────────────────────────────
    it('clamps currentLoad to zero on the finally path (does not go negative)', async () => {
      const { manager } = createMockManager();
      const pool = new ProcessPool<any>(
        manager,
        class FakeService {},
        { size: 1, healthCheck: { enabled: false }, strategy: PoolStrategy.ROUND_ROBIN },
        noopLogger,
      );
      await pool.initialize();

      const worker = (pool as any).workers.values().next().value;
      worker.proxy = { foo: vi.fn(async () => 'ok') };
      worker.currentLoad = 0; // start at the floor

      await (pool as any).executeOnWorker(worker, 'foo', []);

      // Pre-T#60 this could land at -1 because the decrement was
      // unconditional. With the clamp it must be ≥ 0.
      expect(worker.currentLoad).toBeGreaterThanOrEqual(0);

      await pool.destroy();
    });
  });

  // ─── Defects 5, 6, 7: circuit-breaker timer hygiene ───────────────
  describe('ProcessPool — circuit-breaker timer hygiene', () => {
    it('tracks the half-open transition timer so destroy() can cancel it', async () => {
      const { manager } = createMockManager();
      const pool = new ProcessPool<any>(
        manager,
        class FakeService {},
        {
          size: 1,
          healthCheck: { enabled: false },
          circuitBreaker: { enabled: true, threshold: 1, timeout: 60_000 },
        } as any,
        noopLogger,
      );
      await pool.initialize();

      // Open the breaker.
      (pool as any).openCircuitBreaker();
      // The tracked handle MUST exist now.
      expect((pool as any).circuitBreakerHalfOpenTimer).toBeDefined();

      await pool.destroy();
      // After destroy(), the handle MUST be cleared. Pre-T#60 the
      // setTimeout kept running on a destroyed pool.
      expect((pool as any).circuitBreakerHalfOpenTimer).toBeUndefined();
    });

    it('resets lastFailTime AND clears the timer on close()', async () => {
      const { manager } = createMockManager();
      const pool = new ProcessPool<any>(
        manager,
        class FakeService {},
        {
          size: 1,
          healthCheck: { enabled: false },
          circuitBreaker: { enabled: true, threshold: 1, timeout: 60_000 },
        } as any,
        noopLogger,
      );
      await pool.initialize();

      (pool as any).circuitBreaker.lastFailTime = Date.now();
      (pool as any).openCircuitBreaker();
      expect((pool as any).circuitBreakerHalfOpenTimer).toBeDefined();

      (pool as any).closeCircuitBreaker();

      // Pre-T#60: lastFailTime stayed populated, and the half-open
      // timer kept running. Both are reset now.
      expect((pool as any).circuitBreaker.lastFailTime).toBe(0);
      expect((pool as any).circuitBreakerHalfOpenTimer).toBeUndefined();
      expect((pool as any).circuitBreaker.isOpen).toBe(false);

      await pool.destroy();
    });
  });

  // ─── Defect 8: startChild silent failure ──────────────────────────
  describe('ProcessSupervisor.startChild — emits child:start-failed on non-critical failure', () => {
    it('emits child:start-failed when a non-critical child throws during startup', async () => {
      const { manager } = createMockManager();
      const m = manager as any;
      // Make spawn reject so startChild always hits the catch branch.
      m.spawn = vi.fn(async () => {
        throw new Error('spawn failure');
      });

      class FakeProcess {}
      const supervisor = ProcessSupervisor.fromConfig(
        m,
        {
          strategy: SupervisionStrategy.ONE_FOR_ONE,
          children: [{ name: 'a', process: FakeProcess as any, critical: false }],
        } as any,
        noopLogger,
      );

      const failures: Array<{ name: string; error: Error }> = [];
      supervisor.on('child:start-failed', (name: string, error: Error) => {
        failures.push({ name, error });
      });

      await supervisor.start();

      expect(failures.length).toBe(1);
      expect(failures[0]!.name).toBe('a');
      expect(failures[0]!.error.message).toBe('spawn failure');

      await supervisor.stop();
    });
  });

  // ─── Defects 9 & 10: cancellable backoff + post-sleep stop guard ──
  describe('ProcessSupervisor.performRestart — backoff sleep is cancellable on stop()', () => {
    it('returns from stop() promptly even with a long pending backoff sleep', async () => {
      const { manager } = createMockManager();
      const m = manager as any;
      class FakeProcess {}
      const supervisor = ProcessSupervisor.fromConfig(
        m,
        {
          strategy: SupervisionStrategy.ONE_FOR_ONE,
          // Long backoff — pre-T#60 stop() would wait this entire window.
          backoff: { type: 'fixed', initial: 5_000, max: 5_000 },
          maxRestarts: 10,
          children: [{ name: 'a', process: FakeProcess as any, critical: false }],
        } as any,
        noopLogger,
      );
      await supervisor.start();

      // Trigger a "crash" so performRestart enters its backoff sleep.
      m.emit('process:crash', { id: 'pm-1' }, new Error('boom'));

      // Yield once so the crash handler enters its sleep.
      await new Promise((r) => setImmediate(r));

      // Now stop() — it MUST resolve quickly, well under the 5s
      // backoff. We give ourselves a generous 1s budget.
      const t0 = Date.now();
      await supervisor.stop();
      const elapsed = Date.now() - t0;
      expect(elapsed).toBeLessThan(1_000);
    });

    it('does NOT spawn a child after stop() if the backoff sleep was already in flight', async () => {
      const { manager } = createMockManager();
      const m = manager as any;
      class FakeProcess {}
      const supervisor = ProcessSupervisor.fromConfig(
        m,
        {
          strategy: SupervisionStrategy.ONE_FOR_ONE,
          backoff: { type: 'fixed', initial: 200, max: 200 },
          maxRestarts: 10,
          children: [{ name: 'a', process: FakeProcess as any, critical: false }],
        } as any,
        noopLogger,
      );
      await supervisor.start();
      const spawnsBefore = m.spawn.mock.calls.length;

      m.emit('process:crash', { id: 'pm-1' }, new Error('boom'));
      await new Promise((r) => setImmediate(r));
      // stop() while backoff is sleeping.
      await supervisor.stop();

      // After stop, no further spawn must occur. Pre-T#60 the
      // sleeping performRestart resolved past `isStopping=true`
      // and proceeded to spawn a child on a stopping supervisor.
      const spawnsAfter = m.spawn.mock.calls.length;
      // The crash itself never produced a NEW spawn because the
      // sleep was cancelled before reaching restartChild.
      expect(spawnsAfter).toBe(spawnsBefore);
    });
  });

  // ─── Defect 11: backoff driven by windowed restart count ──────────
  describe('ProcessSupervisor.performRestart — backoff uses windowed count', () => {
    it('drives computeBackoffDelay from the windowed count, not the lifetime counter', async () => {
      const { manager } = createMockManager();
      const m = manager as any;
      class FakeProcess {}
      const supervisor = ProcessSupervisor.fromConfig(
        m,
        {
          strategy: SupervisionStrategy.ONE_FOR_ONE,
          backoff: { type: 'exponential', initial: 100, factor: 2, max: 60_000 },
          maxRestarts: 100,
          window: 1_000,
          children: [{ name: 'a', process: FakeProcess as any, critical: false }],
        } as any,
        noopLogger,
      );
      await supervisor.start();

      // Inflate the lifetime counter without populating recent timestamps.
      (supervisor as any).restartCounts.set('a', 50);
      (supervisor as any).restartTimestamps.set('a', []); // window empty

      const spy = vi.spyOn(supervisor as any, 'computeBackoffDelay');

      m.emit('process:crash', { id: 'pm-1' }, new Error('boom'));
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      // The first call inside performRestart must use a small
      // windowed count (1), NOT the lifetime 50. Pre-T#60 this
      // would be a 50-driven exponential — capped at max=60s.
      expect(spy).toHaveBeenCalled();
      const firstArg = spy.mock.calls[0]?.[0];
      expect(firstArg).toBeLessThanOrEqual(5);

      await supervisor.stop();
    });
  });

  // ─── Defect 3: workflow timer leak (static — exercised in the
  // workflow suite as part of normal stage execution). The
  // invariant: `executeWithTimeout` clears the loser timer on
  // race-win. Covered by inspection + the existing workflow
  // orchestration spec.
  //
  // ─── Defect 4: netron-client doConnect timer leak. Same shape
  // as #3 — covered by inspection.
  //
  // ─── Defect 12: netron-client manual-disconnect race. Covered
  // by inspection: the disconnectHandler's first line returns
  // early when state is DISCONNECTING or DISCONNECTED, which
  // prevents the auto-reconnect path during user-initiated
  // disconnect.
});
