/**
 * A startup timeout must say whose deadline was missed.
 *
 * `Worker startup (pid: 45138) timed out after 180000ms` names the child, and
 * every reader believes it. On 2026-09-14 that sentence appeared six times in
 * a row for `daos/dev/main` and sent an evening into the application: its
 * module graph, its boot migrations, its DI container, the last commits
 * touching it. The same build, started beside the supervisor with the same
 * environment, came up in 3.3 seconds — Postgres connected, Redis connected,
 * 24 scheduler jobs started.
 *
 * The host had 14 MB of free memory and 12.76 GB of a 14 GB swap file in use.
 * The supervisor, idle most of the time and therefore first to be evicted,
 * was spending minutes paging its own heap back in: 0.3 % CPU while
 * `runnable`, 34 unreaped children, 430 consecutive failures to get its own
 * `ps` back within ten seconds. It never read the child's output and never
 * processed the ready message.
 *
 * The proof was in the crash record and unreadable as such: `stderrBytes: 136,
 * stdoutBytes: 0` after 180 seconds, from an app that writes kilobytes before
 * it has finished building its container. A supervisor that read nothing in
 * three minutes was not observing a stuck child.
 *
 * Nothing a child does can delay OUR timers. So a one-second interval that
 * arrives seconds late is a measurement of this side of the boundary, and
 * when it does, the message must say so instead of naming the child.
 *
 * The control matters as much as the finding: an ordinary timeout — a child
 * that genuinely hangs while the supervisor runs normally — must NOT carry
 * the note, or it becomes a sentence that is always true and therefore says
 * nothing.
 */

import 'reflect-metadata';
import { describe, it, expect, afterAll } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ProcessSpawner } from '../../src/process-spawner.js';

const silent = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child() {
    return this;
  },
};

const TMP = mkdtempSync(join(tmpdir(), 'supervisor-lag-'));
const children: ChildProcess[] = [];

/** A child that says one thing and then never reports ready. */
function forkSilentChild(): ChildProcess {
  const file = join(TMP, `quiet-${Math.random().toString(36).slice(2)}.js`);
  writeFileSync(
    file,
    `process.stderr.write('[boot] config:loading /app/.omnitron-build/bootstrap.js\\n');
     setInterval(() => {}, 1000);`
  );
  const child = fork(file, [], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
  children.push(child);
  return child;
}

const waitForReady = (child: ChildProcess, timeout: number): Promise<unknown> =>
  (
    new ProcessSpawner(silent as never) as unknown as {
      waitForReady: (w: ChildProcess, isThread: boolean, t: number) => Promise<unknown>;
    }
  ).waitForReady(child, false, timeout);

/** Hold the event loop the way memory pressure does — without yielding. */
function stallEventLoop(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    /* deliberately spinning: the point is that no timer can run */
  }
}

afterAll(() => {
  for (const c of children) c.kill('SIGKILL');
  rmSync(TMP, { recursive: true, force: true });
});

describe('a startup timeout taken while the supervisor itself was not running', () => {
  it('says the deadline was missed on our side, and by how much', async () => {
    const child = forkSilentChild();
    const pending = waitForReady(child, 6_000);

    // Armed inside waitForReady, which ran synchronously above — so the probe
    // is already scheduled and this stall is exactly what it measures.
    stallEventLoop(3_500);

    const err = await pending.then(
      () => null,
      (e: Error & { details?: Record<string, unknown> }) => e,
    );

    expect(err, 'the wait must reject, not resolve').not.toBeNull();
    expect(err!.message).toContain("this timeout is ours, not the child's");
    expect(err!.message).toMatch(/timer ran \d+s late/);
    expect(err!.details?.['supervisorMaxLagMs']).toBeGreaterThanOrEqual(2_000);

    // The child's own trail still rides along: the note reframes it, it does
    // not replace it.
    expect(err!.message).toContain('config:loading');
  }, 20_000);

  it('stays silent about the supervisor when the supervisor was running fine', async () => {
    const child = forkSilentChild();

    const err = await waitForReady(child, 2_500).then(
      () => null,
      (e: Error & { details?: Record<string, unknown> }) => e,
    );

    expect(err, 'the wait must reject, not resolve').not.toBeNull();
    expect(err!.message).not.toContain('this timeout is ours');
    // Reported on every startup timeout, not only the ones over the
    // threshold: a number always present is one an operator can compare, and
    // a small one rules this side out and leaves the child.
    expect(err!.details?.['supervisorMaxLagMs']).toBeTypeOf('number');
    expect(err!.details?.['supervisorMaxLagMs']).toBeLessThan(2_000);
  }, 20_000);
});
