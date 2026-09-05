/**
 * `stop()` issued while `start()` is still in flight must actually stop.
 *
 * T#59 fixed the concurrent-START half of this: two `start()` calls used to
 * both pass an `isStarted` guard that was only set at the END of the children
 * loop, so every child got spawned twice. The fix tracked the in-flight
 * promise — for `start()`.
 *
 * `stop()` kept the original shape: `if (!this.isStarted) return`, against a
 * flag `doStart()` still assigns only after its last child has spawned. So a
 * shutdown arriving during startup — a SIGTERM while booting — read `false`,
 * concluded there was nothing to stop and returned. The children already
 * spawned kept running, the remaining ones went on spawning, the crash handler
 * stayed registered on the manager, and the caller held a resolved promise
 * telling it the supervisor was down.
 */
import { describe, it, expect, vi } from 'vitest';

import { ProcessSupervisor } from '../src/process-supervisor.js';
import { SupervisionStrategy } from '../src/types.js';
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

function createMockManager(spawnGate?: Promise<void>) {
  const listeners = new Map<string, Array<(...args: any[]) => void>>();
  let nextId = 1;

  const manager: any = {
    on(event: string, fn: any) {
      const list = listeners.get(event) ?? [];
      list.push(fn);
      listeners.set(event, list);
    },
    off: vi.fn((event: string, fn: any) => {
      const list = listeners.get(event);
      if (!list) return;
      listeners.set(
        event,
        list.filter((l) => l !== fn)
      );
    }),
    emit(event: string, ...args: any[]) {
      for (const fn of [...(listeners.get(event) ?? [])]) fn(...args);
    },
    spawn: vi.fn(async (cls: any) => {
      if (spawnGate) await spawnGate;
      return { __processId: `pm-${nextId++}`, __cls: cls?.name ?? cls };
    }),
    kill: vi.fn(async () => true),
    pool: vi.fn(),
    getMetrics: vi.fn(async () => null),
    getHealth: vi.fn(async () => null),
    getWorkerHandle: vi.fn((id: string) => ({ id, send: vi.fn() })),
  };

  return manager as IProcessManager;
}

class FakeProcess {}

describe('ProcessSupervisor — stop() during an in-flight start()', () => {
  it('tears the children down instead of resolving as a no-op', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const manager = createMockManager(gate);
    const m = manager as any;

    const supervisor = ProcessSupervisor.fromConfig(
      manager,
      {
        strategy: SupervisionStrategy.ONE_FOR_ONE,
        children: [
          { name: 'a', process: FakeProcess as any },
          { name: 'b', process: FakeProcess as any },
        ],
      } as any,
      noopLogger
    );

    const starting = supervisor.start();
    const stopping = supervisor.stop();
    release();
    await Promise.all([starting, stopping]);

    // Every child that was spawned must have been killed.
    expect(m.spawn).toHaveBeenCalledTimes(2);
    expect(m.kill).toHaveBeenCalledTimes(2);

    // And the crash handler must be off the manager, or a child dying after
    // shutdown would still be restarted by a supervisor nobody is running.
    expect(m.off).toHaveBeenCalledWith('process:crash', expect.any(Function));
  });

  it('leaves a never-started supervisor alone', async () => {
    const manager = createMockManager();
    const m = manager as any;
    const supervisor = ProcessSupervisor.fromConfig(
      manager,
      { strategy: SupervisionStrategy.ONE_FOR_ONE, children: [] } as any,
      noopLogger
    );

    await supervisor.stop();

    expect(m.kill).not.toHaveBeenCalled();
  });
});
