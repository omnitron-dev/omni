/**
 * A worker killed during startup must say what killed it.
 *
 * Node's 'exit' event reports `(code, signal)` and fills exactly one of them.
 * `waitForReady`'s exit handler was declared `(code: number | null)`, so a
 * process killed by a signal — which always arrives with `code === null` —
 * reported "Worker exited during startup with code null", and the signal, the
 * only fact that explains the exit, was dropped on the floor.
 *
 * That message cost two sessions a real investigation today: `daos/dev/paysys`
 * failed to start with exactly it, and both readers built theories (a bad code
 * change; memory pressure) because the message describes the shape of the
 * event while withholding its cause. A signal means the process did not choose
 * to exit and left no message of its own, so reading the application — where
 * "code null" sends you — cannot work.
 *
 * These drive a REAL forked process and a REAL kill. A fake emitter would only
 * prove that the fake was told to emit `(code, signal)`, which is the property
 * under test.
 */

import { describe, it, expect, afterEach, afterAll } from 'vitest';
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

const TMP = mkdtempSync(join(tmpdir(), 'exit-signal-'));

/** A child that starts, never reports ready, and waits to be dealt with. */
function forkSilentChild(body: string): ChildProcess {
  const file = join(TMP, `child-${Math.random().toString(36).slice(2)}.js`);
  writeFileSync(file, body);
  return fork(file, [], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
}

/** `waitForReady` is private; the seam under test is its exit handling. */
const waitForReady = (child: ChildProcess, timeout = 15_000): Promise<unknown> =>
  (
    new ProcessSpawner(silent as never) as unknown as {
      waitForReady: (w: ChildProcess, isThread: boolean, t: number) => Promise<unknown>;
    }
  ).waitForReady(child, false, timeout);

describe('a worker that exits during startup', () => {
  let child: ChildProcess | undefined;

  afterEach(() => {
    if (child && !child.killed) child.kill('SIGKILL');
    child = undefined;
  });

  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it('names the signal that killed it', async () => {
    child = forkSilentChild('setInterval(() => {}, 1000);');
    const waiting = waitForReady(child);

    // A real kill, not a synthesised event. SIGKILL is what the OOM killer and
    // jetsam use, and the case that started this.
    setTimeout(() => child!.kill('SIGKILL'), 100);

    await expect(waiting).rejects.toThrow(/SIGKILL/);
  }, 30_000);

  it('does not report a killed process as having an exit code', async () => {
    child = forkSilentChild('setInterval(() => {}, 1000);');
    const waiting = waitForReady(child);
    setTimeout(() => child!.kill('SIGTERM'), 100);

    // The regression in one line: `code null` is what the reader used to get,
    // and it is both useless and misleading — it reads as "exited with a code".
    await expect(waiting).rejects.toThrow(/SIGTERM/);
    await expect(waiting).rejects.not.toThrow(/with code null/);
  }, 30_000);

  it('still reports an ordinary exit code when there is no signal', async () => {
    child = forkSilentChild('process.exit(3);');

    await expect(waitForReady(child)).rejects.toThrow(/with code 3/);
  }, 30_000);

  it('carries the signal in the error details, not only in its prose', async () => {
    child = forkSilentChild('setInterval(() => {}, 1000);');
    const waiting = waitForReady(child);
    setTimeout(() => child!.kill('SIGKILL'), 100);

    // A caller deciding what to do must not have to parse the message —
    // dispatching on the text of an error is its own defect.
    const err = await waiting.then(
      () => null,
      (e: unknown) => e as { details?: { exitSignal?: string | null; exitCode?: number | null } }
    );
    expect(err?.details?.exitSignal).toBe('SIGKILL');
    expect(err?.details?.exitCode).toBeNull();
  }, 30_000);
});
