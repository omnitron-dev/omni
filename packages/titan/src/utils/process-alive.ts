/**
 * Process-liveness probe.
 *
 * `process.kill(pid, 0)` is the idiomatic POSIX way to ask the
 * kernel "does a process with this pid exist". The OS replies
 * with one of three signals:
 *
 *   - returns normally → the pid exists AND we have permission
 *     to signal it (effectively: alive, ours)
 *   - throws with EPERM → the pid exists, but it belongs to a
 *     different user / capability — still alive, just not
 *     reachable. The naive `try { kill } catch { return false }`
 *     impl mis-classifies this as dead, which produces
 *     false-positive "process crashed" callbacks for any
 *     supervisor running across UID boundaries.
 *   - throws with ESRCH → no such process; truly dead.
 *
 * Pre-fix three slightly-different copies of this logic existed
 * across the monorepo (pid-manager.ts, process-janitor.ts,
 * WorkerHandle.isAlive — though that last one is a different
 * concern, querying the JS-side ChildProcess state rather than
 * the kernel). Consolidating into one shared helper guarantees
 * every supervisor draws the same line between "alive" and
 * "dead" — important because that line drives auto-restart.
 *
 * Invalid pids (NaN, ≤0, non-integer) are rejected as dead
 * without trying to signal — saves an EINVAL throw and protects
 * downstream code that assumes a real pid was supplied.
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0 || !Number.isInteger(pid)) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // EPERM = exists but we lack permission to signal — still
    // alive from our perspective. ESRCH = no such process (dead).
    // Any other code (rare: EINVAL, EFAULT) is treated as dead,
    // which is the safer default.
    return code === 'EPERM';
  }
}
