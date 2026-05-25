/**
 * Process liveness — single API answering "is this PID actually
 * running right now?" backed by signal-0.
 *
 * Pre-this-module callers pieced together liveness from a chain of
 * indirect signals: `WorkerHandle.pid` + `isProcessAlive` helper +
 * the supervisor's `processIdToName.has(...)` map. Each was a
 * partial answer (handle.pid is the LAST known pid; isProcessAlive
 * doesn't distinguish "dead" from "pid reused"; map-based checks
 * miss processes the daemon doesn't know about yet). The result
 * was a recurring "ghost-online" bug: a child that died between
 * the last metrics sweep and the current `omnitron list` showed up
 * as `online` until the next sweep noticed.
 *
 * `getLiveness(pid)` consults the OS directly via `process.kill(pid, 0)`:
 *   - returns `'alive'` when the signal is accepted (process exists
 *     and the caller has permission to signal it).
 *   - returns `'dead'` when the signal raises ESRCH (no such process).
 *   - returns `'unknown'` when the signal raises EPERM (process
 *     exists but caller can't signal — usually means PID reuse by a
 *     different user, which is informationally indistinguishable
 *     from "another user's process happens to have this pid").
 *
 * The `pid >= 1` guard catches the `0`/`-1` edge cases that
 * `process.kill` interprets as "current process group" or
 * "every process this user can signal" — both would be catastrophic
 * misreads of caller intent.
 *
 * **No async**, **no caching** here — the syscall is microseconds.
 * Callers that need to amortise across a polling loop should cache
 * at their layer with their own TTL.
 */

export type Liveness = 'alive' | 'dead' | 'unknown';

export function getLiveness(pid: number | null | undefined): Liveness {
  if (pid == null || !Number.isFinite(pid) || pid < 1) return 'dead';
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return 'dead';
    if (code === 'EPERM') return 'unknown';
    // Anything else (EINVAL etc.) — treat as unknown rather than
    // claiming dead. We don't want a transient kernel quirk to
    // tear down callers' state.
    return 'unknown';
  }
}

/**
 * Convenience wrapper for the common "is it alive?" boolean check.
 * `unknown` is treated as alive because the process DOES exist —
 * we just can't signal it. Callers that want to distinguish should
 * use `getLiveness()` directly.
 */
export function isAlive(pid: number | null | undefined): boolean {
  return getLiveness(pid) !== 'dead';
}

/**
 * Verify a pid still belongs to the process the caller expected
 * (defends against pid reuse). Reads `/proc/<pid>/comm` on Linux
 * or `ps -p <pid> -o comm=` on darwin/bsd. Returns true when the
 * observed command name matches one of the expected prefixes;
 * false when it doesn't; null when the lookup itself fails. The
 * null case is informational — callers should NOT treat it as
 * "wrong process", only as "we couldn't confirm".
 *
 * Synchronous via `execSync` because the use case is exit-handler
 * reaper paths where async isn't an option. Cost is one ~1ms `ps`
 * call per check.
 */
export function verifyPidIdentity(pid: number, expectedCommandPrefixes: readonly string[]): boolean | null {
  if (!Number.isFinite(pid) || pid < 1) return null;
  try {
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    const out = execSync(`ps -p ${pid} -o comm=`, { encoding: 'utf-8', timeout: 1000 }).trim();
    if (!out) return null;
    return expectedCommandPrefixes.some((p) => out === p || out.endsWith('/' + p) || out.includes(p));
  } catch {
    return null;
  }
}
