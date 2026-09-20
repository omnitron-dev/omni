/**
 * The daemon and the operator started the same stack at the same time.
 *
 * `startStack` short-circuits on `stackStates`, and that state is written
 * well after the config is loaded and the short-circuits have run. Two
 * callers arriving together both see no state and both proceed.
 *
 * Measured on the test stack: the daemon's own `startProjectStacks` on boot
 * and an operator's `omnitron stack start daos test` landed twenty seconds
 * apart, and the whole remote deployment ran TWICE, concurrently — two
 * artifact builds, two transfers, two registrations.
 *
 * Wasteful, and worse than wasteful. The artifact build rebuilds shared
 * packages whose `build` script is `rm -rf dist && tsc`, so one pass emptied
 * `@omnitron-dev/titan-database/dist` while the other compiled `@daos/main`
 * against it:
 *
 *     src/modules/rbac/rls-schema.ts(53,41): error TS2307: Cannot find
 *     module '@omnitron-dev/titan-database/rls'
 *
 * That subpath exists. `dist/exports/rls.js` was on disk before and after.
 * The error names a package that is fine, against a build that is correct,
 * and sends the reader to look at exports — building the same app by hand a
 * minute later exits zero. A race reported as a type error.
 *
 * These pin the joining behaviour on the pure part: the in-flight map.
 */

import { describe, it, expect, vi } from 'vitest';

/**
 * The guard as `startStack` implements it, isolated.
 *
 * Extracted here rather than driving `ProjectService`, which needs a
 * registry, an orchestrator, a deployer and a daemon socket to reach the
 * line under test. The shape is what matters and the shape is three lines.
 */
function joiningStarter<T>(run: (key: string) => Promise<T>) {
  const inFlight = new Map<string, Promise<T>>();
  return (key: string): Promise<T> => {
    const running = inFlight.get(key);
    if (running) return running;
    const started = run(key).finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, started);
    return started;
  };
}

describe('a second caller joins the first run', () => {
  it('runs the work once for two simultaneous callers', async () => {
    const work = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return 'done';
    });
    const start = joiningStarter(work);

    const [a, b] = await Promise.all([start('daos/test'), start('daos/test')]);

    expect(work).toHaveBeenCalledTimes(1);
    expect(a).toBe('done');
    expect(b).toBe('done');
  });

  it('gives the second caller the answer, not a refusal', async () => {
    // Asking for a stack that is already being started should END when it has
    // been started — that is what the caller meant. Throwing "already
    // starting" would make the console's button a coin toss.
    const start = joiningStarter(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { apps: 6 };
    });

    const second = start('daos/test');
    await expect(start('daos/test')).resolves.toEqual({ apps: 6 });
    await second;
  });

  it('keeps different stacks apart', async () => {
    const work = vi.fn(async (key: string) => {
      await new Promise((r) => setTimeout(r, 5));
      return key;
    });
    const start = joiningStarter(work);

    const [a, b] = await Promise.all([start('daos/test'), start('daos/dev')]);

    expect(work).toHaveBeenCalledTimes(2);
    expect([a, b]).toEqual(['daos/test', 'daos/dev']);
  });

  it('lets the next start run after the first finishes', async () => {
    // The guard is about CONCURRENCY, not about starting once ever. A stack
    // that was started, stopped and started again must run each time.
    const work = vi.fn(async () => 'done');
    const start = joiningStarter(work);

    await start('daos/test');
    await start('daos/test');

    expect(work).toHaveBeenCalledTimes(2);
  });

  it('releases the key when the run fails, and hands the failure to both', async () => {
    // `finally`, not `then`: a failed start that left its key behind would
    // make every later attempt return the same rejected promise, and the
    // stack could never be started again without restarting the daemon.
    const work = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      throw new Error('node unreachable');
    });
    const start = joiningStarter(work);

    const first = start('daos/test');
    const second = start('daos/test');
    await expect(first).rejects.toThrow('node unreachable');
    await expect(second).rejects.toThrow('node unreachable');
    expect(work).toHaveBeenCalledTimes(1);

    work.mockImplementation(async () => {
      throw new Error('still unreachable');
    });
    await expect(start('daos/test')).rejects.toThrow('still unreachable');
    expect(work).toHaveBeenCalledTimes(2);
  });
});

describe('the source keeps the guard', () => {
  it('joins rather than starting a second run', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, '../../src/services/project.service.ts'), 'utf8');

    expect(src).toContain('startsInFlight');
    // `finally`, for the reason the test above measures.
    expect(src).toMatch(/startsInFlight\.delete/);
    expect(src).toMatch(/\.finally\(/);
    // The work itself moved behind the guard; the public method must not be
    // the one doing it, or a second caller would still reach it.
    expect(src).toContain('private async startStackOnce(');
  });
});
