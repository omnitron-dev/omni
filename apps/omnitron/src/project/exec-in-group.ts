/**
 * Run a command to completion under a deadline that applies to everything it
 * starts, not only to itself.
 *
 * `promisify(execFile)` with `timeout` sends its signal to the DIRECT child
 * and settles when that child exits. A build is a tree — `pnpm` → `pnpm` →
 * `sh -c "rm -rf dist && tsc"` → `tsc` — and the deadline reached the root of
 * it only. Measured with `timeout: 500`:
 *
 *   child exits on SIGTERM            settled after 0.6 s, grandchild ALIVE
 *   child waits on its own children   settled after 8.0 s — when the
 *                                     grandchild finished by itself
 *
 * The first leaves the real work running as an orphan; the second makes the
 * deadline a suggestion. On `daos-test`, 2026-09-22, the build of `main` ran
 * 21 minutes under a 300-second limit and nothing reported that it had.
 *
 * The child is started as the leader of its own process group
 * (`detached: true`), and on expiry the whole group gets SIGTERM and, after a
 * grace period, SIGKILL — the same `process.kill(-pid)` the orchestrator
 * already uses to stop an app (`orchestrator.service.ts`), applied here to a
 * process that is meant to finish.
 *
 * The rejection carries `stdout`, `stderr`, `code` and `signal`, the fields
 * `execFile` puts on its error, so a caller written for one reads the other.
 */

import { spawn } from 'node:child_process';

export interface ExecInGroupOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Milliseconds before the whole group is told to stop. */
  timeout: number;
  /** Milliseconds between SIGTERM and SIGKILL. Default 10 s. */
  killGraceMs?: number;
  /** Keep at most this much of each stream. Default 4 MB. */
  maxBuffer?: number;
}

export interface ExecInGroupError extends Error {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  /** True when the deadline, not the command, ended it. */
  timedOut: boolean;
}

export function execInGroup(
  file: string,
  args: readonly string[],
  opts: ExecInGroupOptions,
): Promise<{ stdout: string; stderr: string }> {
  const maxBuffer = opts.maxBuffer ?? 4 * 1024 * 1024;
  const grace = opts.killGraceMs ?? 10_000;

  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: opts.cwd,
      env: opts.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // The TAIL of each stream: a long build's first lines are progress, its
    // last lines are the reason it stopped.
    let stdout = '';
    let stderr = '';
    const keep = (acc: string, chunk: Buffer) => {
      const next = acc + chunk.toString('utf8');
      return next.length > maxBuffer ? next.slice(-maxBuffer) : next;
    };
    child.stdout?.on('data', (c: Buffer) => (stdout = keep(stdout, c)));
    child.stderr?.on('data', (c: Buffer) => (stderr = keep(stderr, c)));

    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const signalGroup = (sig: NodeJS.Signals) => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, sig);
      } catch {
        // ESRCH: the group is already gone, which is the goal.
      }
    };

    const deadline = setTimeout(() => {
      timedOut = true;
      signalGroup('SIGTERM');
      killTimer = setTimeout(() => signalGroup('SIGKILL'), grace);
    }, opts.timeout);

    const fail = (message: string, code: number | null, signal: NodeJS.Signals | null) => {
      const err = new Error(message) as ExecInGroupError;
      err.stdout = stdout;
      err.stderr = stderr;
      err.code = code;
      err.signal = signal;
      err.timedOut = timedOut;
      reject(err);
    };

    child.on('error', (err) => {
      clearTimeout(deadline);
      if (killTimer) clearTimeout(killTimer);
      fail(err.message, null, null);
    });

    child.on('close', (code, signal) => {
      clearTimeout(deadline);
      if (killTimer) clearTimeout(killTimer);
      // Whatever the leader did, nothing it started may outlive the call:
      // a build that "succeeded" with a straggler still compiling is not
      // finished, and a timed-out one certainly is not.
      signalGroup('SIGKILL');
      if (timedOut) {
        fail(`${file} ${args.join(' ')} exceeded ${opts.timeout} ms and was stopped with everything it started`, code, signal);
      } else if (code !== 0) {
        fail(`${file} ${args.join(' ')} exited with ${code ?? signal}`, code, signal);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}
