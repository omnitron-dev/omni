/**
 * Starting the daemon as a detached process — once, rather than twice.
 *
 * `upCommand` and `daemonStart` — the two functions behind `omnitron up`;
 * the second has no command of its own any more, and its callers import it
 * directly — each forked their own copy of this, and the copies had drifted:
 * one waited fifteen seconds, the other thirty; one passed
 * `OMNITRON_NO_INFRA`, the other did not; and neither set the child's working
 * directory, which is what made a remote install fail in a way that took
 * three rounds of guessing to see.
 *
 * `--import tsx/esm` is resolved by Node IN THE CHILD, from the child's cwd
 * upward — project configs are TypeScript, so the loader has to be there.
 * The fork inherited whatever directory the CLI was run from, and over SSH
 * that is the login directory. Measured 2026-09-14 on a node with omnitron
 * under `/opt/omnitron`:
 *
 *     Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'tsx'
 *     imported from /root/
 *
 * Which nobody saw, because `stdio: 'ignore'` discarded it and the caller
 * reported "Daemon started — verifying connectivity timed out (may still be
 * initializing)": a message about a slow start, concerning a process that had
 * already exited. Three separate causes were diagnosed that day only by
 * running the daemon by hand in the foreground.
 *
 * So: one implementation, the cwd set to where the dependencies are, and the
 * child's stderr kept.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';

import { PidManager } from './pid-manager.js';

export interface SpawnDaemonOptions {
  /** Absolute path to `daemon-entry.js`. */
  readonly entryPath: string;
  /**
   * The package root — where `node_modules` is, and therefore where
   * `--import tsx/esm` resolves from.
   */
  readonly packageRoot: string;
  /** Directory the daemon should treat as the operator's, for project lookup. */
  readonly operatorCwd: string;
  /** Where to append the child's startup stderr. */
  readonly bootLogPath: string;
  /** Extra environment for the child. */
  readonly env?: Readonly<Record<string, string>> | undefined;
  /**
   * Node arguments for the child. Defaults to the TypeScript loader, which is
   * what makes `packageRoot` load-bearing — override only in a test that is
   * not exercising the loader.
   */
  readonly execArgv?: readonly string[] | undefined;
}

/** What the daemon is normally started with. */
export const DAEMON_EXEC_ARGV: readonly string[] = ['--import', 'tsx/esm'];

export interface SpawnedDaemon {
  readonly pid: number | undefined;
  /** Where its startup stderr is going. */
  readonly bootLogPath: string;
  /** Whether the process is still there. */
  isAlive(): boolean;
}

export function spawnDaemon(options: SpawnDaemonOptions): SpawnedDaemon {
  // Appended, so a crash loop accumulates rather than overwriting the first
  // failure — which is usually the informative one.
  let stderr: number | 'ignore' = 'ignore';
  try {
    fs.mkdirSync(path.dirname(options.bootLogPath), { recursive: true });
    stderr = fs.openSync(options.bootLogPath, 'a');
  } catch {
    // Cannot write there. The daemon will say so itself if it gets far
    // enough; a start that failed for want of a log file would be worse
    // than one that fails without one.
  }

  const child = fork(options.entryPath, [], {
    detached: true,
    // `'ipc'` is not optional. `fork` is `spawn` plus a message channel, and
    // giving it an explicit stdio array without one makes it throw
    // ERR_CHILD_PROCESS_IPC_REQUIRED — in the PARENT, before the child
    // exists, so the boot log this array was added for stays empty and the
    // failure looks like the daemon dying instantly.
    //
    // The default `stdio: 'ignore'` hid the requirement by supplying the
    // channel implicitly; the moment the array is written out, it has to be
    // written out completely.
    stdio: ['ignore', 'ignore', stderr, 'ipc'],
    cwd: options.packageRoot,
    env: { ...process.env, OMNITRON_CWD: options.operatorCwd, ...options.env },
    execArgv: [...(options.execArgv ?? DAEMON_EXEC_ARGV)],
  });

  if (typeof stderr === 'number') {
    // The child holds its own descriptor now.
    try { fs.closeSync(stderr); } catch { /* already gone */ }
  }

  child.unref();

  const pid = child.pid;
  return {
    pid,
    bootLogPath: options.bootLogPath,
    isAlive: () => pid != null && PidManager.isProcessAlive(pid),
  };
}

/**
 * What to tell an operator when the daemon has not answered in time.
 *
 * "May have started" is two situations needing different things, and the OS
 * can tell them apart: a live pid is a slow boot, a dead one is a failure
 * whose reason is in the boot log.
 */
export function describeStartupTimeout(
  spawned: SpawnedDaemon,
  waitedMs: number,
): { ok: boolean; message: string; detail: string } {
  if (spawned.isAlive()) {
    return {
      ok: true,
      message: `Daemon is still starting (PID: ${spawned.pid}) — it did not answer within ${Math.round(waitedMs / 1000)}s`,
      detail: 'Check again with `omnitron ping`.',
    };
  }
  return {
    ok: false,
    message: 'Daemon exited during startup',
    detail: `It wrote its reason to ${spawned.bootLogPath}`,
  };
}
