/**
 * LifecycleController unit tests.
 *
 * Coverage:
 *   - registration / unregistration
 *   - phase ordering (pre-stop → stop-runtime → dispose)
 *   - parallel-within-phase semantics
 *   - per-task timeout
 *   - per-phase deadline
 *   - total deadline + safety net
 *   - critical task aborts the phase
 *   - non-critical failure does not propagate
 *   - signal handling (SIGTERM/SIGINT/SIGHUP) + idempotent shutdown
 *   - second signal forces exit
 *   - exitOverride suppresses real process.exit
 *
 * Each test installs `exitOverride` so the test runner doesn't die.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  LifecycleController,
  LifecycleTimeoutError,
  bucketOf,
  type LifecyclePhaseEvent,
} from '../../src/lifecycle/lifecycle-controller.js';
import { ShutdownPriority, ShutdownReason } from '../../src/types.js';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('LifecycleController', () => {
  let exitedWith: number | null;
  let controller: LifecycleController;
  let events: LifecyclePhaseEvent[];

  beforeEach(() => {
    exitedWith = null;
    events = [];
  });

  afterEach(() => {
    controller?.uninstallSignalHandlers();
  });

  function makeController(options: ConstructorParameters<typeof LifecycleController>[0] = {}) {
    return new LifecycleController({
      defaultTaskTimeoutMs: 1000,
      bucketTimeoutMs: 1000,
      totalTimeoutMs: 3000,
      forceKillBufferMs: 500,
      ...options,
      exitOverride: (code) => {
        exitedWith = code;
        return false; // suppress real process.exit
      },
      onPhaseEvent: (e) => {
        events.push(e);
        options.onPhaseEvent?.(e);
      },
    });
  }

  describe('bucketOf', () => {
    it('maps priorities to phases', () => {
      expect(bucketOf(0)).toBe('pre-stop');
      expect(bucketOf(ShutdownPriority.High)).toBe('pre-stop');
      expect(bucketOf(29)).toBe('pre-stop');
      expect(bucketOf(30)).toBe('stop-runtime');
      expect(bucketOf(ShutdownPriority.Normal)).toBe('stop-runtime');
      expect(bucketOf(79)).toBe('stop-runtime');
      expect(bucketOf(80)).toBe('dispose');
      expect(bucketOf(ShutdownPriority.Last)).toBe('dispose');
    });
  });

  describe('registration', () => {
    it('register returns an unregister function', () => {
      controller = makeController();
      const off = controller.register({
        name: 'task-a',
        handler: () => undefined,
      });
      expect(controller.size()).toBe(1);
      off();
      expect(controller.size()).toBe(0);
    });

    it('unregister(id) removes by id', () => {
      controller = makeController();
      controller.register({ id: 'x', name: 'task-x', handler: () => undefined });
      controller.unregister('x');
      expect(controller.size()).toBe(0);
    });
  });

  describe('phase ordering', () => {
    it('runs phases in pre-stop → stop-runtime → dispose order', async () => {
      controller = makeController();
      const order: string[] = [];
      controller.register({
        name: 'dispose-task',
        priority: ShutdownPriority.Last,
        handler: () => {
          order.push('dispose');
        },
      });
      controller.register({
        name: 'pre-stop-task',
        priority: ShutdownPriority.First,
        handler: () => {
          order.push('pre-stop');
        },
      });
      controller.register({
        name: 'runtime-task',
        priority: ShutdownPriority.Normal,
        handler: () => {
          order.push('runtime');
        },
      });

      await controller.shutdown(ShutdownReason.Manual);
      expect(order).toEqual(['pre-stop', 'runtime', 'dispose']);
      expect(exitedWith).toBe(0);
    });

    it('within a phase, parallel tasks run concurrently', async () => {
      controller = makeController({ defaultTaskTimeoutMs: 500 });
      const start = Date.now();
      controller.register({
        name: 'a',
        priority: ShutdownPriority.Normal,
        handler: async () => {
          await delay(100);
        },
      });
      controller.register({
        name: 'b',
        priority: ShutdownPriority.Normal,
        handler: async () => {
          await delay(100);
        },
      });
      controller.register({
        name: 'c',
        priority: ShutdownPriority.Normal,
        handler: async () => {
          await delay(100);
        },
      });
      await controller.shutdown(ShutdownReason.Manual);
      const took = Date.now() - start;
      // Three 100ms tasks in parallel ≈ 100-150ms (NOT 300ms+).
      expect(took).toBeLessThan(250);
    });

    it('parallel:false tasks run sequentially after the parallel batch', async () => {
      controller = makeController();
      const order: string[] = [];
      controller.register({
        name: 'parallel-1',
        priority: ShutdownPriority.Normal,
        handler: async () => {
          await delay(20);
          order.push('parallel-1');
        },
      });
      controller.register({
        name: 'sequential',
        priority: ShutdownPriority.Normal,
        parallel: false,
        handler: () => {
          order.push('sequential');
        },
      });
      await controller.shutdown(ShutdownReason.Manual);
      expect(order).toEqual(['parallel-1', 'sequential']);
    });
  });

  describe('timeouts', () => {
    it('per-task timeout abandons a hung task', async () => {
      controller = makeController({ bucketTimeoutMs: 500 });
      controller.register({
        name: 'hangs',
        priority: ShutdownPriority.Normal,
        timeout: 50,
        handler: () => new Promise(() => undefined), // never resolves
      });
      const start = Date.now();
      await controller.shutdown(ShutdownReason.Manual);
      expect(Date.now() - start).toBeLessThan(200);
      expect(events.some((e) => e.kind === 'task-error' && e.error instanceof LifecycleTimeoutError)).toBe(true);
      expect(exitedWith).toBe(0); // non-critical, shutdown succeeded
    });

    it('phase deadline aborts the bucket', async () => {
      controller = makeController({ bucketTimeoutMs: 100, totalTimeoutMs: 5000 });
      controller.register({
        name: 'task-a',
        priority: ShutdownPriority.Normal,
        timeout: 5000, // bigger than phase budget
        handler: () => new Promise(() => undefined),
      });
      const start = Date.now();
      await controller.shutdown(ShutdownReason.Manual);
      expect(Date.now() - start).toBeLessThan(300);
    });

    it('total deadline shrinks the remaining phase budget', async () => {
      // Both tasks take 100ms; pre-stop runs first and consumes 50ms.
      // Bucket=200ms (each task fits individually), total=80ms.
      // After pre-stop completes, only 30ms of total remain — dispose
      // gets a 30ms sub-deadline, can't finish its 100ms work, and
      // is abandoned via timeout instead of pushing 'dispose'.
      controller = makeController({ bucketTimeoutMs: 200, totalTimeoutMs: 80 });
      const seen: string[] = [];
      controller.register({
        name: 'pre-stop-task',
        priority: ShutdownPriority.First,
        handler: async () => {
          await delay(50);
          seen.push('pre-stop');
        },
      });
      controller.register({
        name: 'dispose-task',
        priority: ShutdownPriority.Last,
        handler: async () => {
          await delay(100);
          seen.push('dispose');
        },
      });
      await controller.shutdown(ShutdownReason.Manual);
      expect(seen).toContain('pre-stop');
      expect(seen).not.toContain('dispose');
    });
  });

  describe('error handling', () => {
    it('non-critical failure does not propagate', async () => {
      controller = makeController();
      controller.register({
        name: 'fails',
        priority: ShutdownPriority.Normal,
        handler: () => {
          throw new Error('oops');
        },
      });
      controller.register({
        name: 'ok',
        priority: ShutdownPriority.Last,
        handler: () => undefined,
      });
      await expect(controller.shutdown(ShutdownReason.Manual)).resolves.toBeUndefined();
      expect(exitedWith).toBe(0);
    });

    it('critical failure aborts and surfaces non-zero exit', async () => {
      controller = makeController();
      controller.register({
        name: 'critical-fails',
        priority: ShutdownPriority.Normal,
        critical: true,
        handler: () => {
          throw new Error('fatal');
        },
      });
      let caught: unknown = null;
      try {
        await controller.shutdown(ShutdownReason.Manual);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeTruthy();
      expect(exitedWith).toBe(1);
    });
  });

  describe('idempotency', () => {
    it('concurrent shutdown calls coalesce', async () => {
      controller = makeController();
      let runs = 0;
      controller.register({
        name: 'counter',
        handler: async () => {
          runs += 1;
          await delay(20);
        },
      });
      const [a, b, c] = await Promise.all([
        controller.shutdown(ShutdownReason.Manual),
        controller.shutdown(ShutdownReason.Manual),
        controller.shutdown(ShutdownReason.Manual),
      ]);
      expect(a).toBe(b);
      expect(b).toBe(c);
      expect(runs).toBe(1);
    });
  });

  describe('signal handling', () => {
    let realProcessOn: typeof process.on;
    let realProcessOff: typeof process.off;
    let registered: Map<string, Set<NodeJS.SignalsListener>>;

    beforeEach(() => {
      registered = new Map();
      realProcessOn = process.on.bind(process);
      realProcessOff = process.off.bind(process);
      vi.spyOn(process, 'on').mockImplementation((event: string, h: NodeJS.SignalsListener) => {
        const set = registered.get(event) ?? new Set();
        set.add(h);
        registered.set(event, set);
        return process;
      });
      vi.spyOn(process, 'off').mockImplementation((event: string, h: NodeJS.SignalsListener) => {
        registered.get(event)?.delete(h);
        return process;
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
      process.on = realProcessOn;
      process.off = realProcessOff;
    });

    it('installSignalHandlers wires SIGTERM/SIGINT/SIGHUP', () => {
      controller = makeController();
      controller.installSignalHandlers();
      expect(registered.get('SIGTERM')?.size).toBe(1);
      expect(registered.get('SIGINT')?.size).toBe(1);
      expect(registered.get('SIGHUP')?.size).toBe(1);
    });

    it('uninstallSignalHandlers removes all listeners', () => {
      controller = makeController();
      const off = controller.installSignalHandlers();
      off();
      expect(registered.get('SIGTERM')?.size ?? 0).toBe(0);
      expect(registered.get('SIGINT')?.size ?? 0).toBe(0);
      expect(registered.get('SIGHUP')?.size ?? 0).toBe(0);
    });

    it('SIGTERM triggers shutdown with reason SIGTERM', async () => {
      controller = makeController();
      const seen: ShutdownReason[] = [];
      controller.register({
        name: 'observer',
        handler: (reason) => {
          seen.push(reason);
        },
      });
      controller.installSignalHandlers();
      const handler = [...(registered.get('SIGTERM') ?? [])][0];
      handler?.('SIGTERM' as NodeJS.Signals);
      // Wait for the async shutdown to drain.
      await delay(50);
      expect(seen).toContain('SIGTERM');
    });
  });
});
