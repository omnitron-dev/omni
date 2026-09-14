/**
 * Which OS processes the orchestrator considers its own.
 *
 * This exists as its own unit because the answer feeds `ProcessJanitor`,
 * which kills every fork-worker the set omits. The janitor was thoroughly
 * tested — owned pids are never reaped, unowned ones with a dead ppid are,
 * cold start reaps the previous daemon's leftovers — but every one of those
 * tests supplied the owned set as a fixture. Nothing tested how the set is
 * BUILT, so when it turned out to be missing a whole class of process the
 * janitor did exactly what it was tested to do, to processes that were ours.
 *
 * The omission: an app owns processes through two channels. Topology entries
 * with a single instance run as supervisor children; entries declaring
 * `instances > 1` run in a pool the supervisor knows nothing about. Only the
 * first was collected, so pool workers were orphans by construction — reaped
 * on a thirty-second cycle for as long as the daemon ran, and silently
 * replaced by a pool that then grew by one worker per sweep.
 *
 * The second omission was worse, because it hits every app on every boot:
 * BOTH channels answer only for a child that has finished starting.
 * `supervisor.getChildNames()` is written when `manager.spawn()` resolves,
 * and `resolvePid` reads the WorkerHandle registry, written at the same
 * moment. So for the whole of a startup a child is not ours, and the
 * janitor's only protection was a 60-second age threshold its own docstring
 * calls a "safe envelope for slow init paths".
 *
 * On 2026-09-11, under a load average of 88, main's http child needed 86-103
 * seconds just to import its module graph. The janitor killed it on every
 * attempt, the supervisor restarted it, and the loop fed itself for seven
 * minutes until the load came down. `forkedPids` closes it: titan-pm records
 * each pid at `fork()`, which is where it first exists.
 *
 * The third omission is the one this parameter is now named for. Both of the
 * channels above walk the ORCHESTRATOR's app handles, and the daemon spawns
 * processes that belong to no app at all: the health-monitor runs as a
 * `fork-worker.js` child of the daemon, through the same process manager,
 * owned by `SystemWorkerManager`. `forkedPids` covered it only until its
 * spawn settled — the claim is released there by design, "from then on the
 * WorkerHandle registry is the authority" — and nothing then asked that
 * registry about a process with no app handle. So every system worker became
 * an orphan the moment it finished starting, and stayed one until the age
 * threshold expired.
 *
 * Measured 2026-09-14 on the development daemon: the health-monitor worker
 * was reaped 108 times in three and a half hours, each death within 0.4-2.7
 * seconds of a janitor sweep. It exits 0 because SIGTERM reaches Titan's
 * graceful shutdown, so the record read `code: 0, signal: null` — a clean
 * exit, indistinguishable in the log from a worker that decided to stop.
 * Meanwhile the console served the daemon's fallback readings, which know
 * only whether a TCP port answers, in place of the worker's, which had
 * established over SSH that omnitron was not installed on the node at all.
 *
 * Being generous here is the safe direction: a pid wrongly included survives
 * one more sweep, while a pid wrongly omitted is a live worker killed.
 */

/** Just enough of a supervisor to enumerate its children. */
export interface OwnedPidSupervisor {
  getChildNames(): readonly string[];
  getChildProcessId(childName: string): string | null | undefined;
}

/** Just enough of a pool to enumerate its workers. */
export interface OwnedPidPool {
  getWorkerIds(): readonly string[];
}

/** Just enough of an app handle to enumerate everything it owns. */
export interface OwnedPidHandle {
  readonly supervisor: OwnedPidSupervisor | null;
  readonly topologyPools: ReadonlyMap<string, OwnedPidPool>;
}

/**
 * Collect the OS pids owned by the given handles.
 *
 * @param handles every app the orchestrator is currently supervising
 * @param resolvePid maps a process-manager worker id to its OS pid; returns
 *   undefined when the worker has no pid of its own (a worker thread shares
 *   the daemon's), which must NOT be substituted for a real one
 * @param managerPids every pid the process manager vouches for, whatever it
 *   was started for — spawns still in flight (the only source that answers
 *   during a child's startup) and every non-terminal process in its registry,
 *   which is the only source that answers for a worker belonging to no app
 */
export function collectOwnedPids(
  handles: Iterable<OwnedPidHandle>,
  resolvePid: (workerId: string) => number | undefined,
  managerPids: Iterable<number> = []
): Set<number> {
  const owned = new Set<number>();

  // Everything the process manager knows it started. The two loops below see
  // only children that belong to an app AND have finished starting.
  for (const pid of managerPids) owned.add(pid);

  for (const handle of handles) {
    for (const childName of handle.supervisor?.getChildNames() ?? []) {
      const processId = handle.supervisor?.getChildProcessId(childName);
      if (!processId) continue;
      const pid = resolvePid(processId);
      if (typeof pid === 'number') owned.add(pid);
    }

    for (const pool of handle.topologyPools.values()) {
      for (const workerId of pool.getWorkerIds()) {
        const pid = resolvePid(workerId);
        if (typeof pid === 'number') owned.add(pid);
      }
    }
  }

  return owned;
}
