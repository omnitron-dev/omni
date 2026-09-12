/**
 * An operator turns the log level down and the request path stays loud.
 *
 * `worker-runtime` builds each child's pino with
 * `level: config.options?.logLevel || 'info'`, and NOTHING set that option —
 * the two reads were its only occurrences in this package. So a child logged
 * at info however the application was configured.
 *
 * Measured on a real stand: messaging with `logger.level: error`, restarted,
 * appended exactly 14 lines to its log. All info, all `module=netron`, all
 * from child processes (`processName: acme/dev/messaging/http`,
 * `…/automation-worker`) — and zero from the application itself, which honours
 * the level correctly. That matters because netron is the request path, and it
 * is the component that was logging a rejected sign-in's password until
 * 1ddde84: an operator who turns the level down does not quiet it.
 *
 * The parent knows its own level. A child now starts where the parent is,
 * unless told otherwise.
 */
import { describe, it, expect, vi } from 'vitest';

import { ProcessSupervisor } from '../../src/process-supervisor.js';

function loggerAt(level: string) {
  const log = {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(),
    getLevel: () => level,
    setLevel: vi.fn(),
    child: () => log,
  };
  return log as never;
}

/** A manager that records what it was asked to spawn. */
function recordingManager() {
  const spawned: any[] = [];
  const pooled: any[] = [];
  return {
    spawned,
    pooled,
    manager: {
      spawn: vi.fn(async (_cls: unknown, options: unknown) => {
        spawned.push(options);
        return {};
      }),
      pool: vi.fn(async (_cls: unknown, options: unknown) => {
        pooled.push(options);
        return {};
      }),
    } as never,
  };
}

class Dummy {}

/** Drive `startChild` directly — it is where the decision is made. */
async function startChild(level: string, childDef: Record<string, unknown>) {
  const rec = recordingManager();
  const supervisor = new ProcessSupervisor(rec.manager, class {} as never, {} as never, loggerAt(level));
  await (supervisor as unknown as { startChild: (n: string, d: unknown) => Promise<void> }).startChild(
    'child',
    childDef,
  );
  return rec;
}

describe('a child starts at the level its parent is at', () => {
  it('seeds a single process with the parent level', async () => {
    const rec = await startChild('error', { name: 'c', processClass: Dummy, options: { name: 'http' } });

    expect(rec.spawned).toHaveLength(1);
    expect(rec.spawned[0].logLevel, 'the child would log at info regardless').toBe('error');
    expect(rec.spawned[0].name, 'the rest of the options survive').toBe('http');
  });

  it('seeds a POOL through spawnOptions, which is what a worker reads', async () => {
    // `ProcessPool.spawnWorker` builds each worker from
    // `poolOptions.spawnOptions`; a level on the pool root is a field nothing
    // reads.
    const rec = await startChild('warn', {
      name: 'c',
      processClass: Dummy,
      pool: { size: 2, spawnOptions: { name: 'aggregator' } },
    });

    expect(rec.pooled).toHaveLength(1);
    expect(rec.pooled[0].spawnOptions.logLevel).toBe('warn');
    expect(rec.pooled[0].size, 'the pool options survive').toBe(2);
    expect(rec.pooled[0].logLevel, 'not on the root, where nothing would read it').toBeUndefined();
  });

  it('creates spawnOptions for a pool that had none', async () => {
    const rec = await startChild('debug', { name: 'c', processClass: Dummy, pool: { size: 1 } });
    expect(rec.pooled[0].spawnOptions.logLevel).toBe('debug');
  });

  it('does not override a level the caller chose', async () => {
    // One noisy child must still be turnable up on its own.
    const rec = await startChild('error', {
      name: 'c',
      processClass: Dummy,
      options: { name: 'http', logLevel: 'trace' },
    });

    expect(rec.spawned[0].logLevel).toBe('trace');
  });

  it('leaves the options alone when the parent cannot say', async () => {
    // An ILogger without `getLevel` — older implementations and test doubles.
    const rec = recordingManager();
    const bare = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
    const supervisor = new ProcessSupervisor(rec.manager, class {} as never, {} as never, bare);

    await (supervisor as unknown as { startChild: (n: string, d: unknown) => Promise<void> }).startChild('child', {
      name: 'c',
      processClass: Dummy,
      options: { name: 'http' },
    });

    expect(rec.spawned[0]).toEqual({ name: 'http' });
  });
});
