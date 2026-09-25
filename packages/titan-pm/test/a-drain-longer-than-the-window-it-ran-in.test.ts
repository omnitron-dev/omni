/**
 * A drain longer than the window it ran in.
 *
 * titan's Application now waits, when it stops, for the inbound calls it is
 * still running, so that none of them is torn down half-done: by default 10 s,
 * or half of the stop's `timeout`. A child is killed long before that: 3500 ms
 * after SIGTERM by default. `service-wrapper-shutdown`, the task inside which
 * its application stops, has 2800 ms of those. With titan's default, one call
 * that hung would have held the stop past SIGKILL. `@PreDestroy`, which closes
 * the database, would not have run at all. The hung call would have cost the
 * whole teardown instead of only itself.
 *
 * The deadline belongs to whoever holds SIGKILL. The spawner hands each child
 * its share in `TITAN_DRAIN_TIMEOUT_MS`, beside the window and from the same
 * number, and every Application in the process reads it, whichever copy of
 * titan created it. The environment carries it because the entry points of a
 * child (omnitron's `bootstrap-process` among them) may not import this
 * package. What is pinned:
 *   - the drain takes half of what the task has, and the teardown keeps the
 *     other half, for every window;
 *   - a brutal kill (window 0) waits for nothing;
 *   - the spawner writes it per child, over what the child inherited: `TITAN_*`
 *     passes from parent to child, and a worker an app spawns would otherwise
 *     carry the app's share into a window of its own. An app's own env may
 *     state it;
 *   - the runtime writes it before it imports the process module when nothing
 *     did, for a child something else started;
 *   - the writers and titan's reader name the same variable. Nothing else
 *     compares them.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { childDrainMs, lifecycleWindows, DEFAULT_FORCE_EXIT_MS } from '../src/shutdown-windows.js';

describe('a drain longer than the window it ran in', () => {
  it('takes half of what the stopping task has — 1400 of 2800 ms in the default window', () => {
    expect(DEFAULT_FORCE_EXIT_MS).toBe(3500);
    expect(lifecycleWindows(3500).defaultTaskTimeoutMs).toBe(2800);
    expect(childDrainMs(DEFAULT_FORCE_EXIT_MS)).toBe(1400);
  });

  it('leaves the teardown at least as much as the drain, in every window', () => {
    for (const window of [200, 1000, 3500, 7000, 21_000, 60_000]) {
      const task = lifecycleWindows(window).defaultTaskTimeoutMs;
      const drain = childDrainMs(window);
      expect(drain, `window ${window}`).toBeGreaterThan(0);
      expect(task - drain, `window ${window}`).toBeGreaterThanOrEqual(drain);
      expect(drain, `window ${window}`).toBeLessThan(window);
    }
  });

  it('waits for nothing when the child was given no window', () => {
    expect(childDrainMs(0)).toBe(0);
  });

  describe('on its way to the application', () => {
    const spawner = readFileSync(join(__dirname, '../src/process-spawner.ts'), 'utf8');
    const runtime = readFileSync(join(__dirname, '../src/worker-runtime.ts'), 'utf8');
    const titan = readFileSync(join(__dirname, '../../titan/src/application/application.ts'), 'utf8');

    it('is written by the spawner per child, from the window it tells that child, over what it inherited', () => {
      const env = spawner.slice(spawner.indexOf('const child = fork(this.forkWorkerPath'));
      const inherited = env.indexOf('...childEnv(');
      const window = env.indexOf('TITAN_SHUTDOWN_TIMEOUT_MS: String(windowMs)');
      const drain = env.search(
        /TITAN_DRAIN_TIMEOUT_MS: context\.options\?\.env\?\.\['TITAN_DRAIN_TIMEOUT_MS'\] \|\| String\(childDrainMs\(windowMs\)\)/,
      );
      expect(inherited, 'the child env is not built from childEnv').toBeGreaterThan(-1);
      expect(window, 'the window is not written from windowMs').toBeGreaterThan(inherited);
      expect(drain, 'the share is not written from the same window, after the inherited env').toBeGreaterThan(inherited);
    });

    it('is written by the runtime before the process module is imported when nothing did', () => {
      const body = runtime.slice(runtime.indexOf('async function initialize()'));
      const guard = body.indexOf("if (!process.env['TITAN_DRAIN_TIMEOUT_MS'])");
      const write = body.indexOf(
        "process.env['TITAN_DRAIN_TIMEOUT_MS'] = String(childDrainMs(childShutdownWindowMs(process.env)));",
      );
      const load = body.indexOf('await import(config.processPath)');
      expect(guard, 'no guard for a stated value').toBeGreaterThan(-1);
      expect(write, 'the runtime does not write it').toBeGreaterThan(guard);
      expect(load, 'the process module import moved').toBeGreaterThan(write);
    });

    it('is read by titan under the name the spawner and the runtime write', () => {
      expect(titan).toContain("process.env['TITAN_DRAIN_TIMEOUT_MS']");
      expect(titan).toMatch(/options\.drainTimeout \?\? drainFromEnvironment\(\)/);
    });
  });
});
