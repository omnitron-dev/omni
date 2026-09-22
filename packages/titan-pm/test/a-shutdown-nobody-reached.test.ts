/**
 * The first listener exited, so the shutdown hooks never ran.
 *
 * `fork-worker.ts` installs its last-resort handlers at module scope, line
 * 149, and imports `worker-runtime.js` at line 195. The two owners of
 * shutdown are built during that import:
 *
 *   titan/application/_internal/process-host.ts:129 — Application's handler,
 *       which calls `onFatalException` and shuts the application down.
 *   titan/lifecycle/lifecycle-controller.ts:293 — the controller
 *       `worker-runtime.ts:696` wires, carrying `service-wrapper-shutdown`
 *       at priority 90, i.e. `serviceWrapper.__shutdown()`.
 *
 * Node calls `uncaughtException` listeners in registration order and stops at
 * the first `process.exit()`. The last-resort handler was first, and for a
 * programming error it exited synchronously — so on every such error the
 * worker died with its connections unclosed and its buffers unflushed, and
 * the two handlers written to prevent exactly that never ran.
 *
 * Every process on the dev stand is a fork: the daemon runs under
 * `--import tsx/esm` and passes `execArgv` down, and `process-spawner.ts:950`
 * requires an empty `execArgv` for worker threads, so all 14 kinds of process
 * took the child-process branch. Checked, not assumed — ohlcv-aggregator
 * pid 1149 and transform pid 2134 both run `dist/fork-worker.js` with the
 * daemon as their parent.
 *
 * The arrangement was even described in a warning, 322 times, always with the
 * same pair `(uncaughtCount 2, rejectionCount 2)`: «existing process
 * error-handlers detected — verify Application+LifecycleController are not
 * BOTH installed». That warning cannot not fire — `Application` always
 * installs through `ProcessHost`, and `worker-runtime` always calls
 * `installSignalHandlers` — so it read as noise about configuration rather
 * than as a defect.
 */

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('./fixtures/a-shutdown-owner-after-the-last-resort.ts', import.meta.url));

interface Run {
  stdout: string;
  stderr: string;
  code: number | null;
}

/** Run the fixture in a real process — the ordering under test is Node's. */
function run(mode: string): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx/esm', FIXTURE, mode], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += String(b)));
    child.stderr.on('data', (b) => (stderr += String(b)));
    child.on('close', (code) => resolve({ stdout, stderr, code }));
  });
}

describe('a shutdown nobody reached', () => {
  it('a programming error still reaches the handlers that close things down', async () => {
    const { stdout, stderr } = await run('programming-error');

    expect(stdout, 'the application was never told to shut down').toContain('application-shutdown');
    expect(stdout, "the service's own __shutdown never ran").toContain('service-shutdown');
    // The fatal line is still written: yielding is not going quiet.
    expect(stderr).toMatch(/Uncaught exception in fork-worker/);
  }, 30_000);

  it('an operational error leaves the process running, as it always did', async () => {
    // Control: a database blip must not end the worker — its clients
    // reconnect. This is the branch that must not change.
    const { stdout, code } = await run('operational-error');

    expect(stdout).toContain('still-running');
    expect(code, 'the worker finished on its own terms').toBe(0);
  }, 30_000);

  it('an owner that never finishes does not keep the process alive', async () => {
    // Control the other way: yielding must not become hanging. When nothing
    // completes the shutdown, the window is enforced.
    const { stdout, stderr, code } = await run('owner-hangs');

    expect(stdout).toContain('owner-started');
    expect(stderr).toMatch(/No shutdown owner finished/);
    expect(code).toBe(1);
  }, 30_000);
});
