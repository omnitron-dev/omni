/**
 * A process is ours from the moment we fork it, not from the moment it is
 * ready.
 *
 * Every registry in this package — `workers`, `registry`, the supervisor's
 * `children` — is written when `spawner.spawn()` resolves, which is after the
 * child has finished starting. So anything that asks "is this pid ours?"
 * during a startup was told no.
 *
 * omnitron's orphan janitor is that caller. It sweeps `ps` for fork-workers
 * and kills any pid the orchestrator does not claim; its only protection for
 * a starting child was a 60-second age threshold, described in its own
 * docstring as a "safe envelope for slow init paths". On 2026-09-11, under a
 * load average of 88, main's http child needed 86-103 seconds just to import
 * its module graph. The janitor killed it on every attempt, the supervisor
 * restarted it, and the loop fed itself until the load came down.
 */
import { once } from 'node:events';
import { describe, it, expect } from 'vitest';

import { ProcessSpawner } from '../../src/process-spawner.js';

const noopLogger: any = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
  child: () => noopLogger,
};

describe('pids of forked children', () => {
  it('claims the child at fork, before it could possibly be ready', async () => {
    const spawner = new ProcessSpawner(noopLogger, {});
    expect([...spawner.getForkedPids()]).toEqual([]);

    // A context the child cannot boot from: the point is that the pid is
    // claimed at `fork()`, with no ready message ever arriving.
    const child = await (spawner as any).spawnChildProcess({ processId: 'p1', options: {} });

    expect(typeof child.pid).toBe('number');
    expect(
      spawner.getForkedPids().has(child.pid),
      'a child is ours from the fork, not from the ready message'
    ).toBe(true);

    child.kill('SIGKILL');
    await once(child, 'exit');
  });

  it('releases the pid when the child exits', async () => {
    // A set that only grows would make the janitor blind to a genuine
    // leftover once its pid was reused.
    const spawner = new ProcessSpawner(noopLogger, {});
    const child = await (spawner as any).spawnChildProcess({ processId: 'p2', options: {} });
    const pid = child.pid as number;
    expect(spawner.getForkedPids().has(pid)).toBe(true);

    child.kill('SIGKILL');
    await once(child, 'exit');

    expect(spawner.getForkedPids().has(pid)).toBe(false);
  });
});
