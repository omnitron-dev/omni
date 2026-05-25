/**
 * Parent-death watchdog (T#65).
 *
 * Belt-and-braces backup for `process.on('disconnect')` in fork-
 * worker processes. The disconnect handler is the primary defence
 * against orphan workers, but it has known failure modes:
 *
 *   1. macOS sometimes delays or drops the 'disconnect' event
 *      when the parent is SIGKILL'd (kernel doesn't always flush
 *      the socket close to the child immediately).
 *   2. The handler fires but the event loop is starved by user
 *      code, so `process.exit()` never runs.
 *   3. Older daemon generations may have spawned children before
 *      'disconnect' was wired — pre-fix code paths leave naked
 *      orphans on init.
 *
 * Today's incident: orphan fork-workers from previous daemon
 * generations held listen ports for HOURS despite the disconnect
 * handler.
 *
 * Strategy: poll `process.ppid` at a fixed cadence. The kernel
 * reparents to init (pid 1 on linux, launchd on macOS) the moment
 * the original parent dies, so a change in ppid is a hard signal
 * the parent is gone. Defence-in-depth: also `process.kill(orig, 0)`
 * the original ppid to catch the rare window where the kernel
 * hasn't yet updated /proc but the parent is dead (zombie state).
 *
 * Exports a small factory so it can be unit-tested with stubs.
 * The actual fork-worker just calls `startParentDeathWatchdog()`
 * with no args during initialisation.
 */

export interface ParentDeathWatchdogOptions {
  /** Poll cadence in ms. Default 5000. */
  readonly intervalMs?: number;
  /** Exit code on detected parent death. Default 130 (shell "killed by parent"). */
  readonly exitCode?: number;
  /**
   * `process.ppid`-equivalent. Default uses Node's `process.ppid`.
   * Override in tests to simulate reparenting.
   */
  readonly getCurrentPpid?: () => number;
  /**
   * `process.kill(pid, signal)`-equivalent for liveness probes.
   * Default uses Node's `process.kill`. Override in tests to
   * simulate parent death without actually killing anything.
   */
  readonly liveness?: (pid: number) => boolean;
  /**
   * Exit hook. Default uses `process.exit`. Override in tests so
   * detection can be observed without actually terminating the
   * runner.
   */
  readonly onParentDeath?: (reason: string, detail: Record<string, unknown>) => void;
  /**
   * Original parent pid to watch. Default reads `process.ppid` at
   * construction time. Tests can pin a specific value.
   */
  readonly originalPpid?: number;
}

export interface ParentDeathWatchdogHandle {
  /** Stop the periodic poll. Idempotent. */
  stop(): void;
}

/**
 * Default liveness probe via `process.kill(pid, 0)`:
 *   - ESRCH → process is gone (return false)
 *   - EPERM → process exists but we can't signal it (return true)
 *   - no throw → process exists (return true)
 */
function defaultLiveness(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EPERM') return true;
    return false;
  }
}

function defaultOnParentDeath(reason: string, detail: Record<string, unknown>): void {
  // The fork-worker's runtime has no shared logger handle, so we
  // write structured stderr matching the existing fork-worker.ts
  // log shape. Anyone reading the daemon's child stderr capture
  // sees the parent-death event as a normal log line.
  process.stderr.write(
    JSON.stringify({
      level: 50,
      time: new Date().toISOString(),
      pid: process.pid,
      msg: 'Parent process died — exiting to avoid orphan state',
      reason,
      ...detail,
    }) + '\n',
  );
  process.exit(130);
}

export function startParentDeathWatchdog(
  options: ParentDeathWatchdogOptions = {},
): ParentDeathWatchdogHandle {
  const intervalMs = options.intervalMs ?? 5_000;
  const originalPpid = options.originalPpid ?? process.ppid;
  const getCurrentPpid = options.getCurrentPpid ?? (() => process.ppid);
  const liveness = options.liveness ?? defaultLiveness;
  const onParentDeath = options.onParentDeath ?? defaultOnParentDeath;

  let stopped = false;

  const timer = setInterval(() => {
    if (stopped) return;
    const currentPpid = getCurrentPpid();
    // Reparented to init → original parent is gone.
    if (currentPpid !== originalPpid) {
      stopped = true;
      clearInterval(timer);
      onParentDeath('reparented', { originalPpid, currentPpid });
      return;
    }
    // Liveness probe — catches zombie-parent window where ppid
    // hasn't yet been updated by the kernel.
    if (!liveness(originalPpid)) {
      stopped = true;
      clearInterval(timer);
      onParentDeath('unreachable', { originalPpid });
      return;
    }
  }, intervalMs);
  // CRITICAL: unref so the watchdog timer doesn't keep the worker
  // alive past its natural exit (e.g. when the supervisor sends
  // `shutdown` IPC and the worker drains).
  timer.unref();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
    },
  };
}
