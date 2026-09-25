/**
 * The boundary itself: a child inside its window exits, a child past it is
 * killed — and the kill still happens on time.
 *
 * `a-deadline-neither-side-agreed-on` pins the arithmetic. This pins the
 * behaviour, because agreeing two numbers is exactly the change that can
 * quietly turn «kill the hung one» into «wait for ever», and that is worse
 * than the defect it replaces: 4% of stops being killed is visible, a stack
 * that never finishes stopping looks like a slow deploy and nothing else.
 * Both conditions asked for by omni-03 reviewing the fix.
 *
 * The margins are deliberately narrow on the same side as the measurement
 * that started this — `priceverse/stream-aggregator` missed by 0.4 s inside
 * a window it thought was five seconds and was two.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { WorkerHandle } from '../src/process-spawner.js';
import { shutdownLadder } from '../src/shutdown-windows.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/a-child-that-takes-its-time.cjs', import.meta.url));

const alive: ChildProcess[] = [];
afterEach(() => {
  for (const c of alive.splice(0)) {
    try {
      if (c.pid) process.kill(c.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
});

interface Stopped {
  signal: NodeJS.Signals | null;
  code: number | null;
  elapsedMs: number;
  toldWindowMs: string | null;
}

/**
 * Start the fixture, stop it through the real ladder, and report how it
 * ended. The handle is built over the prototype because a full spawn would
 * need a Netron client the boundary has nothing to do with.
 */
async function stopAfter(shutdownMs: number, budgetMs: number): Promise<Stopped> {
  const ladder = shutdownLadder(budgetMs);
  const child = fork(FIXTURE, [String(shutdownMs)], {
    stdio: 'ignore',
    env: { ...process.env, TITAN_SHUTDOWN_TIMEOUT_MS: String(ladder.childWindowMs) },
  });
  alive.push(child);

  const toldWindowMs = await new Promise<string | null>((resolve) => {
    child.once('message', (m) => resolve((m as { toldWindowMs: string | null }).toldWindowMs));
  });

  const ended = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });

  const handle: any = Object.create(WorkerHandle.prototype);
  Object.assign(handle, {
    id: 'w-boundary',
    serviceName: 'fixture',
    logger: { info() {}, warn() {}, error() {}, debug() {}, trace() {} },
    exitEmitted: true, // the ladder is under test, not the exit accounting
  });
  handle.emit = () => true;

  const started = Date.now();
  await handle.terminateChildProcess(child, budgetMs).catch(() => undefined);
  const { code, signal } = await ended;

  return { signal, code, elapsedMs: Date.now() - started, toldWindowMs };
}

describe('a window a child can finish in', () => {
  it('the spawner puts the window into the child environment', () => {
    // This is the half the fixture cannot prove: `stopAfter` sets the
    // variable itself, so it shows the child READS it. What has to hold is
    // that the SPAWNER writes it — the defect was precisely that two places
    // read `TITAN_SHUTDOWN_TIMEOUT_MS` and nothing set it. Read from the
    // source, because a full spawn needs a Netron client this has nothing to
    // do with.
    const spawner = readFileSync(
      fileURLToPath(new URL('../src/process-spawner.ts', import.meta.url)),
      'utf8',
    );

    expect(spawner, 'the variable is never written to the child env').toMatch(
      /TITAN_SHUTDOWN_TIMEOUT_MS:\s*String\(/,
    );
    expect(spawner, 'and the value must come from the same split the ladder walks').toMatch(
      /const windowMs = shutdownLadder\([^;]{0,120}\)\.childWindowMs;[\s\S]{0,1500}TITAN_SHUTDOWN_TIMEOUT_MS:\s*String\(windowMs\)/,
    );
  });

  it('a child that is handed the window reads it back', async () => {
    const budget = 1_000;
    const { toldWindowMs } = await stopAfter(10, budget);

    expect(toldWindowMs).toBe(String(shutdownLadder(budget).childWindowMs));
  }, 20_000);

  it('a child that finishes inside its window exits on its own', async () => {
    // Budget 1000 → the child gets 400 ms after SIGTERM. Finishing in 120
    // leaves the same kind of margin the stand's worker never got.
    const { signal, code } = await stopAfter(120, 1_000);

    expect(signal, 'it was killed despite finishing in time').toBeNull();
    expect(code).toBe(0);
  }, 20_000);

  it('a child that truly hangs is still killed, and on schedule', async () => {
    // Control the other way: agreeing the windows must not turn a hung child
    // into an unbounded wait.
    const budget = 1_000;
    const { signal, elapsedMs } = await stopAfter(60_000, budget);

    expect(signal, 'a hung child must not survive the stop').toBe('SIGKILL');
    // SIGKILL lands at graceful + sigterm; the final wait is for observing
    // the exit. Generous upper bound — the point is that it is bounded.
    expect(elapsedMs, `killed too late: ${elapsedMs}ms`).toBeLessThan(budget * 3);
  }, 20_000);

  it('a brutal stop does not wait for the child at all', async () => {
    // Control: `shutdownTimeout: 0` means now. It must stay that way.
    const { signal, elapsedMs } = await stopAfter(60_000, 0);

    expect(signal).toBe('SIGKILL');
    expect(elapsedMs, `a brutal kill took ${elapsedMs}ms`).toBeLessThan(2_000);
  }, 20_000);
});
