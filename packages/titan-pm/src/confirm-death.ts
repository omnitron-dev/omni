/**
 * Whether a child we killed is actually gone — asked properly.
 *
 * SIGKILL cannot be caught, so «the process survived SIGKILL» is almost never
 * what happened. Measured on the daemon log by pairing `workerId`, the gap
 * between «SIGTERM timeout, sending SIGKILL» and «Process survived SIGKILL»
 * was 0.49–0.92 s across eight pairs — under a second. A pid is not reused in
 * that time, and a genuine survivor (blocked in an uninterruptible syscall)
 * would still be there afterwards, which nothing reported. What was left is
 * the kernel not having finished tearing the process down when we asked.
 *
 * Three faults in the single probe this replaces, in rising order:
 *
 *   1. `hasExited(child)` reads Node's own knowledge — `exitCode` and
 *      `signalCode` — and was not consulted, so a child whose exit we had
 *      already been told about was still interrogated through the process
 *      table.
 *   2. It asked ONCE.
 *   3. `process.kill(pid, 0)` cannot tell a ZOMBIE from a living process. A
 *      zombie is dead and unreaped and answers signal 0 happily, so the alarm
 *      could describe a process that was not running at all.
 *
 * The same conclusion is already written in
 * `apps/omnitron/src/orchestrator/process-janitor.ts:441`, where the janitor
 * polls instead: «An alarm that fires on a normal delay teaches its reader to
 * disregard the case it exists to report.» The janitor was fixed; this is the
 * other half.
 *
 * So: Node's own answer first, then a short poll, and only then a verdict —
 * carrying the OS state, because without it «still alive» cannot be acted on.
 * `Z` means reaping is pending; anything else means a real survivor.
 */

import type { ChildProcess } from 'node:child_process';
import { execFile } from 'node:child_process';

export interface ConfirmDeathOptions {
  /** How long to keep asking before giving up. Default 2000 ms. */
  timeoutMs?: number;
  /** Gap between questions. Default 100 ms. */
  pollMs?: number;
  /** Injected for tests; defaults to `process.kill(pid, 0)`. */
  isAlive?: (pid: number) => boolean;
  /** Injected for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected for tests; reports the OS process state, e.g. `Z` or `D`. */
  processState?: (pid: number) => Promise<string | null>;
}

export type DeathVerdict =
  | { dead: true; waitedMs: number }
  | { dead: false; waitedMs: number; state: string | null };

const DEFAULT_TIMEOUT_MS = 2_000;
const DEFAULT_POLL_MS = 100;

export async function confirmDeath(
  child: ChildProcess,
  options: ConfirmDeathOptions = {},
): Promise<DeathVerdict> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const isAlive = options.isAlive ?? defaultIsAlive;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const readState = options.processState ?? defaultProcessState;

  // Node's own knowledge settles it without touching the process table: if we
  // were told the child exited, it exited.
  if (child.exitCode !== null || child.signalCode !== null) return { dead: true, waitedMs: 0 };
  if (child.pid == null) return { dead: true, waitedMs: 0 };

  const pid = child.pid;
  const started = Date.now();

  for (;;) {
    if (!isAlive(pid)) return { dead: true, waitedMs: Date.now() - started };
    if (child.exitCode !== null || child.signalCode !== null) {
      return { dead: true, waitedMs: Date.now() - started };
    }
    if (Date.now() - started >= timeoutMs) break;
    await sleep(pollMs);
  }

  return { dead: false, waitedMs: Date.now() - started, state: await readState(pid) };
}

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = gone. EPERM = exists but not ours to signal.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * What the OS calls this pid's state — the field that makes the alarm
 * actionable. Best-effort: a failure here must not turn a report into a
 * crash, so it answers `null` and the record simply says less.
 */
function defaultProcessState(pid: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('ps', ['-o', 'stat=', '-p', String(pid)], { timeout: 2_000 }, (err, stdout) => {
      if (err) return resolve(null);
      const state = stdout.trim().split(/\s+/)[0];
      resolve(state || null);
    });
  });
}
